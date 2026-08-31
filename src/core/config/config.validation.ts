import Joi from 'joi';

import { Config } from './config.types';

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production').required(),
  APP_NAME: Joi.string().default('Prism'),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('1'),
  SWAGGER_PATH: Joi.string().default('api/docs'),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(false),
  HEALTH_DISK_PATH: Joi.string().optional(),
  HEALTH_DISK_THRESHOLD: Joi.number().min(0).max(1).optional().default(0.9),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),

  /**
   * Auth / JWT options
   */
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().optional().default('15m'),
  JWT_REFRESH_TTL: Joi.string().optional().default('7d'),

  /**
   * File transformation storage options
   */
  STORAGE_DRIVER: Joi.string().valid('local', 's3').optional().default('local'),
  STORAGE_LOCAL_PATH: Joi.string().optional().default('./storage'),
  STORAGE_S3_BUCKET: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  STORAGE_S3_REGION: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  STORAGE_S3_ENDPOINT: Joi.string().optional(),
});
