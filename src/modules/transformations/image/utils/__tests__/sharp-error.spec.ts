import { TransformationError } from '../../../core/transformation-error';
import { toTransformationError } from '../sharp-error';

describe('toTransformationError', () => {
  it.each([
    [
      'Input buffer has corrupt header: VipsJpeg: premature end of JPEG image',
      'PARSE_ERROR',
      400,
    ],
    ['vipspng: libpng read error', 'PARSE_ERROR', 400],
    ['Input buffer contains unsupported image format', 'PARSE_ERROR', 400],
    [
      'Input buffer has corrupt header: glib: XML parse error: Error domain 1',
      'PARSE_ERROR',
      400,
    ],
    ['Input image exceeds pixel limit', 'DIMENSIONS_EXCEEDED', 400],
    ['timeout: 12% complete', 'CONVERSION_TIMEOUT', 408],
    [
      'Expected positive integer for width but received -1',
      'INTERNAL_ERROR',
      500,
    ],
    ['something unexpected', 'INTERNAL_ERROR', 500],
  ])('maps "%s" to %s', (message, code, status) => {
    const error = toTransformationError(new Error(message));

    expect(error.code).toBe(code);
    expect(error.getStatus()).toBe(status);
    expect(error.message).not.toContain(message);
  });

  it('explains an SVG without a usable size', () => {
    const error = toTransformationError(
      new Error(
        'Input buffer has corrupt header: svgload_buffer: bad dimensions',
      ),
    );

    expect(error.code).toBe('PARSE_ERROR');
    expect(error.message).toBe(
      'Could not determine the SVG size: set width/height or a viewBox',
    );
  });

  it('passes a TransformationError through unchanged', () => {
    const original = new TransformationError('UNSAFE_CONTENT', 400, 'Unsafe');

    expect(toTransformationError(original)).toBe(original);
  });

  it('treats a non-Error value as internal', () => {
    expect(toTransformationError('boom').code).toBe('INTERNAL_ERROR');
  });
});
