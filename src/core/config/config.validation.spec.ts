import { configValidationSchema } from './config.validation';
import { getMultipartOptions } from '@/core/app/multipart-options';
import type { Config } from './config.types';

const requiredConfig = {
  PORT: 3007,
  NODE_ENV: 'development',
  COOKIE_SECRET: 'test-cookie-secret',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: 5432,
  POSTGRES_USER: 'test',
  POSTGRES_PASSWORD: 'test',
  POSTGRES_DB: 'test',
  JWT_SECRET: 'test-secret-at-least-thirty-two-characters',
};

const keys = [
  'TRANSFORM_TIMEOUT_MS',
  'THROTTLE_TRANSFORM_LIMIT',
  'THROTTLE_TRANSFORM_TTL',
  'TRANSFORM_MAX_SIZE_CSV',
  'TRANSFORM_MAX_SIZE_JSON',
  'TRANSFORM_MAX_SIZE_XML',
  'TRANSFORM_MAX_SIZE_YAML',
] as const;

describe('Transformation configuration', () => {
  it('supplies defaults with the expected units', () => {
    const result = configValidationSchema.validate(requiredConfig);
    const value = result.value as Config;
    expect(result.error).toBeUndefined();
    expect(value).toMatchObject({
      TRANSFORM_TIMEOUT_MS: 30_000,
      THROTTLE_TRANSFORM_LIMIT: 10,
      THROTTLE_TRANSFORM_TTL: 60,
      TRANSFORM_MAX_SIZE_CSV: 10 * 1024 * 1024,
      TRANSFORM_MAX_SIZE_JSON: 10 * 1024 * 1024,
      TRANSFORM_MAX_SIZE_XML: 10 * 1024 * 1024,
      TRANSFORM_MAX_SIZE_YAML: 5 * 1024 * 1024,
    });
  });

  it.each(keys)('accepts numeric environment strings for %s', (key) => {
    const result = configValidationSchema.validate({
      ...requiredConfig,
      [key]: '1234',
    });
    const value = result.value as Config;
    expect(result.error).toBeUndefined();
    expect(value[key]).toBe(1234);
  });

  it.each(keys)('rejects invalid values for %s', (key) => {
    for (const invalid of [0, -1, 1.5, '10 МБ']) {
      const { error } = configValidationSchema.validate({
        ...requiredConfig,
        [key]: invalid,
      });
      expect(error, `${key}: ${invalid}`).toBeDefined();
    }
  });

  it('sets the plugin limit from the largest configured format plus one byte', () => {
    const values: Partial<Config> = {
      TRANSFORM_MAX_SIZE_CSV: 100,
      TRANSFORM_MAX_SIZE_JSON: 200,
      TRANSFORM_MAX_SIZE_XML: 300,
      TRANSFORM_MAX_SIZE_YAML: 500,
    };
    const options = getMultipartOptions({
      get: (key) => String(values[key]),
    });
    expect(options.limits).toEqual({
      files: 1,
      fields: 10,
      fieldSize: 16 * 1024,
      parts: 11,
      fileSize: 501,
    });
  });
});
