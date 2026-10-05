import { Readable } from 'node:stream';
import type {
  Multipart,
  MultipartFile,
  MultipartValue,
} from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

import type { ConversionEngine } from '../conversion-engine';
import { readMultipart } from '../multipart-reader';
import type { Format } from '../types';

// The reader only needs parts(); HTTP, JWT and the database are unnecessary here.
function requestWith(parts: Multipart[]): FastifyRequest {
  return {
    parts: async function* () {
      for (const part of parts) yield Promise.resolve(part);
    },
  } as unknown as FastifyRequest;
}

function field(fieldname: string, value: string): MultipartValue {
  return {
    type: 'field',
    fieldname,
    value,
    fieldnameTruncated: false,
    valueTruncated: false,
    mimetype: 'text/plain',
    encoding: '7bit',
    fields: {},
  };
}

function file(chunks: Buffer[], fieldname = 'file') {
  let chunksRead = 0;
  const stream = Object.assign(
    Readable.from(
      (function* () {
        for (const chunk of chunks) {
          chunksRead += 1;
          yield chunk;
        }
      })(),
      { objectMode: false, highWaterMark: 1 },
    ),
    { truncated: false, bytesRead: 0 },
  );

  const part: MultipartFile = {
    type: 'file',
    fieldname,
    filename: 'data.json',
    mimetype: 'application/json',
    encoding: '7bit',
    fields: {},
    file: stream,
    toBuffer: () => Promise.resolve(Buffer.concat(chunks)),
  };
  return { part, stream, chunksRead: () => chunksRead };
}

function fakeEngine(limit = 8192, detected: Format | null = 'json') {
  const detectFormat = vi.fn(() => detected);
  const engine: ConversionEngine = {
    kind: 'file',
    supportedPairs: () => [],
    detectFormat,
    sizeLimit: () => limit,
    validateOptions: () => ({}),
    convert: () => Promise.reject(new Error('Reader must not convert files')),
  };
  return { engine, detectFormat };
}

describe('readMultipart', () => {
  it.each(['before', 'after'])('reads fields %s the file', async (position) => {
    const body = Buffer.from('{"name":"Alice"}');
    const upload = file([body]);
    const fields = [field('targetFormat', 'csv'), field('save', 'false')];
    const parts =
      position === 'before'
        ? [...fields, upload.part]
        : [upload.part, ...fields];

    const result = await readMultipart(requestWith(parts), fakeEngine().engine);
    expect(result).toEqual({
      body,
      source: 'json',
      fileSize: body.length,
      fields: { targetFormat: 'csv', save: 'false' },
    });
  });

  it('accepts a file exactly at its size limit and detects from the first 4 KiB', async () => {
    const chunks = [Buffer.alloc(4096, 'a'), Buffer.alloc(4096, 'b')];
    const { engine, detectFormat } = fakeEngine(8192);
    const result = await readMultipart(
      requestWith([file(chunks).part]),
      engine,
    );
    expect(result.body).toEqual(Buffer.concat(chunks));
    expect(result.fileSize).toBe(8192);
    expect(detectFormat).toHaveBeenCalledExactlyOnceWith({
      head: chunks[0],
      filename: 'data.json',
      mimetype: 'application/json',
    });
  });

  it('rejects limit + 1 byte with 413', async () => {
    const upload = file([Buffer.alloc(8193)]);
    await expect(
      readMultipart(requestWith([upload.part]), fakeEngine(8192).engine),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(upload.stream.destroyed).toBe(true);
  });

  it('stops reading the stream when the format size limit is exceeded', async () => {
    const chunks = Array.from({ length: 12 }, () => Buffer.alloc(4096));
    const upload = file(chunks);
    await expect(
      readMultipart(requestWith([upload.part]), fakeEngine(8192).engine),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(upload.stream.destroyed).toBe(true);
    expect(upload.chunksRead()).toBeLessThan(chunks.length);
  });

  it('rejects an unknown format without consuming the whole file', async () => {
    const chunks = Array.from({ length: 12 }, () => Buffer.alloc(4096));
    const upload = file(chunks);
    await expect(
      readMultipart(requestWith([upload.part]), fakeEngine(8192, null).engine),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', status: 415 });
    expect(upload.stream.destroyed).toBe(true);
    expect(upload.chunksRead()).toBeLessThan(chunks.length);
  });

  it('rejects a missing file', async () => {
    await expect(
      readMultipart(
        requestWith([field('targetFormat', 'csv')]),
        fakeEngine().engine,
      ),
    ).rejects.toMatchObject({ code: 'FILE_REQUIRED', status: 400 });
  });

  it('rejects an empty file', async () => {
    await expect(
      readMultipart(requestWith([file([]).part]), fakeEngine().engine),
    ).rejects.toMatchObject({ code: 'EMPTY_FILE', status: 400 });
  });

  it('rejects a second file', async () => {
    await expect(
      readMultipart(
        requestWith([
          file([Buffer.from('{}')]).part,
          file([Buffer.from('{}')]).part,
        ]),
        fakeEngine().engine,
      ),
    ).rejects.toMatchObject({ code: 'TOO_MANY_FILES', status: 400 });
  });

  it('rejects a file submitted under the wrong field name', async () => {
    const upload = file([Buffer.from('{}')], 'attachment');
    await expect(
      readMultipart(requestWith([upload.part]), fakeEngine().engine),
    ).rejects.toMatchObject({ code: 'INVALID_FIELDS', status: 400 });
    expect(upload.stream.destroyed).toBe(true);
  });

  it('rejects duplicate fields', async () => {
    await expect(
      readMultipart(
        requestWith([
          field('targetFormat', 'csv'),
          field('targetFormat', 'yaml'),
        ]),
        fakeEngine().engine,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FIELDS', status: 400 });
  });

  it('rejects truncated fields', async () => {
    const part = field('options', '{}');
    part.valueTruncated = true;
    await expect(
      readMultipart(requestWith([part]), fakeEngine().engine),
    ).rejects.toMatchObject({ code: 'INVALID_FIELDS', status: 400 });
  });

  it('rejects a file truncated by the plugin', async () => {
    const upload = file([Buffer.from('{}')]);
    upload.stream.truncated = true;
    await expect(
      readMultipart(requestWith([upload.part]), fakeEngine().engine),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
  });
});
