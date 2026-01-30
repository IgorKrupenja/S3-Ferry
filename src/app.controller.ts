import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseInterceptors,
  Version,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { ApiOkDataWithMetaResponse } from './common/decorators';
import {
  CopyFileBodyDto,
  CreateFileBodyDto,
  DataWithMetaResponseDto,
  DeleteFileBodyDto,
  FileDto,
  ListFilesQueryDto,
  LocalFilesListMetaDto,
  SignedUrlDownloadRequestDto,
  SignedUrlResponseDto,
  SignedUrlUploadRequestDto,
  StorageAccountDto,
} from './common/dtos';
import { RequestLogger } from './common/interceptors';
import { AppService } from './services';

@Controller('')
@UseInterceptors(RequestLogger)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/')
  @ApiOperation({ summary: 'Root' })
  get(): { data: string } {
    return { data: 'Storage Ferry' };
  }

  @Version('1')
  @Get('/storage-accounts')
  @ApiOkResponse({
    type: [StorageAccountDto],
    description: 'List all available storage accounts',
  })
  @ApiOperation({ summary: 'List all available storage accounts' })
  listStorageAccounts(): StorageAccountDto[] {
    return this.appService.listAccounts();
  }

  @Version('1')
  @Get('/files')
  @ApiOkDataWithMetaResponse({
    data: { type: FileDto, isArray: true },
    meta: { type: LocalFilesListMetaDto },
  })
  @ApiOperation({ summary: 'List local or remote files' })
  async listFiles(
    @Query() query: ListFilesQueryDto,
  ): Promise<DataWithMetaResponseDto<FileDto[], LocalFilesListMetaDto>> {
    return await this.appService.listFiles(query.type);
  }

  @Version('1')
  @Post('/files/copy')
  @ApiOperation({ summary: 'Copy file from source to destination' })
  async copyFile(@Body() data: CopyFileBodyDto): Promise<void> {
    return this.appService.copyFile(data);
  }

  @Version('1')
  @Post('/files/create')
  @ApiOperation({ summary: 'Create a file in storage' })
  async createFile(@Body() data: CreateFileBodyDto): Promise<void> {
    return this.appService.createFile(data);
  }

  @Version('1')
  @Delete('/files/delete')
  @ApiOperation({ summary: 'Delete a file from storage' })
  async deleteFile(@Body() data: DeleteFileBodyDto): Promise<void> {
    return this.appService.deleteFile(data);
  }

  @Version('1')
  @Post('/files/signed-url/upload')
  @ApiOkResponse({ type: SignedUrlResponseDto })
  @ApiOperation({ summary: 'Generate signed URL for file upload' })
  async generateSignedUploadUrl(
    @Body() data: SignedUrlUploadRequestDto,
  ): Promise<SignedUrlResponseDto> {
    const result = await this.appService.generateSignedUploadUrl(data);

    // Trigger AV scan simulation in background (fire and forget)
    void this.appService.simulateAvScan(data.fileName);

    return result;
  }

  @Version('1')
  @Post('/files/signed-url/download')
  @ApiOkResponse({ type: SignedUrlResponseDto })
  @ApiOperation({ summary: 'Generate signed URL for file download' })
  async generateSignedDownloadUrl(
    @Body() data: SignedUrlDownloadRequestDto,
  ): Promise<SignedUrlResponseDto> {
    return this.appService.generateSignedDownloadUrl(data);
  }
}
