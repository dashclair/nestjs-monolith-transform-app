import { configValidationSchema } from '../config.validation';
import { getMultipartOptions } from '@/core/app/multipart-options';
import type { Config } from '../config.types';

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
  'TRANSFORM_TEXT_WORKERS',
  'TRANSFORM_TEXT_MAX_DEPTH',
  'TRANSFORM_TEXT_MAX_NODES',
  'TRANSFORM_MAX_SIZE_PNG',
  'TRANSFORM_MAX_SIZE_JPEG',
  'TRANSFORM_MAX_SIZE_SVG',
  'IMAGE_MAX_INPUT_PIXELS',
  'IMAGE_SVG_MAX_WIDTH',
  'IMAGE_SVG_MAX_HEIGHT',
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
      TRANSFORM_TEXT_WORKERS: 2,
      TRANSFORM_TEXT_MAX_DEPTH: 64,
      TRANSFORM_TEXT_MAX_NODES: 1_000_000,
      TRANSFORM_MAX_SIZE_PNG: 20 * 1024 * 1024,
      TRANSFORM_MAX_SIZE_JPEG: 20 * 1024 * 1024,
      TRANSFORM_MAX_SIZE_SVG: 2 * 1024 * 1024,
      IMAGE_MAX_INPUT_PIXELS: 50_000_000,
      IMAGE_SVG_MAX_WIDTH: 4096,
      IMAGE_SVG_MAX_HEIGHT: 4096,
      IMAGE_JPEG_DEFAULT_QUALITY: 80,
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

  it.each([...keys, 'IMAGE_JPEG_DEFAULT_QUALITY'] as const)(
    'rejects invalid values for %s',
    (key) => {
      for (const invalid of [0, -1, 1.5, '10 МБ']) {
        const { error } = configValidationSchema.validate({
          ...requiredConfig,
          [key]: invalid,
        });
        expect(error, `${key}: ${invalid}`).toBeDefined();
      }
    },
  );

  it('accepts IMAGE_JPEG_DEFAULT_QUALITY from 1 to 100 only', () => {
    const validate = (quality: unknown) =>
      configValidationSchema.validate({
        ...requiredConfig,
        IMAGE_JPEG_DEFAULT_QUALITY: quality,
      });

    expect((validate('1').value as Config).IMAGE_JPEG_DEFAULT_QUALITY).toBe(1);
    expect((validate('100').value as Config).IMAGE_JPEG_DEFAULT_QUALITY).toBe(
      100,
    );
    expect(validate(101).error).toBeDefined();
  });

  it('sets the plugin limit from the largest configured format plus one byte', () => {
    const values: Partial<Config> = {
      TRANSFORM_MAX_SIZE_CSV: 100,
      TRANSFORM_MAX_SIZE_JSON: 200,
      TRANSFORM_MAX_SIZE_XML: 300,
      TRANSFORM_MAX_SIZE_YAML: 500,
      TRANSFORM_MAX_SIZE_PNG: 400,
      TRANSFORM_MAX_SIZE_JPEG: 400,
      TRANSFORM_MAX_SIZE_SVG: 50,
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

  it('includes image formats in the plugin limit', () => {
    const values: Partial<Config> = {
      TRANSFORM_MAX_SIZE_CSV: 100,
      TRANSFORM_MAX_SIZE_JSON: 200,
      TRANSFORM_MAX_SIZE_XML: 300,
      TRANSFORM_MAX_SIZE_YAML: 500,
      TRANSFORM_MAX_SIZE_PNG: 900,
      TRANSFORM_MAX_SIZE_JPEG: 700,
      TRANSFORM_MAX_SIZE_SVG: 50,
    };
    const options = getMultipartOptions({
      get: (key) => String(values[key]),
    });
    expect(options.limits?.fileSize).toBe(901);
  });
});

describe('Transformations cleanup configuration', () => {
  const validate = (overrides: Record<string, unknown>) =>
    configValidationSchema.validate({ ...requiredConfig, ...overrides });

  it('supplies defaults', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      TRANSFORMATIONS_CLEANUP_ENABLED: true,
      TRANSFORMATIONS_CLEANUP_CRON: '0 * * * *',
      TRANSFORMATIONS_CLEANUP_BATCH: 500,
    });
  });

  it('accepts environment strings', () => {
    const result = validate({
      TRANSFORMATIONS_CLEANUP_ENABLED: 'false',
      TRANSFORMATIONS_CLEANUP_CRON: '*/15 3 * * 1-5',
      TRANSFORMATIONS_CLEANUP_BATCH: '10000',
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      TRANSFORMATIONS_CLEANUP_ENABLED: false,
      TRANSFORMATIONS_CLEANUP_CRON: '*/15 3 * * 1-5',
      TRANSFORMATIONS_CLEANUP_BATCH: 10_000,
    });
  });

  it.each(['0 * * *', '61 * * * *', 'every hour', ''])(
    'rejects invalid cron expression %j',
    (cron) => {
      const { error } = validate({ TRANSFORMATIONS_CLEANUP_CRON: cron });
      expect(error?.message).toContain('TRANSFORMATIONS_CLEANUP_CRON');
    },
  );

  it.each([0, -1, 1.5, 10_001, 'many'])(
    'rejects invalid TRANSFORMATIONS_CLEANUP_BATCH %j',
    (batch) => {
      expect(
        validate({ TRANSFORMATIONS_CLEANUP_BATCH: batch }).error,
      ).toBeDefined();
    },
  );

  it('rejects a non-boolean TRANSFORMATIONS_CLEANUP_ENABLED', () => {
    expect(
      validate({ TRANSFORMATIONS_CLEANUP_ENABLED: 'yes please' }).error,
    ).toBeDefined();
  });
});
