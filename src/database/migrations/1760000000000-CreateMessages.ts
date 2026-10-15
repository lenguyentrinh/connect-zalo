import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessages1760000000000 implements MigrationInterface {
  name = 'CreateMessages1760000000000';

  async up(q: QueryRunner) {
    // IF NOT EXISTS: the table may already exist from before migrations were introduced.
    await q.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        thread_id VARCHAR(64) NOT NULL,
        msg_id VARCHAR(64) NOT NULL,
        thread_type TINYINT NOT NULL COMMENT '0 = user, 1 = group',
        sender_id VARCHAR(64) NOT NULL,
        sender_name VARCHAR(255) NOT NULL DEFAULT '',
        is_self TINYINT(1) NOT NULL DEFAULT 0,
        msg_type VARCHAR(64) NOT NULL DEFAULT '',
        content MEDIUMTEXT NULL,
        recalled TINYINT(1) NOT NULL DEFAULT 0,
        sent_at BIGINT NOT NULL COMMENT 'epoch ms',
        raw JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_thread_msg (thread_id, msg_id),
        KEY idx_thread_sent (thread_id, sent_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }

  async down(q: QueryRunner) {
    await q.query('DROP TABLE IF EXISTS messages');
  }
}
