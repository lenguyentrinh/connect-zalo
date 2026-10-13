import { Module } from '@nestjs/common';
import { ZaloController } from './zalo.controller.js';
import { ZaloService } from './zalo.service.js';

@Module({
  controllers: [ZaloController],
  providers: [ZaloService],
})
export class ZaloModule {}
