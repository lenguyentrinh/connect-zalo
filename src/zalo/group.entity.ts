import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('zalo_groups')
export class GroupEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  name: string;

  @Column({ name: 'total_member', type: 'int', default: 0 })
  totalMember: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
