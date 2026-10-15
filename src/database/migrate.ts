// Usage: npm run migrate          -> apply pending migrations
//        npm run migrate:revert   -> undo the last applied migration
//        npm run migrate:show     -> list migrations and whether they are applied
import { DataSource } from 'typeorm';
import { GroupEntity } from '../zalo/group.entity.js';
import { MessageEntity } from '../zalo/message.entity.js';
import { migrations } from './migrations/index.js';

try {
  process.loadEnvFile();
} catch {
  // no .env file, rely on the real environment
}

const { DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER = 'root', DB_PASSWORD, DB_NAME = 'zalo' } = process.env;

const dataSource = new DataSource({
  type: 'mysql',
  host: DB_HOST,
  port: Number(DB_PORT),
  username: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  charset: 'utf8mb4',
  entities: [MessageEntity, GroupEntity],
  migrations,
});

const command = process.argv[2] ?? 'run';

await dataSource.initialize();
try {
  if (command === 'revert') {
    await dataSource.undoLastMigration();
    console.log('reverted last migration');
  } else if (command === 'show') {
    const pending = await dataSource.showMigrations();
    console.log(pending ? 'there are pending migrations' : 'no pending migrations');
  } else {
    const applied = await dataSource.runMigrations();
    console.log(applied.length ? `applied: ${applied.map((m) => m.name).join(', ')}` : 'migrations up to date');
  }
} finally {
  await dataSource.destroy();
}
