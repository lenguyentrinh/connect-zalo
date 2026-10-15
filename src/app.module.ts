import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { migrations } from './database/migrations/index.js';
import { ZaloModule } from './zalo/zalo.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(config.get('DB_PORT', 3306)),
        username: config.get<string>('DB_USER', 'root'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME', 'zalo'),
        charset: 'utf8mb4',
        autoLoadEntities: true,
        synchronize: false,
        migrations,
        migrationsRun: true,
      }),
    }),
    ZaloModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
