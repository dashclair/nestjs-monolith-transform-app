import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import sharp, { Sharp, SharpOptions } from 'sharp';
import { ConfigService } from '@/core/config/config.service';
import type { Config } from '@/core/config/config.types';
import { ConversionEngine } from '../core/conversion-engine';
import { TransformationError } from '../core/transformation-error';
import {
  ConversionRequest,
  ConversionResult,
  DetectInput,
  FormatPair,
  ImageFormat,
} from '../core/types';
import { ImageOptions, ImageOptionsDto } from './dto/image-options.dto';
import { detectImageFormat } from './utils/detect-image-format';
import { toTransformationError } from './utils/sharp-error';
import { assertSafeSvg } from './utils/svg-safety';

// sharp handles every pair, so there are no parser/serializer registries to
// derive this from (unlike text). png/jpeg → svg would be vectorization and
// identity pairs are pointless — both rejected as UNSUPPORTED_DIRECTION.
const PAIRS: readonly FormatPair<ImageFormat>[] = [
  { source: 'png', target: 'jpeg' },
  { source: 'jpeg', target: 'png' },
  { source: 'svg', target: 'png' },
  { source: 'svg', target: 'jpeg' },
];

const SIZE_LIMIT_KEYS = {
  png: 'TRANSFORM_MAX_SIZE_PNG',
  jpeg: 'TRANSFORM_MAX_SIZE_JPEG',
  svg: 'TRANSFORM_MAX_SIZE_SVG',
} as const satisfies Record<ImageFormat, string>;

const OUTPUT = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  svg: { mimeType: 'image/svg+xml', extension: 'svg' }, // never a target, see PAIRS
} as const satisfies Record<
  ImageFormat,
  Pick<ConversionResult, 'mimeType' | 'extension'>
>;

// Requirements: rasterization background defaults to white, for PNG too.
const DEFAULT_BACKGROUND = '#ffffff';
// sharp reads SVG at 72 DPI; density is the knob for the rendered size.
const SVG_BASE_DENSITY = 72;
const SVG_MAX_DENSITY = 100_000; // sharp's upper bound

interface Size {
  width: number;
  height: number;
}

interface ImageSettings {
  sizeLimits: Record<ImageFormat, number>;
  maxInputPixels: number;
  maxSvgWidth: number;
  maxSvgHeight: number;
  jpegDefaultQuality: number;
  timeoutSeconds: number;
}

@Injectable()
export class ImageTransformationService extends ConversionEngine {
  readonly kind = 'image';

  // Config is fixed for the process lifetime, so it is read and coerced
  // (ConfigService returns raw strings) once, not on every request.
  private readonly settings: ImageSettings;

  constructor(configService: ConfigService) {
    super();

    const number = (key: keyof Config) => Number(configService.get(key));

    this.settings = {
      sizeLimits: {
        png: number(SIZE_LIMIT_KEYS.png),
        jpeg: number(SIZE_LIMIT_KEYS.jpeg),
        svg: number(SIZE_LIMIT_KEYS.svg),
      },
      maxInputPixels: number('IMAGE_MAX_INPUT_PIXELS'),
      maxSvgWidth: number('IMAGE_SVG_MAX_WIDTH'),
      maxSvgHeight: number('IMAGE_SVG_MAX_HEIGHT'),
      jpegDefaultQuality: number('IMAGE_JPEG_DEFAULT_QUALITY'),
      // sharp's timeout() takes whole seconds, at least 1.
      timeoutSeconds: Math.max(
        1,
        Math.ceil(number('TRANSFORM_TIMEOUT_MS') / 1000),
      ),
    };
  }

  supportedPairs(): FormatPair<ImageFormat>[] {
    return PAIRS.map((pair) => ({ ...pair }));
  }

  // Content always wins: filename and mimetype are client-supplied and are
  // ignored, so `photo.png` that is really a JPEG is converted (and recorded
  // in history) as JPEG. null → 415 UNSUPPORTED_FORMAT in the multipart reader.
  detectFormat({ head }: DetectInput): ImageFormat | null {
    return detectImageFormat(head);
  }

  sizeLimit(source: ImageFormat): number {
    return this.settings.sizeLimits[source];
  }

