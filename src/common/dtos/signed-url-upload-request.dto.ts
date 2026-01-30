import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SignedUrlUploadRequestDto {
  @IsString()
  readonly fileName!: string;

  @IsNumber()
  readonly fileSize!: number;

  @IsString()
  readonly mimeType!: string;

  @IsString()
  @IsOptional()
  readonly bucket?: string;
}
