import sharp from 'sharp';
import type { ConfigService } from '@/core/config/config.service';

import { ImageTransformationService } from '../image-transformation.service';
import type { ImageOptions } from '../dto/image-options.dto';
import type { ImageFormat } from '../../core/types';
import { TransformationError } from '../../core/transformation-error';

const CONFIG: Record<string, string> = {
  IMAGE_MAX_INPUT_PIXELS: '1000000',
  IMAGE_SVG_MAX_WIDTH: '1000',
  IMAGE_SVG_MAX_HEIGHT: '500',
  IMAGE_JPEG_DEFAULT_QUALITY: '80',
  TRANSFORM_TIMEOUT_MS: '30000',
};

function createService() {
  const config = { get: (key: string) => CONFIG[key] } as ConfigService;
  return new ImageTransformationService(config);
}

const convert = (
  source: ImageFormat,
  target: ImageFormat,
  body: Buffer,
  options: ImageOptions = {},
  signal = new AbortController().signal,
) => createService().convert({ source, target, body, options }, signal);

const svg = (attrs: string, content = '') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${content}</svg>`,
  );

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected convert to reject');
    },
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(TransformationError);
  const failure = error as TransformationError;
  return { code: failure.code, status: failure.getStatus() };
}

// Raw RGB(A) of the pixel at (x, y).
async function pixelAt(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

// A PNG whose IHDR claims 20000×20000 with almost no data behind it.
function pngBomb(): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(20_000, 0);
  ihdr.writeUInt32BE(20_000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk(
      'IDAT',
      Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('ImageTransformationService.convert', () => {
  describe('raster ↔ raster', () => {
    it('converts PNG to JPEG with the jpg extension', async () => {
      const png = await sharp({
        create: { width: 8, height: 4, channels: 3, background: '#00f' },
      })
        .png()
        .toBuffer();

      const result = await convert('png', 'jpeg', png);

      expect(result).toMatchObject({
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });
      expect(await sharp(result.body).metadata()).toMatchObject({
        format: 'jpeg',
        width: 8,
        height: 4,
      });
    });

    it('flattens PNG transparency onto white, not black', async () => {
      const transparent = await sharp({
        create: {
          width: 4,
          height: 4,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

      const { body } = await convert('png', 'jpeg', transparent);

      for (const channel of await pixelAt(body, 0, 0)) {
        expect(channel).toBeGreaterThan(250);
      }
    });

    it('applies quality: lower quality gives a smaller JPEG', async () => {
      const noisy = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: '#888',
          noise: { type: 'gaussian', mean: 128, sigma: 60 },
        },
      })
        .png()
        .toBuffer();

      const low = await convert('png', 'jpeg', noisy, { quality: 10 });
      const high = await convert('png', 'jpeg', noisy, { quality: 95 });

      expect(low.body.length).toBeLessThan(high.body.length);
    });

    it('applies EXIF orientation and drops metadata on JPEG → PNG', async () => {
      // 2×1 stored, orientation 6 = rotate 90° clockwise to display.
      const rotated = await sharp({
        create: { width: 2, height: 1, channels: 3, background: '#f00' },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const { body, mimeType, extension } = await convert(
        'jpeg',
        'png',
        rotated,
      );
      const meta = await sharp(body).metadata();

      expect({ mimeType, extension }).toEqual({
        mimeType: 'image/png',
        extension: 'png',
      });
      expect(meta).toMatchObject({ format: 'png', width: 1, height: 2 });
      expect(meta.orientation).toBeUndefined();
      expect(meta.exif).toBeUndefined();
    });

    it('rejects a decompression bomb before decoding it', async () => {
      expect(await errorOf(convert('png', 'jpeg', pngBomb()))).toEqual({
        code: 'DIMENSIONS_EXCEEDED',
        status: 400,
      });
    });

    it('rejects a truncated JPEG as PARSE_ERROR', async () => {
      const jpeg = await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#f00' },
      })
        .jpeg()
        .toBuffer();

      expect(
        await errorOf(
          convert('jpeg', 'png', jpeg.subarray(0, jpeg.length / 2)),
        ),
      ).toEqual({ code: 'PARSE_ERROR', status: 400 });
    });
  });

  describe('SVG rasterization', () => {
    const size = async (body: Buffer) => {
      const { width, height, format } = await sharp(body).metadata();
      return { width, height, format };
    };

    it('uses the intrinsic size when no size is passed', async () => {
      const { body } = await convert(
        'svg',
        'png',
        svg('width="40" height="20"'),
      );

      expect(await size(body)).toEqual({
        width: 40,
        height: 20,
        format: 'png',
      });
    });

    it('keeps the aspect ratio when only width or only height is passed', async () => {
      const image = svg('viewBox="0 0 40 20"');

      expect(
        await size((await convert('svg', 'png', image, { width: 200 })).body),
      ).toMatchObject({ width: 200, height: 100 });
      expect(
        await size((await convert('svg', 'jpeg', image, { height: 50 })).body),
      ).toMatchObject({ width: 100, height: 50, format: 'jpeg' });
    });

    it('renders sharply at the target size instead of upscaling', async () => {
      // A 1-unit black stripe on the left half; upscaled from 72 DPI the
      // edge would be a blurred gradient.
      const image = svg(
        'width="2" height="2"',
        '<rect width="1" height="2" fill="#000"/>',
      );
      const { body } = await convert('svg', 'png', image, { width: 200 });

      expect(await pixelAt(body, 98, 100)).toEqual([0, 0, 0]);
      expect(await pixelAt(body, 101, 100)).toEqual([255, 255, 255]);
    });

    it('letterboxes into width × height with the background colour', async () => {
      const image = svg(
        'width="10" height="10"',
        '<rect width="10" height="10" fill="#000"/>',
      );
      const { body } = await convert('svg', 'png', image, {
        width: 300,
        height: 100,
        background: '#ff0000',
      });

      expect(await size(body)).toMatchObject({ width: 300, height: 100 });
      expect(await pixelAt(body, 5, 50)).toEqual([255, 0, 0]); // padding
      expect(await pixelAt(body, 150, 50)).toEqual([0, 0, 0]); // the SVG
    });

    it('fills transparent areas with white by default, for PNG too', async () => {
      const { body } = await convert('svg', 'png', svg('width="4" height="4"'));
      const meta = await sharp(body).metadata();

      expect(meta.hasAlpha).toBe(false);
      expect(await pixelAt(body, 0, 0)).toEqual([255, 255, 255]);
    });

    it('rejects an unsafe SVG before rendering it', async () => {
      const image = svg(
        'width="4" height="4"',
        '<image href="file:///etc/passwd"/>',
      );

      expect(await errorOf(convert('svg', 'png', image))).toEqual({
        code: 'UNSAFE_CONTENT',
        status: 400,
      });
    });

    it('rejects an oversized intrinsic size instead of scaling it down', async () => {
      expect(
        await errorOf(
          convert('svg', 'png', svg('width="100000" height="100000"')),
        ),
      ).toEqual({ code: 'DIMENSIONS_EXCEEDED', status: 400 });
    });

    it('rejects a derived side above the maximum', async () => {
      // width 1000 is allowed, but the derived height would be 2000 > 500.
      expect(
        await errorOf(
          convert('svg', 'png', svg('viewBox="0 0 10 20"'), { width: 1000 }),
        ),
      ).toEqual({ code: 'DIMENSIONS_EXCEEDED', status: 400 });
    });

    it('renders a large SVG at a small requested size', async () => {
      // 10000×10000 intrinsic is far above IMAGE_MAX_INPUT_PIXELS, but only
      // the 100×100 render is decoded.
      const { body } = await convert(
        'svg',
        'png',
        svg('width="10000" height="10000"'),
        { width: 100 },
      );

      expect(await size(body)).toMatchObject({ width: 100, height: 100 });
    });

    it.each([
      [
        'invalid XML',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect'),
      ],
    ])('rejects %s as PARSE_ERROR', async (_name, body) => {
      expect(await errorOf(convert('svg', 'png', body))).toEqual({
        code: 'PARSE_ERROR',
        status: 400,
      });
    });

    it('takes the size from the content when the SVG declares none', async () => {
      // No width/height/viewBox: librsvg uses the drawing's bounding box.
      const image = svg('', '<rect x="2" y="3" width="5" height="7"/>');

      expect(
        await size((await convert('svg', 'png', image)).body),
      ).toMatchObject({ width: 5, height: 7 });
    });

    it.each([
      ['no size and no content', svg('')],
      ['a zero size', svg('width="0" height="0"')],
    ])('explains an SVG with %s', async (_name, body) => {
      await expect(convert('svg', 'png', body)).rejects.toMatchObject({
        code: 'PARSE_ERROR',
        message:
          'Could not determine the SVG size: set width/height or a viewBox',
      });
    });
  });

  describe('applied options', () => {
    it.each([
      ['png', 'jpeg', {}, { quality: 80 }],
      ['png', 'jpeg', { quality: 40 }, { quality: 40 }],
      ['jpeg', 'png', {}, {}],
    ] as const)(
      'reports %s → %s with %o as %o',
      async (source, target, options, applied) => {
        const input = await sharp({
          create: { width: 4, height: 4, channels: 3, background: '#fff' },
        })
          [source]()
          .toBuffer();

        const result = await convert(source, target, input, options);

        expect(result.options).toEqual(applied);
      },
    );

    it('reports the resolved SVG size and default background', async () => {
      const result = await convert('svg', 'jpeg', svg('viewBox="0 0 40 20"'), {
        width: 200,
      });

      expect(result.options).toEqual({
        quality: 80,
        width: 200,
        height: 100,
        background: '#ffffff',
      });
    });

    it('reports the intrinsic size and the passed background', async () => {
      const result = await convert(
        'svg',
        'png',
        svg('width="30" height="15"'),
        { background: '#000' },
      );

      expect(result.options).toEqual({
        width: 30,
        height: 15,
        background: '#000',
      });
    });
  });

  it('does not start work once the pipeline has aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      await errorOf(
        convert(
          'svg',
          'png',
          svg('width="4" height="4"'),
          {},
          controller.signal,
        ),
      ),
    ).toEqual({ code: 'CONVERSION_TIMEOUT', status: 408 });
  });
});
