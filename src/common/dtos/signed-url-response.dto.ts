export class SignedUrlResponseDto {
  readonly url!: string;
  readonly expiresAt!: string;
  readonly bucket?: string;
  readonly key?: string;
}
