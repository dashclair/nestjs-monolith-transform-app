import type { ConfigService } from '@/core/config/config.service';

import { InlineRunner } from '../runner/inline.runner';
import { TextTransformationService } from '../text-transformation.service';
import type { DetectInput, TextFormat } from '../../core/types';

// ConfigService returns raw strings — the fake does the same, so missing
// Number() coercion in the service would show up here.
const CONFIG: Record<string, string> = {
  TRANSFORM_MAX_SIZE_CSV: '100',
  TRANSFORM_MAX_SIZE_JSON: '200',
  TRANSFORM_MAX_SIZE_XML: '300',
  TRANSFORM_MAX_SIZE_YAML: '400',
  TRANSFORM_TEXT_MAX_DEPTH: '64',
  TRANSFORM_TEXT_MAX_NODES: '1000',
};

function createService(overrides: Record<string, string> = {}) {
  const values = { ...CONFIG, ...overrides };
  const config = { get: (key: string) => values[key] } as ConfigService;
  return new TextTransformationService(config, new InlineRunner());
}

const detect = (head: string | Buffer, hints: Partial<DetectInput> = {}) =>
  createService().detectFormat({
    head: Buffer.isBuffer(head) ? head : Buffer.from(head),
    ...hints,
  });

describe('TextTransformationService', () => {
  describe('supported pairs', () => {
    it('derives all 12 directions from the registries, without identity pairs', () => {
      const pairs = createService().supportedPairs();

      expect(pairs).toHaveLength(12);
      expect(pairs.some(({ source, target }) => source === target)).toBe(false);
    });

    it('groups targets by source for GET /formats', () => {
      expect(createService().getFormats()).toEqual([
        { source: 'csv', target: ['json', 'xml', 'yaml'] },
        { source: 'json', target: ['csv', 'xml', 'yaml'] },
        { source: 'xml', target: ['csv', 'json', 'yaml'] },
        { source: 'yaml', target: ['csv', 'json', 'xml'] },
      ]);
    });
  });

  describe('detectFormat', () => {
    it.each<[string, TextFormat]>([
      ['data.csv', 'csv'],
      ['data.JSON', 'json'],
      ['data.xml', 'xml'],
      ['data.yaml', 'yaml'],
      ['data.YML', 'yaml'],
    ])('detects %s by extension', (filename, format) => {
      expect(detect('a,b', { filename })).toBe(format);
    });

    it('prefers the extension over the content', () => {
      expect(detect('{"a":1}', { filename: 'data.yaml' })).toBe('yaml');
      expect(detect('<a/>', { filename: 'data.csv' })).toBe('csv');
    });

    it.each<[string, TextFormat]>([
      ['{"a":1}', 'json'],
      ['  \n[1]', 'json'],
      ['﻿<a/>', 'xml'],
    ])('sniffs %j by its first non-blank character', (head, format) => {
      expect(detect(head, { filename: 'upload.txt' })).toBe(format);
    });

    it('treats a bare name like "csv" as having no extension', () => {
      expect(detect('{}', { filename: 'csv' })).toBe('json');
    });

    it('falls back to the client MIME type for CSV and YAML', () => {
      expect(detect('a,b', { mimetype: 'text/csv; charset=utf-8' })).toBe(
        'csv',
      );
      expect(detect('a: 1', { mimetype: 'application/x-yaml' })).toBe('yaml');
    });

    it('prefers the content over the client MIME type', () => {
      expect(detect('{}', { mimetype: 'text/csv' })).toBe('json');
    });

    it('returns null when nothing identifies the format', () => {
      expect(
        detect('a,b', { filename: 'data.txt', mimetype: 'text/plain' }),
      ).toBeNull();
    });

    it('rejects a binary file with 415 even when the extension is textual', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);

      expect(() => detect(png, { filename: 'data.csv' })).toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_FORMAT', status: 415 }),
      );
    });

    it('rejects invalid UTF-8 in the head', () => {
      expect(() => detect(Buffer.from([0x7b, 0xc3, 0x28]))).toThrow(
        expect.objectContaining({ code: 'INVALID_ENCODING' }),
      );
    });

    it('accepts a head cut in the middle of a multi-byte character', () => {
      // `{` `"` and the first of the two bytes of `и`.
      const head = Buffer.from('{"имя"', 'utf8').subarray(0, 3);

      expect(() =>
        new TextDecoder('utf-8', { fatal: true }).decode(head),
      ).toThrow();
      expect(detect(head)).toBe('json');
    });
  });

  it('reads the per-format size limit as a number', () => {
    const service = createService();

    expect(service.sizeLimit('csv')).toBe(100);
    expect(service.sizeLimit('yaml')).toBe(400);
  });

  describe('validateOptions', () => {
    it('accepts an empty object', () => {
      expect(createService().validateOptions('json', 'csv', {})).toEqual({});
    });

    it.each([{ delimiter: ';' }, null, [], 'x'])(
      'rejects %j with INVALID_OPTIONS',
      (raw) => {
        expect(() =>
          createService().validateOptions('json', 'csv', raw),
        ).toThrow(
          expect.objectContaining({ code: 'INVALID_OPTIONS', status: 400 }),
        );
      },
    );
  });

  describe('convert', () => {
    const request = (body: string, target: TextFormat = 'csv') => ({
      source: 'json' as const,
      target,
      body: Buffer.from(body),
      options: {},
    });

    it('returns the body with the target MIME type and extension', async () => {
      const result = await createService().convert(
        request('[{"a":1}]'),
        new AbortController().signal,
      );

      expect(result).toEqual({
        body: Buffer.from('a\n1\n'),
        mimeType: 'text/csv; charset=utf-8',
        extension: 'csv',
      });
    });

    it('throws the worker error as a TransformationError', async () => {
      await expect(
        createService().convert(request('{"a":'), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'PARSE_ERROR', status: 400 });
    });

    it('maps the worker catch-all INTERNAL_ERROR to 500', async () => {
      const runner = new InlineRunner();
      vi.spyOn(runner, 'run').mockResolvedValueOnce({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      const config = { get: (key: string) => CONFIG[key] } as ConfigService;

      await expect(
        new TextTransformationService(config, runner).convert(
          request('{}'),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    });

    it('passes the structure limits from config to the worker', async () => {
      const service = createService({ TRANSFORM_TEXT_MAX_DEPTH: '2' });

      await expect(
        service.convert(request('[[1]]', 'yaml'), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'STRUCTURE_TOO_LARGE' });
    });
  });
});
