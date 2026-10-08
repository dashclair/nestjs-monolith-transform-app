import { HttpStatus } from '@nestjs/common';
import { TransformationError } from '../../core/transformation-error';

// sharp/libvips report everything as a plain Error, so the class is read from
// the message. Messages as of sharp 0.35 / libvips 8.18, e.g.
//   "Input buffer has corrupt header: VipsJpeg: premature end of JPEG image"
//   "vipspng: libpng read error"
//   "Input buffer has corrupt header: glib: XML parse error: …"
//   "Input buffer has corrupt header: svgload_buffer: bad dimensions"
//   "Input image exceeds pixel limit"
const PIXEL_LIMIT = /exceeds pixel limit/i;
// librsvg found no size at all: no width/height/viewBox and nothing drawn,
// or a zero size. Checked before BAD_INPUT, which would also match.
const NO_SVG_SIZE = /svgload.*bad dimensions/i;
const TIMEOUT = /timeout/i;
const BAD_INPUT =
  /^Input (buffer|file)|corrupt|premature end|VipsJpeg|vipspng|libpng|load_buffer|XML parse/i;

// The sharp message is never sent to the client: it can contain parser
// internals and fragments of the file.
export function toTransformationError(error: unknown): TransformationError {
  if (error instanceof TransformationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : '';

  if (PIXEL_LIMIT.test(message)) {
    return new TransformationError(
      'DIMENSIONS_EXCEEDED',
      HttpStatus.BAD_REQUEST,
      'Image dimensions exceed the allowed maximum',
    );
  }

  if (NO_SVG_SIZE.test(message)) {
    return new TransformationError(
      'PARSE_ERROR',
      HttpStatus.BAD_REQUEST,
      'Could not determine the SVG size: set width/height or a viewBox',
    );
  }

  if (TIMEOUT.test(message)) {
    return new TransformationError(
      'CONVERSION_TIMEOUT',
      HttpStatus.REQUEST_TIMEOUT,
      'Conversion timed out',
    );
  }

  if (BAD_INPUT.test(message)) {
    return new TransformationError(
      'PARSE_ERROR',
      HttpStatus.BAD_REQUEST,
      'The image is invalid or corrupted',
    );
  }

  return new TransformationError(
    'INTERNAL_ERROR',
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Internal server error',
  );
}
