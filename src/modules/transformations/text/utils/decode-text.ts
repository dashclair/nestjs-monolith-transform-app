import { HttpStatus } from '@nestjs/common';
import { TransformationError } from '../../core/transformation-error';

export const decodeText = (buffer: Buffer) => {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0xfe &&
    buffer[3] === 0xff
  ) {
    throw new TransformationError(
      'INVALID_ENCODING',
      HttpStatus.BAD_REQUEST,
      'Invalid encoding',
    );
  }

  // UTF-32 LE: FF FE 00 00
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xfe &&
    buffer[2] === 0x00 &&
    buffer[3] === 0x00
  ) {
    throw new TransformationError(
      'INVALID_ENCODING',
      HttpStatus.BAD_REQUEST,
      'Invalid encoding',
    );
  }

  // UTF-16 LE: FF FE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    throw new TransformationError(
      'INVALID_ENCODING',
      HttpStatus.BAD_REQUEST,
      'Invalid encoding',
    );
  }

  // UTF-16 BE: FE FF
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    throw new TransformationError(
      'INVALID_ENCODING',
      HttpStatus.BAD_REQUEST,
      'Invalid encoding',
    );
  }

  let bytes = buffer;

  // UTF-8 BOM: EF BB BF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    bytes = buffer.subarray(3);
  }

  let text: string;

  try {
    text = new TextDecoder('utf-8', {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new TransformationError(
      'INVALID_ENCODING',
      HttpStatus.BAD_REQUEST,
      'Invalid encoding',
    );
  }

  if (text.trim().length === 0) {
    throw new TransformationError(
      'EMPTY_FILE',
      HttpStatus.BAD_REQUEST,
      'Empty file',
    );
  }

  return text;
};

// The head is cut at a fixed byte count and can end in the middle of a
// multi-byte character (Cyrillic, emoji); the strict decoder would reject that
// as INVALID_ENCODING. Drop only that incomplete trailing sequence — any other
// invalid byte still fails, and the full body is decoded strictly in the worker.
const trimIncompleteUtf8Tail = (buffer: Buffer): Buffer => {
  let start = buffer.length - 1;

  // Step back over at most 3 continuation bytes (10xxxxxx) to the lead byte.
  while (
    start >= 0 &&
    start > buffer.length - 4 &&
    (buffer[start] & 0xc0) === 0x80
  ) {
    start--;
  }

  if (start < 0) {
    return buffer;
  }

  const lead = buffer[start];
  const expected =
    lead >= 0xf0 && lead <= 0xf7 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;

  return buffer.length - start < expected ? buffer.subarray(0, start) : buffer;
};

export const decodeHead = (head: Buffer) =>
  decodeText(trimIncompleteUtf8Tail(head));
