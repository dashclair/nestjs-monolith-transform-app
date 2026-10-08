import {
  ConversionOptions,
  ConversionRequest,
  ConversionResult,
  DetectInput,
  Format,
  FormatPair,
  SupportedFormats,
  TransformationKind,
} from './types';

export abstract class ConversionEngine {
  abstract readonly kind: TransformationKind;
  abstract supportedPairs(): FormatPair[];

  getFormats(): SupportedFormats[] {
    const grouped = new Map<Format, Format[]>();

    for (const { source, target } of this.supportedPairs()) {
      grouped.set(source, [...(grouped.get(source) ?? []), target]);
    }

    return [...grouped].map(([source, target]) => ({ source, target }));
  }

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
