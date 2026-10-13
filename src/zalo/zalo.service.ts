import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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

export type LoginState = 'logged_out' | 'waiting_scan' | 'scanned' | 'logged_in';

@Injectable()
export class ZaloService implements OnModuleInit {
  private readonly logger = new Logger(ZaloService.name);
  private readonly zalo = new Zalo({ selfListen: false, checkUpdate: false });
  private api?: API;
  private state: LoginState = 'logged_out';
  private qrBase64?: string;
  private abortLogin?: () => unknown;
  /** groupId -> msgId -> message, filled by the websocket listener. */
  private readonly groupMessages = new Map<string, Map<string, Message>>();

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
    if (this.state === 'logged_in') throw new BadRequestException('Already logged in');
    if (this.state === 'logged_out') this.startLogin();
    for (let i = 0; i < 50 && !this.qrBase64; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!this.qrBase64) throw new ServiceUnavailableException('QR not ready, try again');
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
            this.qrBase64 = event.data.image.replace(/^data:image\/\w+;base64,/, '');
            this.abortLogin = event.actions.abort;
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
      .catch((e) => {
        this.logger.error(`QR login failed: ${e}`);
        this.state = 'logged_out';
      });
    return this.getStatus();
  }

  cancelLogin() {
    this.abortLogin?.();
    this.state = 'logged_out';
    this.qrBase64 = undefined;
  }

  private requireApi(): API {
    if (!this.api) throw new ServiceUnavailableException('Not logged in to Zalo');
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
    listener.on('old_messages', (messages) => messages.forEach((m) => this.store(m)));
    listener.on('connected', () => listener.requestOldMessages(ThreadType.Group));
    listener.on('error', (e) => this.logger.error(`Listener error: ${e}`));
    listener.on('closed', (code, reason) => this.logger.warn(`Listener closed: ${code} ${reason}`));
    listener.start({ retryOnClose: true });
  }

  private store(message: Message) {
    if (message.type !== ThreadType.Group) return;
    let bucket = this.groupMessages.get(message.threadId);
    if (!bucket) this.groupMessages.set(message.threadId, (bucket = new Map()));
    bucket.set(message.data.msgId, message);
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
