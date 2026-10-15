import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LoginQRCallbackEventType,
  ThreadType,
  Zalo,
  type API,
  type Credentials,
  type Message,
} from 'zca-js';

const SESSION_FILE = join(process.cwd(), '.zalo-session.json');
const MAX_SYNC_PAGES = 20;

export type LoginState = 'logged_out' | 'waiting_scan' | 'scanned' | 'logged_in';

@Injectable()
export class ZaloService implements OnModuleInit {
  private readonly logger = new Logger(ZaloService.name);
  private readonly zalo = new Zalo({ selfListen: true, checkUpdate: false });
  private api?: API;
  private state: LoginState = 'logged_out';
  private qrBase64?: string;
  private loginError?: string;
  private abortLogin?: () => unknown;
  /** threadId (group or user) -> msgId -> message, filled by the websocket listener. */
  private readonly groupMessages = new Map<string, Map<string, Message>>();
  private readonly syncPages = new Map<ThreadType, number>();

  async onModuleInit() {
    if (!existsSync(SESSION_FILE)) return;
    try {
      const credentials = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as Credentials;
      this.api = await this.zalo.login(credentials);
      this.state = 'logged_in';
      this.startListener(this.api);
      this.logger.log('Restored Zalo session');
    } catch (e) {
      this.logger.warn(`Saved session is invalid, please login again: ${e}`);
    }
  }

  getStatus() {
    return { state: this.state };
  }

  /** Starts a login if needed, waits for the QR image, and returns it as a PNG. */

  async getQr() {
    if (this.state === 'logged_in') {
      throw new BadRequestException('Already logged in');
    }

    if (this.state === 'logged_out') {
      this.loginError = undefined;
      this.startLogin();
    }

    // Chờ tối đa 20 giây để nhận QR hoặc phát hiện lỗi.
    const deadline = Date.now() + 20_000;

    while (!this.qrBase64 && Date.now() < deadline) {
      if (this.loginError) {
        throw new ServiceUnavailableException(
          `Zalo login failed: ${this.loginError}`,
        );
      }

      if (this.state === 'logged_out') {
        throw new ServiceUnavailableException(
          'Zalo login stopped before QR was generated',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (!this.qrBase64) {
      throw new ServiceUnavailableException(
        'QR not ready after 20 seconds. Check server logs.',
      );
    }

    return Buffer.from(this.qrBase64, 'base64');
  }

  private startLogin() {
    if (this.state === 'waiting_scan' || this.state === 'scanned') return this.getStatus();
    this.state = 'waiting_scan';
    this.qrBase64 = undefined;

    this.zalo
      .loginQR({}, async (event) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            this.qrBase64 = event.data.image.replace(
              /^data:image\/\w+;base64,/,
              '',
            );
            this.abortLogin = event.actions.abort;
            break;
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            event.actions.retry();
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            this.state = 'scanned';
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            this.state = 'logged_out';
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            await writeFile(
              SESSION_FILE,
              JSON.stringify({
                imei: event.data.imei,
                userAgent: event.data.userAgent,
                cookie: event.data.cookie,
              }),
            );
            break;
        }
      })
      .then((api) => {
        this.api = api;
        this.state = 'logged_in';
        this.qrBase64 = undefined;
        this.startListener(api);
      })

      .catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e));
        const cause = (err as Error & {
          cause?: {
            code?: string;
            message?: string;
            errno?: number;
          };
        }).cause;

        this.loginError = cause?.message ?? err.message;

        this.logger.error(
          `QR login failed: ${err.message}`,
          err.stack,
        );

        this.logger.error(
          `Fetch cause: ${JSON.stringify(
            cause
              ? {
                name: (cause as Error).name,
                message: cause.message,
                code: cause.code,
                errno: cause.errno,
              }
              : null,
          )}`,
        );

        this.state = 'logged_out';
        this.qrBase64 = undefined;
      });
    return this.getStatus();
  }

  /** Aborts a pending QR login and, if logged in, drops the session, listener and cached messages. */
  async cancelLogin() {
    this.abortLogin?.();
    this.api?.listener.stop();
    this.api = undefined;
    this.state = 'logged_out';
    this.qrBase64 = undefined;
    this.groupMessages.clear();
    this.syncPages.clear();
    await rm(SESSION_FILE, { force: true });
  }

  private requireApi(): API {
    if (!this.api || this.state !== 'logged_in') throw new ServiceUnavailableException('Not logged in to Zalo');
    return this.api;
  }

  async listGroups() {
    const api = this.requireApi();
    const { gridVerMap } = await api.getAllGroups();
    const ids = Object.keys(gridVerMap);
    if (ids.length === 0) return [];
    const { gridInfoMap } = await api.getGroupInfo(ids);
    return Object.values(gridInfoMap).map((g) => ({
      id: g.groupId,
      name: g.name,
      totalMember: g.totalMember,
    }));
  }

  /** Zalo allows one websocket per account; it feeds the in-memory message store. */
  private startListener(api: API) {
    const { listener } = api;
    listener.on('message', (m) => this.store(m));
    listener.on('old_messages', (messages, type) => {
      const added = messages.filter((m) => this.store(m)).length;
      const label = type === ThreadType.Group ? 'group' : 'user';
      this.logger.log(`Old messages (${label}): received ${messages.length}, new ${added}`);
      // Page backwards: ask again from the oldest message of this batch until nothing new arrives.
      const pages = (this.syncPages.get(type) ?? 0) + 1;
      this.syncPages.set(type, pages);
      if (added > 0 && pages < MAX_SYNC_PAGES) {
        const oldest = messages.reduce((a, b) => (Number(a.data.ts) <= Number(b.data.ts) ? a : b));
        listener.requestOldMessages(type, oldest.data.msgId);
      }
    });
    listener.on('connected', () => this.logger.log('Listener connected, waiting for cipher key'));
    // Ask for history only after the handshake (cipher key) is done; on `connected` the server may ignore it.
    listener.on('cipher_key', () => {
      this.syncPages.clear();
      this.logger.log('Handshake done, requesting old messages (confirm sync on your phone if asked)');
      listener.requestOldMessages(ThreadType.Group);
      listener.requestOldMessages(ThreadType.User);
    });
    listener.on('error', (e) => this.logger.error(`Listener error: ${e}`));
    listener.on('closed', (code, reason) => this.logger.warn(`Listener closed: ${code} ${reason}`));
    listener.start({ retryOnClose: true });
  }

  /** Returns true if the message was not stored before. */
  private store(message: Message): boolean {
    let bucket = this.groupMessages.get(message.threadId);
    if (!bucket) this.groupMessages.set(message.threadId, (bucket = new Map()));
    const isNew = !bucket.has(message.data.msgId);
    bucket.set(message.data.msgId, message);
    return isNew;
  }

  getGroupMessages(groupId: string, count: number) {
    this.requireApi();
    const messages = [...(this.groupMessages.get(groupId)?.values() ?? [])]
      .sort((a, b) => Number(a.data.ts) - Number(b.data.ts))
      .slice(-count)
      .map(({ data, isSelf }) => ({
        id: data.msgId,
        from: data.uidFrom,
        fromName: data.dName,
        isSelf,
        type: data.msgType,
        content: data.content,
        mentions: (data as { mentions?: unknown[] }).mentions ?? [],
        quote: data.quote?.msg,
        sentAt: new Date(Number(data.ts)).toISOString(),
      }));
    return { count: messages.length, messages };
  }
}
