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
import { GroupRepository } from './group.repository.js';
import { MessageRepository } from './message.repository.js';

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
  private readonly syncPages = new Map<ThreadType, number>();
  /** Group ids whose name is already saved (or being fetched), to avoid repeated lookups. */
  private readonly knownGroups = new Set<string>();

  constructor(
    private readonly messages: MessageRepository,
    private readonly groups: GroupRepository,
  ) {}

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
    const list = Object.values(gridInfoMap).map((g) => ({
      id: g.groupId,
      name: g.name,
      totalMember: g.totalMember,
    }));
    await Promise.all(
      list.map((g) =>
        this.groups
          .upsert(g)
          .then(() => this.knownGroups.add(g.id))
          .catch((e) => this.logger.error(`Failed to save group ${g.id}: ${e}`)),
      ),
    );
    return list;
  }

  /** Saves the group's name the first time a message from it is seen. Never throws. */
  private async ensureGroup(groupId: string) {
    if (this.knownGroups.has(groupId) || !this.api) return;
    this.knownGroups.add(groupId);
    try {
      const { gridInfoMap } = await this.api.getGroupInfo([groupId]);
      const g = gridInfoMap[groupId];
      if (!g) throw new Error('group info not returned');
      await this.groups.upsert({ id: groupId, name: g.name, totalMember: g.totalMember });
    } catch (e) {
      this.knownGroups.delete(groupId);
      this.logger.warn(`Could not save name of group ${groupId}: ${e}`);
    }
  }

  /** Zalo allows one websocket per account; every message it delivers is saved to MySQL. */
  private startListener(api: API) {
    const { listener } = api;
    listener.on('message', (m) => void this.store(m));
    listener.on('undo', (u) => {
      this.messages
        .markRecalled(u.threadId, String(u.data.content.globalMsgId))
        .catch((e) => this.logger.error(`Failed to mark message recalled: ${e}`));
    });
    listener.on('old_messages', async (messages, type) => {
      const added = (await Promise.all(messages.map((m) => this.store(m)))).filter(Boolean).length;
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

  /** Saves to MySQL; returns true if the message was not stored before. A DB error is logged, never thrown. */
  private async store(message: Message): Promise<boolean> {
    try {
      const isNew = await this.messages.save(message);
      if (message.type === ThreadType.Group) void this.ensureGroup(message.threadId);
      return isNew;
    } catch (e) {
      this.logger.error(`Failed to save message ${message.data.msgId}: ${e}`);
      return false;
    }
  }

  /** Reads from MySQL, so it works without a Zalo login. */
  async getGroupMessages(groupId: string, count: number, before?: number) {
    const [group, messages] = await Promise.all([
      this.groups.findById(groupId),
      this.messages.findByGroup(groupId, count, before),
    ]);
    return { groupId, groupName: group?.name ?? null, count: messages.length, messages };
  }
}
