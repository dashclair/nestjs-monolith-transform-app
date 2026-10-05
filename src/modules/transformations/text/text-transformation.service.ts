import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@/core/config/config.service';
import { ConversionEngine } from '../core/conversion-engine';
import { TransformationError } from '../core/transformation-error';
import {
  ConversionOptions,
  ConversionResult,
  FormatPair,
  SupportedFormats,
  TEXT_FORMATS,
  TextFormat,
} from '../core/types';

// All 12 directions from the spec: every text format converts to every other one.
export const TEXT_TARGETS = {
  csv: ['json', 'xml', 'yaml'],
  json: ['csv', 'xml', 'yaml'],
  xml: ['csv', 'json', 'yaml'],
  yaml: ['csv', 'json', 'xml'],
} as const satisfies Record<TextFormat, readonly TextFormat[]>;

const SIZE_LIMIT_KEYS = {
  csv: 'TRANSFORM_MAX_SIZE_CSV',
  json: 'TRANSFORM_MAX_SIZE_JSON',
  xml: 'TRANSFORM_MAX_SIZE_XML',
  yaml: 'TRANSFORM_MAX_SIZE_YAML',
} as const satisfies Record<TextFormat, string>;

@Injectable()
export class TextTransformationService extends ConversionEngine {
  readonly kind = 'file';

  constructor(private readonly configService: ConfigService) {
    super();
  }

  supportedPairs(): FormatPair<TextFormat>[] {
    return TEXT_FORMATS.flatMap((source) =>
      TEXT_TARGETS[source].map((target: TextFormat) => ({ source, target })),
    );
  }

  getFormats(): SupportedFormats<TextFormat>[] {
    return TEXT_FORMATS.map((source) => ({
      source,
      target: [...TEXT_TARGETS[source]],
    }));
  }

  // TODO(T-020): sniff BOM/`{`/`[`/`<`, use the extension only to tell yaml from csv.
  detectFormat(): TextFormat | null {
    throw new Error(
      'TextTransformationService.detectFormat is not implemented',
    );
  }

  sizeLimit(source: TextFormat): number {
    // ConfigService returns raw strings — coerce explicitly.
    return Number(this.configService.get(SIZE_LIMIT_KEYS[source]));
  }

  // The spec defines no options for text conversion: only `{}` (or no `options` field) is accepted.
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

  // TODO(T-020): parse → intermediate representation → serialize, in a worker, honouring `signal`.
  convert(): Promise<ConversionResult> {
    throw new Error('TextTransformationService.convert is not implemented');
  }
}
