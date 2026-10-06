import { PATH_METADATA } from '@nestjs/common/constants';
import type { StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { TextTransformationController } from '../text-transformation.controller';
import type { TextTransformationService } from '../text-transformation.service';
import type { TransformationPipelineService } from '../../core/conversion-pipeline.service';

// @nestjs/throttler stores per-throttler values under this prefix + name.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

// Route decorators put their metadata on the handler function itself.
const handler = (name: 'convert' | 'getFormats') =>
  Object.getOwnPropertyDescriptor(TextTransformationController.prototype, name)
    ?.value as object;

describe('TextTransformationController', () => {
  const file = {} as StreamableFile;
  const pipeline = { run: vi.fn(() => Promise.resolve(file)) };
  const engine = { getFormats: vi.fn(() => []) };
  const controller = new TextTransformationController(
    pipeline as unknown as TransformationPipelineService,
    engine as unknown as TextTransformationService,
  );

  afterEach(() => vi.unstubAllEnvs());

  it('is mounted at /api/convert', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, TextTransformationController),
    ).toBe('api/convert');
  });

  it('hands the request to the pipeline with the text engine', async () => {
    const request = { user: { userId: 'user-1' } } as never;
    const reply = {} as FastifyReply;

    await expect(controller.convert(request, reply)).resolves.toBe(file);
    expect(pipeline.run).toHaveBeenCalledExactlyOnceWith(
      engine,
      request,
      reply,
    );
  });

  it('returns the engine formats', () => {
    controller.getFormats();

    expect(engine.getFormats).toHaveBeenCalledOnce();
  });

  it('throttles POST with THROTTLE_TRANSFORM_* (ttl in seconds)', () => {
    vi.stubEnv('THROTTLE_TRANSFORM_LIMIT', '5');
    vi.stubEnv('THROTTLE_TRANSFORM_TTL', '30');

    const limit = Reflect.getMetadata(
      `${THROTTLER_LIMIT}default`,
      handler('convert'),
    ) as (() => number) | undefined;
    const ttl = Reflect.getMetadata(
      `${THROTTLER_TTL}default`,
      handler('convert'),
    ) as (() => number) | undefined;

    expect(limit?.()).toBe(5);
    expect(ttl?.()).toBe(30_000);
  });

  it('leaves GET /formats on the global limit', () => {
    expect(
      Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler('getFormats')),
    ).toBeUndefined();
  });
});
