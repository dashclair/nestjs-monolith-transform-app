import sharp from 'sharp';
import type { ConfigService } from '@/core/config/config.service';

import { ImageTransformationService } from '../image-transformation.service';
import type { DetectInput, ImageFormat } from '../../core/types';
import { TransformationError } from '../../core/transformation-error';

// ConfigService returns raw strings — the fake does the same, so missing
// Number() coercion in the service would show up here.
const CONFIG: Record<string, string> = {
  TRANSFORM_MAX_SIZE_PNG: '100',
  TRANSFORM_MAX_SIZE_JPEG: '200',
  TRANSFORM_MAX_SIZE_SVG: '300',
  IMAGE_SVG_MAX_WIDTH: '1000',
  IMAGE_SVG_MAX_HEIGHT: '500',
};

function createService() {
  const config = { get: (key: string) => CONFIG[key] } as ConfigService;
  return new ImageTransformationService(config);
}

const detect = (head: string | Buffer, hints: Partial<DetectInput> = {}) =>
  createService().detectFormat({
    head: Buffer.isBuffer(head) ? head : Buffer.from(head),
    ...hints,
  });

const pixel = sharp({
  create: { width: 1, height: 1, channels: 3, background: '#ff0000' },
});

const BOM = String.fromCharCode(0xfeff);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

