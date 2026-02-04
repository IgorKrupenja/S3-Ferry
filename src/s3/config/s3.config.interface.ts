export interface S3Config {
  readonly region: string;
  readonly endpointUrl: string;
  readonly publicEndpointUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly dataBucketName: string;
  readonly dataBucketPath: string;
}
