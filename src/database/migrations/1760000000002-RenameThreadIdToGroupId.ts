import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameThreadIdToGroupId1760000000002 implements MigrationInterface {
  name = 'RenameThreadIdToGroupId1760000000002';

  // MySQL 8 keeps the indexes that use the column and renames it inside them.
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE messages RENAME COLUMN thread_id TO group_id');
    await q.query('ALTER TABLE messages RENAME INDEX uq_thread_msg TO uq_group_msg');
    await q.query('ALTER TABLE messages RENAME INDEX idx_thread_sent TO idx_group_sent');
  }

  async down(q: QueryRunner) {
    await q.query('ALTER TABLE messages RENAME INDEX idx_group_sent TO idx_thread_sent');
    await q.query('ALTER TABLE messages RENAME INDEX uq_group_msg TO uq_thread_msg');
    await q.query('ALTER TABLE messages RENAME COLUMN group_id TO thread_id');
  }
}
