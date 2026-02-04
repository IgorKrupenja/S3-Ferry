import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  DataWithMetaResponseDto,
  FileDto,
  LocalFilesListMetaDto,
} from '../../common/dtos';
import { FileNotFoundException } from '../../common/exceptions';
import { s3ConfigFactory } from '../config';
import { S3Config } from '../config/s3.config.interface';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: S3;

  constructor(@Inject(s3ConfigFactory.KEY) private readonly config: S3Config) {
    this.s3 = new S3({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpointUrl && { endpoint: config.endpointUrl }),
      forcePathStyle: true,
      region: config.region,
      // Disable automatic checksum calculation to avoid compatibility issues with LocalStack
      // LocalStack doesn't fully support AWS SDK v3's flexible checksums middleware,
      // which can cause errors like "'NoneType' object has no attribute 'to_bytes'"
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  public async listFiles(): Promise<
    DataWithMetaResponseDto<FileDto[], LocalFilesListMetaDto>
  > {
    const response = await this.s3.listObjectsV2({
      Bucket: this.config.dataBucketName,
    });
    const files: FileDto[] = [];

    if (response.Contents) {
      for (const file of response.Contents) {
        if (!file.Key?.includes('/')) {
          files.push(
            new FileDto({
              name: file.Key,
              size: file.Size,
              lastModified: file.LastModified,
            }),
          );
        }
      }
    }

    return { data: files, meta: { count: files.length } };
  }

  async copyFileFromRemoteToLocal(
    destinationFilePath: string,
    sourceFilePath: string,
    fsDataDirectoryPath: string,
  ): Promise<void> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.dataBucketName,
          Key: path.join(this.config.dataBucketPath, sourceFilePath),
        }),
      );

      const writeStream = fs.createWriteStream(
        path.join(fsDataDirectoryPath, destinationFilePath),
      );

      await new Promise<void>((resolve, reject) => {
        (response.Body as Readable)
          .pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });
    } catch (error) {
      throw error instanceof NoSuchKey
        ? new FileNotFoundException('File not found in S3')
        : error;
    }
  }

  async copyFileFromLocalToRemote(
    sourceFilePath: string,
    destinationFilePath: string,
    fsDataDirectoryPath: string,
  ): Promise<void> {
    const fileExists = fs.existsSync(
      path.join(fsDataDirectoryPath, sourceFilePath),
    );
    if (!fileExists) throw new FileNotFoundException('File not found in FS');

    const fileBuffer = fs.readFileSync(
      path.join(fsDataDirectoryPath, sourceFilePath),
    );

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.dataBucketName,
        Body: fileBuffer,
        Key: path.join(this.config.dataBucketPath, destinationFilePath),
      }),
    );
  }

  async generateSignedUploadUrl(
    fileName: string,
    mimeType: string,
    bucket: string,
    fileSize: number,
    maxFileSize: number = 10485760, // 10MB default
    expiresIn: number = 3600,
  ): Promise<{ url: string; expiresAt: string }> {
    // Validate file size
    if (fileSize > maxFileSize) {
      this.logger.warn(
        `[POC-ATTACHMENTS] File size validation failed - fileName: ${fileName}, fileSize: ${fileSize}, maxFileSize: ${maxFileSize}`,
      );
      throw new BadRequestException(
        `File size ${fileSize} bytes exceeds maximum allowed size of ${maxFileSize} bytes`,
      );
    }

    if (fileSize <= 0) {
      this.logger.warn(
        `[POC-ATTACHMENTS] Invalid file size - fileName: ${fileName}, fileSize: ${fileSize}`,
      );
      throw new BadRequestException('File size must be greater than 0');
    }

    this.logger.log(
      `[POC-ATTACHMENTS] Creating S3 signed URL - fileName: ${fileName}, bucket: ${bucket}, fileSize: ${fileSize}, mimeType: ${mimeType}`,
    );

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileName,
      ContentType: mimeType,
      ContentLength: fileSize, // Enforce exact file size
    });

    let url = await getSignedUrl(this.s3, command, { expiresIn });

    // Replace internal endpoint URL with public endpoint URL for browser access
    if (
      this.config.endpointUrl &&
      this.config.publicEndpointUrl &&
      this.config.endpointUrl !== this.config.publicEndpointUrl
    ) {
      url = url.replace(this.config.endpointUrl, this.config.publicEndpointUrl);
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    this.logger.log(
      `[POC-ATTACHMENTS] S3 signed upload URL created - fileName: ${fileName}, bucket: ${bucket}, expiresIn: ${expiresIn}s`,
    );

    return { url, expiresAt };
  }

  async generateSignedDownloadUrl(
    fileName: string,
    bucket: string,
    expiresIn: number = 3600,
  ): Promise<{ url: string; expiresAt: string }> {
    this.logger.log(
      `[POC-ATTACHMENTS] Creating S3 signed download URL - fileName: ${fileName}, bucket: ${bucket}`,
    );

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileName,
    });

    let url = await getSignedUrl(this.s3, command, { expiresIn });

    // Replace internal endpoint URL with public endpoint URL for browser access
    if (
      this.config.endpointUrl &&
      this.config.publicEndpointUrl &&
      this.config.endpointUrl !== this.config.publicEndpointUrl
    ) {
      url = url.replace(this.config.endpointUrl, this.config.publicEndpointUrl);
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    this.logger.log(
      `[POC-ATTACHMENTS] S3 signed download URL created - fileName: ${fileName}, bucket: ${bucket}, expiresIn: ${expiresIn}s`,
    );

    return { url, expiresAt };
  }

  async moveFile(
    sourceKey: string,
    sourceBucket: string,
    destinationKey: string,
    destinationBucket: string,
  ): Promise<void> {
    this.logger.log(
      `[POC-ATTACHMENTS] Moving file in S3 - from: ${sourceBucket}/${sourceKey}, to: ${destinationBucket}/${destinationKey}`,
    );

    // Copy the object to the destination
    await this.s3.send(
      new CopyObjectCommand({
        CopySource: `${sourceBucket}/${sourceKey}`,
        Bucket: destinationBucket,
        Key: destinationKey,
      }),
    );

    // Delete the source object
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: sourceBucket,
        Key: sourceKey,
      }),
    );

    this.logger.log(
      `[POC-ATTACHMENTS] File moved successfully - fileName: ${destinationKey}`,
    );
  }

  async deleteFile(key: string, bucket: string): Promise<void> {
    this.logger.log(
      `[POC-ATTACHMENTS] Deleting file from S3 - bucket: ${bucket}, key: ${key}`,
    );

    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    this.logger.log(
      `[POC-ATTACHMENTS] File deleted successfully - bucket: ${bucket}, key: ${key}`,
    );
  }
}
