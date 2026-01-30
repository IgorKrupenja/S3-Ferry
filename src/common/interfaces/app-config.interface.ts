export interface AppConfig {
  readonly corsOrigin: string | string[];
  readonly documentationEnabled: boolean;
  readonly maxFileSize: number;
}
