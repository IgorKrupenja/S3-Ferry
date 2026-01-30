import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AzureAccountService, AzureBlobService } from '../azure/services';
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
import { FsService } from '../fs';
import { S3Service } from '../s3';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
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
      const { url, expiresAt } = await this.s3Service.generateSignedUploadUrl(
        data.fileName,
        data.mimeType,
        bucket,
        3600, // 1 hour expiration
      );

      return {
        url,
        expiresAt,
        bucket,
        key: data.fileName,
      };
    } catch (error) {
      this.logger.error(
        `Generating signed upload URL failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException('Failed to generate upload URL');
    }
  }

  async generateSignedDownloadUrl(
    data: SignedUrlDownloadRequestDto,
  ): Promise<SignedUrlResponseDto> {
    try {
      const bucket = data.bucket || 'production';
      const { url, expiresAt } = await this.s3Service.generateSignedDownloadUrl(
        data.fileName,
        bucket,
        3600, // 1 hour expiration
      );

      return {
        url,
        expiresAt,
        bucket,
        key: data.fileName,
      };
    } catch (error) {
      this.logger.error(
        `Generating signed download URL failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new InternalServerException('Failed to generate download URL');
    }
  }

  async simulateAvScan(fileName: string): Promise<void> {
    // Simulate AV scan delay (5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      // Move file from quarantine to production bucket
      await this.s3Service.moveFile(
        fileName,
        'quarantine',
        fileName,
        'production',
      );

      this.logger.log(
        `File ${fileName} passed AV scan and moved to production bucket`,
      );
    } catch (error) {
      this.logger.error(
        `AV scan simulation failed for ${fileName}: ${error instanceof Error ? error.stack : String(error)}`,
      );
      // In case of failure, delete the file from quarantine
      try {
        await this.s3Service.deleteFile(fileName, 'quarantine');
      } catch (deleteError) {
        this.logger.error(
          `Failed to delete file ${fileName} from quarantine: ${deleteError instanceof Error ? deleteError.stack : String(deleteError)}`,
        );
      }
      throw new InternalServerException('AV scan failed');
    }
  }
}
