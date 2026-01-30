import * as joi from 'joi';

const schema = {
  API_CORS_ORIGIN: joi.string().required().allow(''),
  API_DOCUMENTATION_ENABLED: joi.boolean().required(),
  API_MAX_FILE_SIZE: joi.number().integer().positive().default(10485760),
};

export const appConfigSchema = joi.object<typeof schema>(schema);
