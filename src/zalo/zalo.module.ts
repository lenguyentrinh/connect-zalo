import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupEntity } from './group.entity.js';
import { GroupRepository } from './group.repository.js';
import { MessageEntity } from './message.entity.js';
import { MessageRepository } from './message.repository.js';
import { ZaloController } from './zalo.controller.js';
import { ZaloService } from './zalo.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([MessageEntity, GroupEntity])],
  controllers: [ZaloController],
  providers: [ZaloService, MessageRepository, GroupRepository],
})
export class ZaloModule {}
