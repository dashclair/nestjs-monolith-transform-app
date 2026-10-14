import { HttpStatus, Logger, StreamableFile } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RequestUser } from '@/core/auth/auth.types';
import type { ConfigService } from '@/core/config/config.service';
import type { Transformation } from '@/modules/transformations/entities/transformation.entity';

import type { ConversionEngine } from '../conversion-engine';
import { TransformationPipelineService } from '../conversion-pipeline.service';
import { readMultipart, type ReadMultipartResult } from '../multipart-reader';
import { TransformationError } from '../transformation-error';
import type { TransformationHistoryService } from '../transformation-history.service';
import type { TransformationsStorageService } from '../transformations-storage.service';

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
    getFormats: () => [],
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
function readerReturns(
  fields: Record<string, unknown>,
  originalFileName: string | null = null,
) {
  vi.mocked(readMultipart).mockImplementation(
    (_request, _engine, onProgress) => {
      onProgress?.({ fileSize: BODY.length, sourceFormat: 'json' });
      const result: ReadMultipartResult = {
        body: BODY,
        source: 'json',
        fileSize: BODY.length,
        fields,
        originalFileName,
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
  const config = { get: vi.fn<(key: string) => string>(() => '1000') };
  const storage = { saveResult: vi.fn(() => Promise.resolve()) };
  let engine: ReturnType<typeof fakeEngine>;
  let pipeline: TransformationPipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue('1000');
    engine = fakeEngine();
    pipeline = new TransformationPipelineService(
      history as unknown as TransformationHistoryService,
      config as unknown as ConfigService,
      storage as unknown as TransformationsStorageService,
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
        id: expect.any(String) as unknown,
        userId: 'user-1',
        type: 'file',
        sourceFormat: 'json',
        targetFormat: 'csv',
        fileSize: BODY.length,
        options: { applied: true },
        durationMs: expect.any(Number) as unknown,
        status: 'success',
        errorCode: null,
        storageKey: null,
        fileStatus: null,
        resultMimeType: 'text/csv; charset=utf-8',
        resultSize: 4,
        resultFileName: 'converted.csv',
      });
    });

    it.each([
      ['swaps the extension', 'report.json', 'report.csv'],
      ['keeps inner dots', 'q3.final.json', 'q3.final.csv'],
      ['strips a POSIX path', '../../etc/data.json', 'data.csv'],
      ['strips a Windows path', 'C:\\fakepath\\data.json', 'data.csv'],
      ['strips control characters', 'a\r\nb.json', 'ab.csv'],
      ['falls back without a name', null, 'converted.csv'],
      ['falls back when nothing is left', '\u0000.json', 'converted.csv'],
    ])('resultFileName %s', async (_label, originalFileName, expected) => {
      readerReturns({ targetFormat: 'csv' }, originalFileName);

      await run();

      expect(historyEntry()).toMatchObject({ resultFileName: expected });
    });

    it('caps the resultFileName base at 200 characters', async () => {
      readerReturns({ targetFormat: 'csv' }, `${'a'.repeat(300)}.json`);

      await run();

      expect(historyEntry().resultFileName).toBe(`${'a'.repeat(200)}.csv`);
    });

    it('takes the resultFileName extension from the engine, not targetFormat', async () => {
      engine.convert.mockResolvedValueOnce({
        body: Buffer.from('x'),
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });

      await run();

      expect(historyEntry().resultFileName).toBe('converted.jpg');
    });

    it('records the options the engine reports as applied', async () => {
      engine.convert.mockResolvedValueOnce({
        body: Buffer.from('x'),
        mimeType: 'image/png',
        extension: 'png',
        options: { applied: true, width: 512 },
      });

      await run();

      expect(historyEntry()).toMatchObject({
        status: 'success',
        options: { applied: true, width: 512 },
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

  describe('saving the result', () => {
    it('writes a pending entry keyed by its own id and saves it', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });

      await run();

      const entry = historyEntry();
      expect(entry.id).toEqual(expect.any(String));
      expect(entry).toMatchObject({
        fileStatus: 'pending',
        storageKey: `transformations/user-1/${entry.id}.csv`,
      });
      expect(storage.saveResult).toHaveBeenCalledExactlyOnceWith(
        { id: 'history-1' },
        expect.objectContaining({ extension: 'csv' }),
      );
    });

    it('responds without waiting for the save to finish', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      storage.saveResult.mockReturnValueOnce(new Promise(() => undefined));

      await expect(run()).resolves.toBeInstanceOf(StreamableFile);
    });

    it('skips a result larger than STORAGE_MAX_FILE_BYTES', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      config.get.mockImplementation((key: string) =>
        key === 'STORAGE_MAX_FILE_BYTES' ? '3' : '1000',
      );

      await expect(run()).resolves.toBeInstanceOf(StreamableFile);
      expect(config.get).toHaveBeenCalledWith('STORAGE_MAX_FILE_BYTES');
      expect(historyEntry()).toMatchObject({
        fileStatus: 'skipped',
        storageKey: null,
      });
      expect(storage.saveResult).not.toHaveBeenCalled();
    });

    it('does not save when the history write fails', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      history.write.mockResolvedValueOnce(null);

      await expect(run()).resolves.toBeInstanceOf(StreamableFile);
      expect(storage.saveResult).not.toHaveBeenCalled();
    });

    it.each([
      ['absent', { targetFormat: 'csv' }],
      ['false', { targetFormat: 'csv', save: 'false' }],
    ])('does not save when save is %s', async (_case, fields) => {
      readerReturns(fields);

      await run();

      expect(historyEntry()).toMatchObject({
        fileStatus: null,
        storageKey: null,
      });
      expect(storage.saveResult).not.toHaveBeenCalled();
    });

    it('keeps file fields out of the error entry', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      engine.convert.mockRejectedValueOnce(
        new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, 'Bad'),
      );

      await expect(run()).rejects.toMatchObject({ code: 'PARSE_ERROR' });
      expect(historyEntry()).not.toHaveProperty('storageKey');
      expect(historyEntry()).not.toHaveProperty('fileStatus');
      expect(storage.saveResult).not.toHaveBeenCalled();
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

    it('rejects options that are not JSON as INVALID_OPTIONS', async () => {
      readerReturns({ targetFormat: 'csv', options: '{oops' });

      await expect(run()).rejects.toMatchObject({
        code: 'INVALID_OPTIONS',
        status: 400,
      });
      expect(engine.validateOptions).not.toHaveBeenCalled();
      expect(historyEntry()).toMatchObject({
        errorCode: 'INVALID_OPTIONS',
        options: null,
      });
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

  describe('logging', () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const error = vi.spyOn(Logger.prototype, 'error');

    beforeEach(() => {
      for (const spy of [log, warn, error]) {
        spy.mockReset().mockImplementation(() => undefined);
      }
    });

    afterAll(() => {
      for (const spy of [log, warn, error]) {
        spy.mockRestore();
      }
    });

    it('logs a success with formats, sizes and the history id', async () => {
      await run();

      expect(log).toHaveBeenCalledExactlyOnceWith({
        event: 'transformation.convert.success',
        userId: 'user-1',
        type: 'file',
        sourceFormat: 'json',
        targetFormat: 'csv',
        fileSize: BODY.length,
        outputSize: 4,
        durationMs: expect.any(Number) as unknown,
        transformationId: 'history-1',
      });
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it('logs a skipped save of a too large result as a warning', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      config.get.mockImplementation((key: string) =>
        key === 'STORAGE_MAX_FILE_BYTES' ? '3' : '1000',
      );

      await run();

      expect(warn).toHaveBeenCalledExactlyOnceWith({
        event: 'transformation.file.save_skipped',
        userId: 'user-1',
        transformationId: 'history-1',
        storageKey: null,
        resultSize: 4,
        reason: 'too_large',
      });
    });

    it('logs a skipped save when the history write fails', async () => {
      readerReturns({ targetFormat: 'csv', save: 'true' });
      history.write.mockResolvedValueOnce(null);

      await run();

      expect(warn).toHaveBeenCalledExactlyOnceWith({
        event: 'transformation.file.save_skipped',
        userId: 'user-1',
        transformationId: null,
        storageKey: null,
        resultSize: 4,
        reason: 'history_write_failed',
      });
    });

    it('logs a client error as a warning with its code and status', async () => {
      engine.convert.mockRejectedValueOnce(
        new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, 'Bad'),
      );

      await expect(run()).rejects.toMatchObject({ code: 'PARSE_ERROR' });

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          event: 'transformation.convert.failed',
          errorCode: 'PARSE_ERROR',
          status: HttpStatus.BAD_REQUEST,
          sourceFormat: 'json',
          targetFormat: 'csv',
        }),
      );
      expect(error).not.toHaveBeenCalled();
    });

    it('logs an unexpected error with the original stack', async () => {
      const cause = new Error('secret stack details');
      engine.convert.mockRejectedValueOnce(cause);

      await expect(run()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          event: 'transformation.convert.failed',
          errorCode: 'INTERNAL_ERROR',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
        cause.stack,
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
