import * as joi from 'joi';

const schema = {
  S3_REGION: joi.string(),
  S3_ENDPOINT_URL: joi.string().uri().allow(''),
  S3_PUBLIC_ENDPOINT_URL: joi.string().uri().allow(''),
  S3_ACCESS_KEY_ID: joi.string(),
  S3_SECRET_ACCESS_KEY: joi.string(),
  S3_DATA_BUCKET_NAME: joi.string().optional(),
  S3_DATA_BUCKET_PATH: joi.string().optional().allow(''),
};

export const s3ConfigSchema = joi.object<typeof schema>(schema);
