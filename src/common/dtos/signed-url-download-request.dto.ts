import { IsOptional, IsString } from 'class-validator';

export class SignedUrlDownloadRequestDto {
  @IsString()
  readonly fileName!: string;

  @IsString()
  @IsOptional()
  readonly bucket?: string;
}
