export const TRANSFORMATION_KINDS = ['file', 'image'] as const;
export type TransformationKind = (typeof TRANSFORMATION_KINDS)[number];

export const TRANSFORMATION_STATUSES = ['success', 'error'] as const;
export type TransformationStatus = (typeof TRANSFORMATION_STATUSES)[number];

export type FileStatus = 'pending' | 'stored' | 'failed' | 'skipped';

export const TEXT_FORMATS = ['csv', 'json', 'xml', 'yaml'] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

export const IMAGE_FORMATS = ['png', 'jpeg', 'svg'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const FORMATS = [...TEXT_FORMATS, ...IMAGE_FORMATS] as const;
export type Format = TextFormat | ImageFormat;

export interface FormatPair<F extends Format = Format> {
  source: F;
  target: F;
}

export interface SupportedFormats<F extends Format = Format> {
  source: F;
  target: F[];
}

export interface DetectInput {
  head: Buffer;
  filename?: string; // client-supplied, a hint only
  mimetype?: string; // client-supplied, a hint only
}

// Options after engine validation — what was actually applied, stored in history.
export type ConversionOptions = Record<string, unknown>;

export interface ConversionRequest<
  F extends Format = Format,
  TOptions extends ConversionOptions = ConversionOptions,
> {
  body: Buffer;
  source: F;
  target: F;
  options: TOptions;
}

export interface ConversionResult {
  body: Buffer;
  mimeType: string;
  extension: string;
  options?: ConversionOptions;
}