  // Called after detection and the direction check, so source/target form a
  // supported pair. Returns only what the client passed and was validated —
  // defaults (quality, background, SVG size) are resolved in convert().
  validateOptions(
    source: ImageFormat,
    target: ImageFormat,
    raw: unknown,
  ): ImageOptions {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw this.invalidOptions('Options must be a JSON object');
    }

    // No implicit conversion: `"80"` is a string, not a quality.
    const dto = plainToInstance(ImageOptionsDto, raw);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    });

    if (errors.length > 0) {
      throw this.invalidOptions(
        `Invalid options: ${errors.map((error) => error.property).join(', ')}`,
      );
    }

    const { quality, width, height, background } = dto;

    // An option that does nothing for this pair is an error, not silently
    // ignored — otherwise `width` for PNG → JPEG looks like it resized.
    if (quality !== undefined && target !== 'jpeg') {
      throw this.invalidOptions(
        'quality is only applicable when targetFormat is jpeg',
      );
    }

    if (
      source !== 'svg' &&
      (width !== undefined || height !== undefined || background !== undefined)
    ) {
      throw this.invalidOptions(
        'width, height and background are only applicable to SVG input',
      );
    }

    // Same check convert() applies to sizes derived from the SVG itself; an
    // explicit value is rejected here, before the file is rendered. An
    // absent side counts as 0, so only the passed ones are checked.
    this.validateSvgSize({ width: width ?? 0, height: height ?? 0 });

    // Drop absent keys so history stores only what was passed.
    return Object.fromEntries(
      Object.entries({ quality, width, height, background }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as ImageOptions;
  }

  // Buffer in, buffer out: toBuffer() resolves only with the complete image,
  // so a failure never leaves a half-written response (PNG/JPEG are decoded
  // whole anyway, so sharp's stream interface would not save memory). The
  // work itself runs on the libuv thread pool, not the event loop, so unlike
  // text this needs no piscina worker.
  async convert(
    req: ConversionRequest<ImageFormat, ImageOptions>,
    signal: AbortSignal,
  ): Promise<ConversionResult> {
    try {
      const { image, applied } =
        req.source === 'svg'
          ? await this.loadSvg(req.body, req.options, signal)
          : { image: this.loadRaster(req.body), applied: {} };

      const quality =
        req.target === 'jpeg'
          ? (req.options.quality ?? this.settings.jpegDefaultQuality)
          : undefined;

      // One background policy for every input: JPEG has no alpha (without
      // this, transparent areas turn black), and the requirements want SVG
      // rasterized onto white for PNG too. `background` is only accepted for
      // SVG input (validateOptions), so PNG/JPEG always get white.
      const flattened = image.flatten({
        background: req.options.background ?? DEFAULT_BACKGROUND,
      });

      const encoded =
        quality !== undefined ? flattened.jpeg({ quality }) : flattened.png();

      // sharp cannot be cancelled from outside: the pipeline's signal only
      // stops us from starting, timeout() makes libvips stop itself and free
      // the thread. Its clock skips time queued for a thread; the pipeline's
      // own timer covers that.
      this.throwIfAborted(signal);

      const body = await encoded
        .timeout({ seconds: this.settings.timeoutSeconds })
        .toBuffer();

      // History gets what was really applied, defaults included — only the
      // client-facing options, so PNG/JPEG's implicit white flatten is not
      // reported as a `background` the client could not have passed.
      const options: ImageOptions =
        quality !== undefined ? { quality, ...applied } : applied;

      return { body, ...OUTPUT[req.target], options };
    } catch (error) {
      throw toTransformationError(error);
    }
  }

  // limitInputPixels is checked against the header before anything is
  // decoded — a tiny PNG claiming 20000×20000 fails here, not after
  // allocating it. EXIF orientation is applied (the image looks as it did for
  // the user); metadata, GPS included, is dropped since withMetadata() is
  // never called.
  private loadRaster(body: Buffer): Sharp {
    return sharp(body, {
      ...this.inputLimits(),
      autoOrient: true,
    });
  }

  private async loadSvg(
    body: Buffer,
    options: ImageOptions,
    signal: AbortSignal,
  ): Promise<{ image: Sharp; applied: ImageOptions }> {
    // Before the SVG ever reaches librsvg, including metadata() below.
    // Embedded PNG/JPEG are decoded by librsvg itself, outside sharp's
    // limitInputPixels, so the same budget is enforced on them here.
    assertSafeSvg(body, { maxEmbeddedPixels: this.settings.maxInputPixels });

    // Only the XML is parsed here, nothing is rendered, so no pixel limit:
    // with it, a 10000×10000 SVG requested at width=512 would be refused.
    // The limit applies to the actual render below.
    //
    // librsvg always derives a size — width/height, viewBox, em units, or the
    // bounding box of the content. Only an SVG with neither a size nor any
    // content (or a zero size) has none, and sharp cannot load that at any
    // size: "bad dimensions" → 400 (sharp-error).
    const { width, height } = await sharp(body, {
      limitInputPixels: false,
      failOn: 'warning',
    }).metadata();
    // Only the size: the rest of the metadata must not leak into `applied`
    // (and from there into history) when svgOutputSize returns it as is.
    const intrinsic: Size = { width, height };

    this.throwIfAborted(signal);

    const size = this.svgOutputSize(intrinsic, options);

    // Also catches an oversized intrinsic size: width="100000" without
    // options is refused, not silently scaled down.
    this.validateSvgSize(size);

    const background = options.background ?? DEFAULT_BACKGROUND;

    // Pads the box when both sides were passed; the transparent parts of the
    // SVG itself are filled by the flatten() in convert().
    const image = sharp(body, {
      ...this.inputLimits(),
      density: this.svgDensity(intrinsic, size),
    }).resize(size.width, size.height, { fit: 'contain', background });

    return { image, applied: { ...size, background } };
  }

  private validateSvgSize(size: Size): void {
    const { maxSvgWidth, maxSvgHeight } = this.settings;

    if (size.width > maxSvgWidth || size.height > maxSvgHeight) {
      throw new TransformationError(
        'DIMENSIONS_EXCEEDED',
        HttpStatus.BAD_REQUEST,
        `Output size must not exceed ${maxSvgWidth}x${maxSvgHeight}`,
      );
    }
  }

  // Render at the target size instead of at 72 DPI and upscaling, which
  // would blur. The `contain` scale, so the render is never larger than the
  // output box; resize() then only pads to the exact size. Clamped to the
  // range sharp accepts — a tiny scale (100000-wide SVG at width=10) would
  // otherwise go below 1.
  private svgDensity(intrinsic: Size, output: Size): number {
    const scale = Math.min(
      output.width / intrinsic.width,
      output.height / intrinsic.height,
    );

    return Math.min(SVG_MAX_DENSITY, Math.max(1, SVG_BASE_DENSITY * scale));
  }

  // | passed         | result                                          |
  // | nothing        | the intrinsic size                              |
  // | width / height | the other side keeps the intrinsic aspect ratio |
  // | both           | exactly width × height, letterboxed by resize() |
  private svgOutputSize(
    intrinsic: Size,
    { width, height }: ImageOptions,
  ): Size {
    if (width !== undefined && height !== undefined) {
      return { width, height };
    }

    if (width !== undefined) {
      return {
        width,
        height: Math.max(
          1,
          Math.round((width * intrinsic.height) / intrinsic.width),
        ),
      };
    }

    if (height !== undefined) {
      return {
        width: Math.max(
          1,
          Math.round((height * intrinsic.width) / intrinsic.height),
        ),
        height,
      };
    }

    return intrinsic;
  }

  private inputLimits(): SharpOptions {
    return {
      limitInputPixels: this.settings.maxInputPixels,
      // sharp's default, explicit because it matters for untrusted input: a
      // damaged file fails (PARSE_ERROR) instead of half-decoding.
      failOn: 'warning',
    };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new TransformationError(
        'CONVERSION_TIMEOUT',
        HttpStatus.REQUEST_TIMEOUT,
        'Conversion timed out',
      );
    }
  }

  private invalidOptions(message: string): TransformationError {
    return new TransformationError(
      'INVALID_OPTIONS',
      HttpStatus.BAD_REQUEST,
      message,
    );
  }
}
