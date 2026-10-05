import { HttpStatus } from '@nestjs/common';
import { ConversionEngine } from './conversion-engine';
import { Format } from './types';
import type { FastifyRequest } from 'fastify';
import { TransformationError } from './transformation-error';
import { ProgressCallback } from './conversion-pipeline.service';

const DETECT_HEAD_BYTES = 4 * 1024;

export interface ReadMultipartResult {
  body: Buffer;
  source: Format;
  fileSize: number;
  fields: Record<string, unknown>;
}

export async function readMultipart(
  request: FastifyRequest,
  engine: ConversionEngine,
  onProgress?: (progress: ProgressCallback) => void,
): Promise<ReadMultipartResult> {
  const fields: Record<string, unknown> = {};
  const chunks: Buffer[] = [];

  let fileFound = false;
  let fileSize = 0;
  let source: Format | null = null;

  const reportProgress = () => {
    onProgress?.({ fileSize, sourceFormat: source });
  };

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (
          Object.hasOwn(fields, part.fieldname) ||
          part.fieldnameTruncated ||
          part.valueTruncated
        ) {
          throw new TransformationError(
            'INVALID_FIELDS',
            HttpStatus.BAD_REQUEST,
            'Invalid or duplicate fields',
          );
        }
        fields[part.fieldname] = part.value;

        continue;
      }

      if (fileFound) {
        part.file.destroy();

        throw new TransformationError(
          'TOO_MANY_FILES',
          HttpStatus.BAD_REQUEST,
          'Only one file is allowed',
        );
      }

      if (part.fieldname !== 'file') {
        part.file.destroy();

        throw new TransformationError(
          'INVALID_FIELDS',
          HttpStatus.BAD_REQUEST,
          'The file must be submitted in the file field',
        );
      }

      fileFound = true;

      let head = Buffer.alloc(0);

      const detectSource = (): Format => {
        const detected = engine.detectFormat({
          head,
          filename: part.filename,
          mimetype: part.mimetype,
        });

        if (detected === null) {
          throw new TransformationError(
            'UNSUPPORTED_FORMAT',
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            'Unsupported file format',
          );
        }

        return detected;
      };

      try {
        for await (const rawChunk of part.file as AsyncIterable<
          Buffer | Uint8Array
        >) {
          const chunk = Buffer.isBuffer(rawChunk)
            ? rawChunk
            : Buffer.from(rawChunk);

          fileSize += chunk.length;

          reportProgress();

          if (head.length < DETECT_HEAD_BYTES) {
            const remaining = DETECT_HEAD_BYTES - head.length;

            head = Buffer.concat([head, chunk.subarray(0, remaining)]);
          }

          if (source === null && head.length === DETECT_HEAD_BYTES) {
            source = detectSource();
            reportProgress();
          }

          if (source !== null && fileSize > engine.sizeLimit(source)) {
            throw new TransformationError(
              'PAYLOAD_TOO_LARGE',
              HttpStatus.PAYLOAD_TOO_LARGE,
              'File exceeds the maximum allowed size',
            );
          }

          chunks.push(chunk);
        }

        if (part.file.truncated) {
          throw new TransformationError(
            'PAYLOAD_TOO_LARGE',
            HttpStatus.PAYLOAD_TOO_LARGE,
            'File exceeds the maximum allowed size',
          );
        }

        if (fileSize === 0) {
          throw new TransformationError(
            'EMPTY_FILE',
            HttpStatus.BAD_REQUEST,
            'File is empty',
          );
        }

        if (source === null) {
          source = detectSource();
          reportProgress();
        }

        if (fileSize > engine.sizeLimit(source)) {
          throw new TransformationError(
            'PAYLOAD_TOO_LARGE',
            HttpStatus.PAYLOAD_TOO_LARGE,
            'File exceeds the maximum allowed size',
          );
        }
      } catch (error) {
        part.file.destroy();
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof TransformationError) {
      throw error;
    }

    if (error instanceof Error && 'code' in error) {
      switch (error.code) {
        case 'FST_FILES_LIMIT':
          throw new TransformationError(
            'TOO_MANY_FILES',
            HttpStatus.BAD_REQUEST,
            'Only one file is allowed',
          );

        case 'FST_REQ_FILE_TOO_LARGE':
          throw new TransformationError(
            'PAYLOAD_TOO_LARGE',
            HttpStatus.PAYLOAD_TOO_LARGE,
            'File exceeds the size limit',
          );

        case 'FST_FIELDS_LIMIT':
        case 'FST_PARTS_LIMIT':
          throw new TransformationError(
            'INVALID_FIELDS',
            HttpStatus.BAD_REQUEST,
            'Too many multipart fields or parts',
          );

        case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
        case 'FST_INVALID_JSON_FIELD_ERROR':
        case 'FST_PROTO_VIOLATION':
        case 'FST_MP_PREMATURE_CLOSE':
          throw new TransformationError(
            'INVALID_FIELDS',
            HttpStatus.BAD_REQUEST,
            'Invalid multipart request',
          );
      }
    }

    throw error;
  }

  if (!fileFound || source === null) {
    throw new TransformationError(
      'FILE_REQUIRED',
      HttpStatus.BAD_REQUEST,
      'A file is required',
    );
  }

  return {
    body: Buffer.concat(chunks, fileSize),
    source,
    fileSize,
    fields,
  };
}
