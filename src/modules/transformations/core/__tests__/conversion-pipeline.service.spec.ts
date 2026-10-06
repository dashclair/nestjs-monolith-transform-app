import { HttpStatus, StreamableFile } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RequestUser } from '@/core/auth/auth.types';
import type { ConfigService } from '@/core/config/config.service';
import type { Transformation } from '@/modules/transformations/entities/transformation.entity';

import type { ConversionEngine } from '../conversion-engine';
import { TransformationPipelineService } from '../conversion-pipeline.service';
import { readMultipart, type ReadMultipartResult } from '../multipart-reader';
import { TransformationError } from '../transformation-error';
import type { TransformationHistoryService } from '../transformation-history.service';

// Multipart parsing has its own spec; here the reader only supplies its result.
vi.mock('../multipart-reader', () => ({ readMultipart: vi.fn() }));

const BODY = Buffer.from('{"a":1}');

function fakeEngine() {
  const engine = {
    kind: 'file',
    supportedPairs: () => [
      { source: 'json', target: 'csv' },
      { source: 'csv', target: 'json' },
    ],
    detectFormat: vi.fn(),
    sizeLimit: vi.fn(),
    validateOptions: vi.fn(() => ({ applied: true })),
    convert: vi.fn<ConversionEngine['convert']>(() =>
      Promise.resolve({
        body: Buffer.from('a\n1\n'),
        mimeType: 'text/csv; charset=utf-8',
        extension: 'csv',
      }),
    ),
  } satisfies ConversionEngine;
  return engine;
}

function fakeReply() {
  const headers: Record<string, unknown> = {};
  const reply = {
    code: vi.fn(() => reply),
    headers: vi.fn((values: Record<string, unknown>) => {
      Object.assign(headers, values);
      return reply;
    }),
    header: vi.fn((name: string, value: unknown) => {
      headers[name] = value;
      return reply;
    }),
  };
  return { reply: reply as unknown as FastifyReply, code: reply.code, headers };
}

// The reader reports progress before it fails or returns, like the real one.
function readerReturns(fields: Record<string, unknown>) {
  vi.mocked(readMultipart).mockImplementation(
    (_request, _engine, onProgress) => {
      onProgress?.({ fileSize: BODY.length, sourceFormat: 'json' });
      const result: ReadMultipartResult = {
        body: BODY,
        source: 'json',
        fileSize: BODY.length,
        fields,
      };
      return Promise.resolve(result);
    },
  );
}

