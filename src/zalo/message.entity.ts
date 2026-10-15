import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('messages')
@Index('uq_group_msg', ['groupId', 'msgId'], { unique: true })
@Index('idx_group_sent', ['groupId', 'sentAt'])
export class MessageEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'group_id', type: 'varchar', length: 64 })
  groupId: string;

  @Column({ name: 'msg_id', type: 'varchar', length: 64 })
  msgId: string;

  /** 0 = user, 1 = group */
  @Column({ name: 'thread_type', type: 'tinyint' })
  threadType: number;

  @Column({ name: 'sender_id', type: 'varchar', length: 64 })
  senderId: string;

  @Column({ name: 'sender_name', type: 'varchar', length: 255, default: '' })
  senderName: string;

  @Column({ name: 'is_self', type: 'tinyint', width: 1, default: 0 })
  isSelf: boolean;

  @Column({ name: 'msg_type', type: 'varchar', length: 64, default: '' })
  msgType: string;

  @Column({ type: 'mediumtext', nullable: true })
  content: string | null;

  @Column({ type: 'tinyint', width: 1, default: 0 })
  recalled: boolean;

  /** epoch ms; BIGINT comes back from MySQL as a string */
  @Column({ name: 'sent_at', type: 'bigint' })
  sentAt: string;

  @Column({ type: 'json', nullable: true })
  raw: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
