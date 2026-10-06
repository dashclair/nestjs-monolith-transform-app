import { extname } from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@/core/config/config.service';
import { ConversionEngine } from '../core/conversion-engine';
import { TransformationError } from '../core/transformation-error';
import {
  ConversionOptions,
  ConversionRequest,
  ConversionResult,
  DetectInput,
  FormatPair,
  SupportedFormats,
  TextFormat,
} from '../core/types';
import { TEXT_PARSERS } from './parsers';
import { TextConversionRunner } from './runner/text-conversion.runner';
import { TEXT_SERIALIZERS } from './serializers';
import { decodeHead } from './utils/decode-text';
import { StructureLimits } from './text.types';

type SupportedFormat = 'csv' | 'json' | 'xml' | 'yaml';

const SIZE_LIMIT_KEYS = {
  csv: 'TRANSFORM_MAX_SIZE_CSV',
  json: 'TRANSFORM_MAX_SIZE_JSON',
  xml: 'TRANSFORM_MAX_SIZE_XML',
  yaml: 'TRANSFORM_MAX_SIZE_YAML',
} as const satisfies Record<TextFormat, string>;

@Injectable()
export class TextTransformationService extends ConversionEngine {
  readonly kind = 'file';

  constructor(
    private readonly configService: ConfigService,
    private readonly runner: TextConversionRunner,
  ) {
    super();
  }

  // Derived from the registries: every parser × every serializer except the
  // identity pair, so a new format only needs registering in both.
  supportedPairs(): FormatPair<TextFormat>[] {
    const targets = [...TEXT_SERIALIZERS.keys()];

    return [...TEXT_PARSERS.keys()].flatMap((source) =>
      targets
        .filter((target) => target !== source)
        .map((target) => ({ source, target })),
    );
  }

  getFormats(): SupportedFormats<TextFormat>[] {
    const grouped = new Map<TextFormat, TextFormat[]>();

    for (const { source, target } of this.supportedPairs()) {
      grouped.set(source, [...(grouped.get(source) ?? []), target]);
    }

    return [...grouped].map(([source, target]) => ({ source, target }));
  }

  detectByMimeType(mimetype?: string): SupportedFormat | null {
    if (!mimetype) {
      return null;
    }

    const mime = mimetype.split(';')[0].trim().toLowerCase();

    switch (mime) {
      case 'text/csv':
        return 'csv';

      case 'application/yaml':
      case 'text/yaml':
      case 'application/x-yaml':
        return 'yaml';

      default:
        return null;
    }
  }

  detectByContent(content: string): SupportedFormat | null {
    const trimmed = content.trimStart();

    const firstChar = trimmed[0];

    if (firstChar === '{' || firstChar === '[') {
      return 'json';
    }

    if (firstChar === '<') {
      return 'xml';
    }

    return null;
  }
  detectByExtension(filename?: string) {
    if (!filename) {
      return null;
    }

    // extname() returns '' for 'csv' and '.csv' — a bare name is not an
    // extension (split('.').pop() would return the whole name here).
    const extension = extname(filename).slice(1).toLowerCase();

    switch (extension) {
      case 'csv':
        return 'csv';

      case 'json':
        return 'json';

      case 'xml':
        return 'xml';

      case 'yaml':
      case 'yml':
        return 'yaml';

      default:
        return null;
    }
  }

  detectFormat(input: DetectInput): TextFormat | null {
    if (input.head.includes(0x00)) {
      throw new TransformationError(
        'UNSUPPORTED_FORMAT',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'Unsupported file format',
      );
    }

    const content = decodeHead(input.head);

    const byExtension = this.detectByExtension(input.filename);
    if (byExtension) {
      return byExtension;
    }

    const byContent = this.detectByContent(content);
    if (byContent) {
      return byContent;
    }

    const byMimeType = this.detectByMimeType(input.mimetype);
    if (byMimeType) {
      return byMimeType;
    }

    return null;
  }

  sizeLimit(source: TextFormat): number {
    return Number(this.configService.get(SIZE_LIMIT_KEYS[source]));
  }

  validateOptions(
    _source: TextFormat,
    _target: TextFormat,
    raw: unknown,
  ): ConversionOptions {
    const isEmptyObject =
      typeof raw === 'object' &&
      raw !== null &&
      !Array.isArray(raw) &&
      Object.keys(raw).length === 0;

    if (!isEmptyObject) {
      throw new TransformationError(
        'INVALID_OPTIONS',
        HttpStatus.BAD_REQUEST,
        'Text conversion does not accept options',
      );
    }

    return {};
  }

  async convert(
    req: ConversionRequest<TextFormat>,
    signal: AbortSignal,
  ): Promise<ConversionResult> {
    const limits: StructureLimits = {
      maxDepth: Number(this.configService.get('TRANSFORM_TEXT_MAX_DEPTH')),
      maxNodes: Number(this.configService.get('TRANSFORM_TEXT_MAX_NODES')),
    };

    const outcome = await this.runner.run(
      { source: req.source, target: req.target, body: req.body, limits },
      signal,
    );

    if (!outcome.ok) {
      // The HTTP status does not cross the thread boundary, only the code.
      // Everything the worker reports is a problem with the file, except
      // its catch-all for unexpected errors.
      const status =
        outcome.code === 'INTERNAL_ERROR'
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : HttpStatus.BAD_REQUEST;

      throw new TransformationError(outcome.code, status, outcome.message);
    }

    // convert() is only reached for pairs from supportedPairs(), so the
    // target serializer is registered.
    const serializer = TEXT_SERIALIZERS.get(req.target)!;

    return {
      body: Buffer.from(outcome.body),
      mimeType: serializer.mimeType,
      extension: serializer.extension,
    };
  }
}
