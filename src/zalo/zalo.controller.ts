import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ZaloService } from './zalo.service.js';

@Controller('zalo')
export class ZaloController {
  constructor(private readonly zalo: ZaloService) {}

  @Get('status')
  status() {
    return this.zalo.getStatus();
  }

  @Delete('login')
  cancelLogin() {
    this.zalo.cancelLogin();
    return this.zalo.getStatus();
  }

  @Get('login/qr')
  @Header('Content-Type', 'image/png')
  async qr() {
    return new StreamableFile(await this.zalo.getQr());
  }

  @Get('groups')
  groups() {
    return this.zalo.listGroups();
  }

  @Get('groups/:id/messages')
  messages(
    @Param('id') id: string,
    @Query('count', new DefaultValuePipe(50), ParseIntPipe) count: number,
  ) {
    return this.zalo.getGroupMessages(id, Math.min(Math.max(count, 1), 200));
  }
}
