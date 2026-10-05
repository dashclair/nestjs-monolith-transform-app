import {
  ConversionOptions,
  ConversionRequest,
  ConversionResult,
  DetectInput,
  Format,
  FormatPair,
  TransformationKind,
} from './types';

export abstract class ConversionEngine {
  abstract readonly kind: TransformationKind;
  abstract supportedPairs(): FormatPair[];
  abstract detectFormat(input: DetectInput): Format | null;
  abstract sizeLimit(source: Format): number;
  abstract validateOptions(
    source: Format,
    target: Format,
    raw: unknown,
  ): ConversionOptions;
  abstract convert(
    req: ConversionRequest,
    signal: AbortSignal,
  ): Promise<ConversionResult>;
}
