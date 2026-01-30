import * as joi from 'joi';

const schema = {
  FS_DATA_DIRECTORY_PATH: joi.string().optional(),
};

export const fsConfigSchema = joi.object<typeof schema>(schema);
