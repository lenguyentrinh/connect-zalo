import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGroups1760000000001 implements MigrationInterface {
  name = 'CreateGroups1760000000001';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE zalo_groups (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT '',
        total_member INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }

  async down(q: QueryRunner) {
    await q.query('DROP TABLE IF EXISTS zalo_groups');
  }
}