describe('ImageTransformationService', () => {
  it('groups targets by source for GET /formats', () => {
    expect(createService().getFormats()).toEqual([
      { source: 'png', target: ['jpeg'] },
      { source: 'jpeg', target: ['png'] },
      { source: 'svg', target: ['png', 'jpeg'] },
    ]);
  });

  describe('detectFormat', () => {
    let png: Buffer;
    let jpeg: Buffer;

    beforeAll(async () => {
      png = await pixel.clone().png().toBuffer();
      jpeg = await pixel.clone().jpeg().toBuffer();
    });

    it('detects real PNG and JPEG files by signature', () => {
      expect(detect(png)).toBe('png');
      expect(detect(jpeg)).toBe('jpeg');
    });

    it('ignores the filename and mimetype: content always wins', () => {
      expect(
        detect(jpeg, { filename: 'photo.png', mimetype: 'image/png' }),
      ).toBe('jpeg');
      expect(detect(png, { filename: 'image.svg' })).toBe('png');
      expect(
        detect('hello', { filename: 'a.png', mimetype: 'image/png' }),
      ).toBe(null);
    });

    it.each([
      ['a bare root', SVG],
      ['a self-closing root', '<svg/>'],
      ['an XML declaration', `<?xml version="1.0" encoding="UTF-8"?>\n${SVG}`],
      ['a UTF-8 BOM', BOM + SVG],
      ['leading whitespace', `  \r\n\t${SVG}`],
      ['comments', `<!-- a --><?xml version="1.0"?>\n<!-- b -->\n${SVG}`],
      [
        'a namespace prefix',
        '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>',
      ],
      [
        'a public DOCTYPE',
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">${SVG}`,
      ],
      [
        'a DOCTYPE with an internal subset',
        `<!DOCTYPE svg [ <!ENTITY a "b"> ]>${SVG}`,
      ],
      [
        'the head cut inside a multi-byte character',
        Buffer.from(`${SVG}<!-- Привет`).subarray(0, -1),
      ],
    ])('detects SVG with %s', (_name, head) => {
      expect(detect(head)).toBe('svg');
    });

    it.each([
      ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
      ['WebP', Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')],
      ['a truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
      ['plain text', 'just some text'],
      ['another XML root', '<?xml version="1.0"?><html><svg/></html>'],
      ['an element starting with svg', '<svgfoo/>'],
      ['upper-case SVG', '<SVG/>'],
      ['text before the root', `hello ${SVG}`],
      ['an unclosed comment', `<!-- ${SVG}`],
      ['a NUL byte', Buffer.concat([Buffer.from(SVG), Buffer.from([0x00])])],
      [
        'invalid UTF-8',
        Buffer.concat([Buffer.from([0xc3, 0x28]), Buffer.from(SVG)]),
      ],
      ['UTF-16', Buffer.from(BOM + SVG, 'utf16le')],
      ['an empty head', ''],
    ])('returns null for %s', (_name, head) => {
      expect(detect(head)).toBeNull();
    });
  });

  it('reads size limits per source format as numbers', () => {
    const service = createService();

    expect(service.sizeLimit('png')).toBe(100);
    expect(service.sizeLimit('jpeg')).toBe(200);
    expect(service.sizeLimit('svg')).toBe(300);
  });

  describe('validateOptions', () => {
    const validate = (source: ImageFormat, target: ImageFormat, raw: unknown) =>
      createService().validateOptions(source, target, raw);

    const errorOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(TransformationError);
        const { code } = error as TransformationError;
        return { code, status: (error as TransformationError).getStatus() };
      }
      throw new Error('expected validateOptions to throw');
    };

    it('accepts no options for every pair', () => {
      for (const { source, target } of createService().supportedPairs()) {
        expect(validate(source, target, {})).toEqual({});
      }
    });

    it('returns only the options that were passed', () => {
      expect(validate('png', 'jpeg', { quality: 75 })).toEqual({ quality: 75 });
      expect(
        validate('svg', 'jpeg', {
          quality: 1,
          width: 1000,
          height: 500,
          background: '#ABC',
        }),
      ).toEqual({ quality: 1, width: 1000, height: 500, background: '#ABC' });
      expect(validate('svg', 'png', { background: '#00ff00' })).toEqual({
        background: '#00ff00',
      });
    });

    it.each([
      ['null', null],
      ['an array', [{ quality: 80 }]],
      ['a number', 80],
      ['a string', 'quality=80'],
    ])('rejects %s as options', (_name, raw) => {
      expect(errorOf(() => validate('png', 'jpeg', raw))).toEqual({
        code: 'INVALID_OPTIONS',
        status: 400,
      });
    });

    it.each([
      ['quality 0', { quality: 0 }],
      ['quality 101', { quality: 101 }],
      ['fractional quality', { quality: 50.5 }],
      ['quality as a string', { quality: '80' }],
      ['width 0', { width: 0 }],
      ['negative height', { height: -1 }],
      ['fractional width', { width: 10.5 }],
      ['a named colour', { background: 'white' }],
      ['hex without #', { background: 'ffffff' }],
      ['4-digit hex', { background: '#ffff' }],
      ['8-digit hex', { background: '#ffffff00' }],
      ['an unknown field', { scale: 2 }],
    ])('rejects %s', (_name, raw) => {
      expect(errorOf(() => validate('svg', 'jpeg', raw))).toEqual({
        code: 'INVALID_OPTIONS',
        status: 400,
      });
    });

    it.each([
      ['quality for PNG target', 'svg', 'png', { quality: 80 }],
      ['quality for JPEG → PNG', 'jpeg', 'png', { quality: 80 }],
      ['width for PNG → JPEG', 'png', 'jpeg', { width: 100 }],
      ['height for JPEG → PNG', 'jpeg', 'png', { height: 100 }],
      ['background for PNG → JPEG', 'png', 'jpeg', { background: '#000' }],
    ] as const)('rejects inapplicable %s', (_name, source, target, raw) => {
      expect(errorOf(() => validate(source, target, raw))).toEqual({
        code: 'INVALID_OPTIONS',
        status: 400,
      });
    });

    it.each([
      ['width', { width: 1001 }],
      ['height', { height: 501 }],
    ])('rejects %s above the configured maximum', (_name, raw) => {
      expect(errorOf(() => validate('svg', 'png', raw))).toEqual({
        code: 'DIMENSIONS_EXCEEDED',
        status: 400,
      });
    });
  });
});