async function readStream(file: StreamableFile) {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

describe('TransformationPipelineService', () => {
  const request = {
    user: { userId: 'user-1' },
  } as FastifyRequest & { user: RequestUser };
  const history = {
    write: vi.fn<TransformationHistoryService['write']>(() =>
      Promise.resolve({ id: 'history-1' } as Transformation),
    ),
  };
  const config = { get: vi.fn(() => '1000') };
  let engine: ReturnType<typeof fakeEngine>;
  let pipeline: TransformationPipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue('1000');
    engine = fakeEngine();
    pipeline = new TransformationPipelineService(
      history as unknown as TransformationHistoryService,
      config as unknown as ConfigService,
    );
    readerReturns({ targetFormat: 'csv' });
  });

  const run = (reply = fakeReply().reply) =>
    pipeline.run(engine, request, reply);

  const historyEntry = () => history.write.mock.calls[0][0];

  describe('success', () => {
    it('converts, writes a success entry and returns the file with headers', async () => {
      const { reply, code, headers } = fakeReply();

      const file = await run(reply);

      await expect(readStream(file)).resolves.toBe('a\n1\n');
      expect(code).toHaveBeenCalledWith(HttpStatus.OK);
      expect(headers).toEqual({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="converted.csv"',
        'X-Transformation-Id': 'history-1',
      });
      expect(history.write).toHaveBeenCalledExactlyOnceWith({
        userId: 'user-1',
        type: 'file',
        sourceFormat: 'json',
        targetFormat: 'csv',
        fileSize: BODY.length,
        options: { applied: true },
        durationMs: expect.any(Number) as unknown,
        status: 'success',
        errorCode: null,
      });
    });

    it('hands the engine the validated options, not the raw field', async () => {
      readerReturns({ targetFormat: 'csv', options: '{"raw":1}' });

      await run();

      expect(engine.validateOptions).toHaveBeenCalledWith('json', 'csv', {
        raw: 1,
      });
      expect(engine.convert.mock.calls[0][0]).toEqual({
        source: 'json',
        target: 'csv',
        body: BODY,
        options: { applied: true },
      });
    });

    it('passes an empty object to validateOptions when options are absent', async () => {
      await run();

      expect(engine.validateOptions).toHaveBeenCalledWith('json', 'csv', {});
    });

    it.each(['true', 'false'])('accepts save=%s', async (save) => {
      readerReturns({ targetFormat: 'csv', save });

      await expect(run()).resolves.toBeInstanceOf(StreamableFile);
    });

    it('still returns the file when the history write fails', async () => {
      history.write.mockResolvedValueOnce(null);
      const { reply, headers } = fakeReply();

      await expect(run(reply)).resolves.toBeInstanceOf(StreamableFile);
      expect(headers).not.toHaveProperty('X-Transformation-Id');
    });
  });

  describe('errors', () => {
    it('records reader errors with the progress reported so far', async () => {
      const error = new TransformationError(
        'UNSUPPORTED_FORMAT',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'Unsupported file format',
      );
      vi.mocked(readMultipart).mockImplementation(
        (_req, _engine, onProgress) => {
          onProgress?.({ fileSize: 4096, sourceFormat: null });
          return Promise.reject(error);
        },
      );

      await expect(run()).rejects.toBe(error);
      expect(historyEntry()).toMatchObject({
        status: 'error',
        errorCode: 'UNSUPPORTED_FORMAT',
        sourceFormat: null,
        targetFormat: null,
        fileSize: 4096,
        options: null,
      });
      expect(engine.convert).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing targetFormat', {}],
      ['an unknown targetFormat', { targetFormat: 'pdf' }],
      ['an unknown field', { targetFormat: 'csv', extra: '1' }],
      ['an invalid save value', { targetFormat: 'csv', save: 'yes' }],
    ])('rejects %s with 400 INVALID_FIELDS', async (_case, fields) => {
      readerReturns(fields);

      await expect(run()).rejects.toMatchObject({
        code: 'INVALID_FIELDS',
        status: 400,
      });
      expect(historyEntry()).toMatchObject({
        errorCode: 'INVALID_FIELDS',
        sourceFormat: 'json',
        targetFormat: null,
      });
    });

    it('rejects a known format the engine cannot produce as INVALID_FIELDS', async () => {
      readerReturns({ targetFormat: 'png' });

      await expect(run()).rejects.toMatchObject({ code: 'INVALID_FIELDS' });
      expect(historyEntry()).toMatchObject({ targetFormat: null });
    });

    it('rejects a pair outside supportedPairs with UNSUPPORTED_DIRECTION', async () => {
      readerReturns({ targetFormat: 'json' });

      await expect(run()).rejects.toMatchObject({
        code: 'UNSUPPORTED_DIRECTION',
        status: 400,
      });
      expect(historyEntry()).toMatchObject({
        sourceFormat: 'json',
        targetFormat: 'json',
      });
    });

    it('rejects options that are not JSON', async () => {
      readerReturns({ targetFormat: 'csv', options: '{oops' });

      await expect(run()).rejects.toMatchObject({ code: 'INVALID_FIELDS' });
      expect(engine.validateOptions).not.toHaveBeenCalled();
    });

    it('records INVALID_OPTIONS from the engine', async () => {
      engine.validateOptions.mockImplementationOnce(() => {
        throw new TransformationError(
          'INVALID_OPTIONS',
          HttpStatus.BAD_REQUEST,
          'Bad options',
        );
      });

      await expect(run()).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
      expect(historyEntry()).toMatchObject({
        errorCode: 'INVALID_OPTIONS',
        options: null,
      });
    });

    it('passes engine errors through and records their code', async () => {
      engine.convert.mockRejectedValueOnce(
        new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, 'Bad'),
      );

      await expect(run()).rejects.toMatchObject({
        code: 'PARSE_ERROR',
        status: 400,
      });
      expect(historyEntry()).toMatchObject({
        status: 'error',
        errorCode: 'PARSE_ERROR',
        options: { applied: true },
      });
    });

    it('times out with 408 and aborts the engine signal', async () => {
      config.get.mockReturnValue('20');
      let signal: AbortSignal | undefined;
      engine.convert.mockImplementationOnce((_req, engineSignal) => {
        signal = engineSignal;
        return new Promise(() => undefined);
      });

      await expect(run()).rejects.toMatchObject({
        code: 'CONVERSION_TIMEOUT',
        status: HttpStatus.REQUEST_TIMEOUT,
      });
      expect(config.get).toHaveBeenCalledWith('TRANSFORM_TIMEOUT_MS');
      expect(signal?.aborted).toBe(true);
      expect(historyEntry()).toMatchObject({ errorCode: 'CONVERSION_TIMEOUT' });
    });

    it('turns an unexpected error into 500 without leaking its text', async () => {
      engine.convert.mockRejectedValueOnce(new Error('secret stack details'));

      const error = (await run().catch(
        (e: unknown) => e,
      )) as TransformationError;

      expect(error).toBeInstanceOf(TransformationError);
      expect(error).toMatchObject({
        code: 'INTERNAL_ERROR',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
      expect(error.message).not.toContain('secret');
      expect(historyEntry()).toMatchObject({ errorCode: 'INTERNAL_ERROR' });
    });

    it('rethrows the conversion error even when the history write fails', async () => {
      history.write.mockResolvedValueOnce(null);
      engine.convert.mockRejectedValueOnce(
        new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, 'Bad'),
      );

      await expect(run()).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    });
  });
});
