import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import type { Message } from 'zca-js';
import { MessageEntity } from './message.entity.js';

export interface StoredMessage {
  id: string;
  from: string;
  fromName: string;
  isSelf: boolean;
  type: string;
  content: unknown;
  recalled: boolean;
  sentAt: string;
}

@Injectable()
export class MessageRepository {
  constructor(@InjectRepository(MessageEntity) private readonly repo: Repository<MessageEntity>) {}

  /** Inserts the message once; returns true if it was not in the database before. */
  async save(message: Message): Promise<boolean> {
    const { data } = message;
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        groupId: message.threadId,
        msgId: data.msgId,
        threadType: message.type,
        senderId: data.uidFrom,
        senderName: data.dName ?? '',
        isSelf: message.isSelf,
        msgType: data.msgType ?? '',
        content: JSON.stringify(data.content),
        sentAt: String(data.ts),
        raw: JSON.stringify(data),
      })
      .orIgnore()
      .execute();
    return (result.raw as { affectedRows: number }).affectedRows === 1;
  }

  async markRecalled(groupId: string, msgId: string) {
    await this.repo.update({ groupId, msgId }, { recalled: true });
  }

  /** Newest `count` messages of a group (oldest first); `before` (epoch ms) pages further back. */
  async findByGroup(groupId: string, count: number, before?: number): Promise<StoredMessage[]> {
    const rows = await this.repo.find({
      where: { groupId, ...(before ? { sentAt: LessThan(String(before)) } : {}) },
      order: { sentAt: 'DESC' },
      take: count,
    });
    return rows.reverse().map((r) => ({
      id: r.msgId,
      from: r.senderId,
      fromName: r.senderName,
      isSelf: !!r.isSelf,
      type: r.msgType,
      content: r.content === null ? null : JSON.parse(r.content),
      recalled: !!r.recalled,
      sentAt: new Date(Number(r.sentAt)).toISOString(),
    }));
  }
}
