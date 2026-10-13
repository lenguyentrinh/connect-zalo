
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

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiProduces,
} from '@nestjs/swagger';
import { ZaloService } from './zalo.service.js';


@ApiTags('Zalo')
@Controller('zalo')
export class ZaloController {
  constructor(private readonly zalo: ZaloService) { }

  @Get('status')
  @ApiOperation({
    summary: 'Kiểm tra trạng thái Zalo',
    description: 'Trả về trạng thái kết nối Zalo hiện tại.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy trạng thái thành công.',
  })
  status() {
    return this.zalo.getStatus();
  }

  @Delete('login')
  @ApiOperation({
    summary: 'Hủy đăng nhập Zalo',
    description: 'Hủy phiên đăng nhập Zalo hiện tại.',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã xử lý yêu cầu hủy đăng nhập.',
  })
  cancelLogin() {
    this.zalo.cancelLogin();
    return this.zalo.getStatus();
  }

  @Get('login/qr')
  @Header('Content-Type', 'image/png')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Hiển thị mã QR đăng nhập Zalo' })
  @ApiResponse({
    status: 200,
    description: 'Ảnh QR đăng nhập Zalo',
    content: {
      'image/png': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async qr() {
    return new StreamableFile(await this.zalo.getQr());
  }


  @Get('login/qr-view')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async qrView() {
    const qr = (await this.zalo.getQr()).toString('base64');

    return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8">
        <title>Đăng nhập Zalo</title>
      </head>
      <body style="font-family:Arial;text-align:center;padding:24px">
        <h2>Quét mã QR để đăng nhập Zalo</h2>
        <img
          src="data:image/png;base64,${qr}"
          alt="QR đăng nhập Zalo"
          style="width:320px;max-width:90%;height:auto"
        />
      </body>
    </html>
  `;
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Lấy danh sách nhóm chat',
    description: 'Trả về danh sách nhóm chat Zalo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy danh sách nhóm thành công.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
      },
    },
  })
  groups() {
    return this.zalo.listGroups();
  }

  @Get('groups/:id/messages')
  @ApiOperation({
    summary: 'Lấy tin nhắn của nhóm',
    description:
      'Lấy tin nhắn theo ID nhóm. Tham số count giới hạn số lượng tin nhắn trả về, tối đa 200.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'ID nhóm Zalo.',
    example: 'group_id',
  })
  @ApiQuery({
    name: 'count',
    required: false,
    type: Number,
    description: 'Số lượng tin nhắn cần lấy, mặc định 50, tối thiểu 1, tối đa 200.',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy tin nhắn thành công.',
  })
  @ApiResponse({
    status: 400,
    description: 'Tham số count không hợp lệ.',
  })
  async messages(
    @Param('id') id: string,
    @Query('count', new DefaultValuePipe(50), ParseIntPipe)
    count: number,
  ) {
    return this.zalo.getGroupMessages(
      id,
      Math.min(Math.max(count, 1), 200),
    );
  }
}