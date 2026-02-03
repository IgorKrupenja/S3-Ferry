import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AzureAccountService, AzureBlobService } from '../azure/services';
import { appConfigFactory } from '../common/config';
import {
  CopyFileBodyDto,
  CreateFileBodyDto,
  DataWithMetaResponseDto,
  DeleteFileBodyDto,
  FileDto,
  LocalFilesListMetaDto,
  SignedUrlDownloadRequestDto,
  SignedUrlResponseDto,
  SignedUrlUploadRequestDto,
  StorageAccountDto,
} from '../common/dtos';
import { StorageType } from '../common/enums';
import {
  FileNotFoundException,
  InternalServerException,
} from '../common/exceptions';
import { AppConfig } from '../common/interfaces';
import { FsService } from '../fs';
import { S3Service } from '../s3';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: AppConfig,
    private readonly fsService: FsService,
    private readonly s3Service: S3Service,
    private readonly azureAccountService: AzureAccountService,
    private readonly azureBlobService: AzureBlobService,
  ) {}

  async listFiles(
    storageType: StorageType,
  ): Promise<DataWithMetaResponseDto<FileDto[], LocalFilesListMetaDto>> {
    try {
      switch (storageType) {
        case StorageType.FS:
          return this.fsService.listFiles();

        case StorageType.S3:
          return await this.s3Service.listFiles();

        default:
          throw new Error(`Storage type not supported: ${storageType}`);
      }
    } catch (error) {
      this.logger.error(
        `Listing files failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw error;
    }
  }

  async copyFile(data: CopyFileBodyDto): Promise<void> {
    try {
      switch (data.destinationStorageType) {
        case StorageType.FS:
          await this.s3Service.copyFileFromRemoteToLocal(
            data.destinationFilePath,
            data.sourceFilePath,
            this.fsService.getDataDirectoryPath(),
          );
          break;

        case StorageType.S3:
          await this.s3Service.copyFileFromLocalToRemote(
            data.sourceFilePath,
            data.destinationFilePath,
            this.fsService.getDataDirectoryPath(),
          );
          break;
      }
    } catch (error) {
      this.logger.error(
        `Copying files failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw error instanceof FileNotFoundException
        ? new FileNotFoundException(error.message)
        : new InternalServerException();
    }
  }

  listAccounts(): StorageAccountDto[] {
    try {
      // For now, only return Azure accounts
      // In the future, this will aggregate accounts from all storage types
      return this.azureAccountService.listAccounts();
    } catch (error) {
      this.logger.error(
        `Listing storage accounts failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw error;
    }
  }

  async createFile(data: CreateFileBodyDto): Promise<void> {
    try {
      // Create files at all specified locations with the same content in parallel
      await Promise.all(
        data.files.map((file) => {
          // Infer storage type from account ID (e.g., "azure-account1" -> Azure, "s3-key" -> S3)
          if (file.storageAccountId.startsWith('azure-')) {
            return this.azureBlobService.createBlob(
              file.storageAccountId,
              file.container,
              file.fileName,
              data.content,
            );
          } else {
            const errorMessage = `Storage type not supported for account: ${file.storageAccountId}`;
            this.logger.error(
              `${errorMessage}. Account ID format should start with 'azure-' for Azure storage.`,
            );
            throw new BadRequestException(errorMessage);
          }
        }),
      );
    } catch (error) {
      // Re-throw HTTP exceptions (BadRequestException, NotFoundException, etc.)
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // Log and wrap unexpected errors
      this.logger.error(
        `Creating file failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException(
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteFile(data: DeleteFileBodyDto): Promise<void> {
    try {
      // Delete files at all specified locations in parallel
      await Promise.all(
        data.files.map((file) => {
          // Infer storage type from account ID (e.g., "azure-account1" -> Azure, "s3-key" -> S3)
          if (file.storageAccountId.startsWith('azure-')) {
            return this.azureBlobService.deleteBlob(
              file.storageAccountId,
              file.container,
              file.fileName,
            );
          } else {
            const errorMessage = `Storage type not supported for account: ${file.storageAccountId}`;
            this.logger.error(
              `${errorMessage}. Account ID format should start with 'azure-' for Azure storage.`,
            );
            throw new BadRequestException(errorMessage);
          }
        }),
      );
    } catch (error) {
      // Re-throw HTTP exceptions (BadRequestException, NotFoundException, etc.)
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // Log and wrap unexpected errors
      this.logger.error(
        `Deleting file failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async generateSignedUploadUrl(
    data: SignedUrlUploadRequestDto,
  ): Promise<SignedUrlResponseDto> {
    try {
      const bucket = data.bucket || 'quarantine';

      this.logger.log(
        `[POC-ATTACHMENTS] Generating signed upload URL - fileName: ${data.fileName}, fileSize: ${data.fileSize}, mimeType: ${data.mimeType}, bucket: ${bucket}`,
      );

      const { url, expiresAt } = await this.s3Service.generateSignedUploadUrl(
        data.fileName,
        data.mimeType,
        bucket,
        data.fileSize,
        this.appConfig.maxFileSize,
        3600, // 1 hour expiration
      );

      this.logger.log(
        `[POC-ATTACHMENTS] Signed upload URL generated successfully - fileName: ${data.fileName}, bucket: ${bucket}, expiresAt: ${expiresAt}`,
      );

      return {
        url,
        expiresAt,
        bucket,
        key: data.fileName,
      };
    } catch (error) {
      // Re-throw BadRequestException for validation errors
      if (error instanceof BadRequestException) {
        this.logger.warn(
          `[POC-ATTACHMENTS] Validation failed - fileName: ${data.fileName}, error: ${error.message}`,
        );
        throw error;
      }
      this.logger.error(
        `[POC-ATTACHMENTS] Generating signed upload URL failed - fileName: ${data.fileName}, error: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException('Failed to generate upload URL');
    }
  }

  async generateSignedDownloadUrl(
    data: SignedUrlDownloadRequestDto,
  ): Promise<SignedUrlResponseDto> {
    try {
      const bucket = data.bucket || 'production';

      this.logger.log(
        `[POC-ATTACHMENTS] Generating signed download URL - fileName: ${data.fileName}, bucket: ${bucket}`,
      );

      const { url, expiresAt } = await this.s3Service.generateSignedDownloadUrl(
        data.fileName,
        bucket,
        3600, // 1 hour expiration
      );

      this.logger.log(
        `[POC-ATTACHMENTS] Signed download URL generated successfully - fileName: ${data.fileName}, bucket: ${bucket}, expiresAt: ${expiresAt}`,
      );

      return {
        url,
        expiresAt,
        bucket,
        key: data.fileName,
      };
    } catch (error) {
      this.logger.error(
        `[POC-ATTACHMENTS] Generating signed download URL failed - fileName: ${data.fileName}, error: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException('Failed to generate download URL');
    }
  }
}
