import {
  TransformationError,
  TransformationErrorCode,
} from '../../core/transformation-error';
import { TextFormat } from '../../core/types';
import { TEXT_PARSERS } from '../parsers';
import { TEXT_SERIALIZERS } from '../serializers';
import { StructureLimits } from '../text.types';
import { decodeText } from '../utils/decode-text';
import { assertStructureLimits } from '../utils/structure-limits';

export interface TextConversionTask {
  source: TextFormat;
  target: TextFormat;
  body: Buffer;
  limits: StructureLimits;
}
export type TextConversionOutcome =
  | { ok: true; body: Uint8Array }
  | { ok: false; code: TransformationErrorCode; message: string };

export function convertText({
  source,
  target,
  body,
  limits,
}: TextConversionTask): TextConversionOutcome {
  const parser = TEXT_PARSERS.get(source);
  const serializer = TEXT_SERIALIZERS.get(target);

  // The pipeline already rejects pairs outside supportedPairs(); this only
  // guards a direct call with an unregistered format.
  if (!parser || !serializer || source === target) {
    return {
      ok: false,
      code: 'UNSUPPORTED_DIRECTION',
      message: 'Unsupported conversion direction',
    };
  }

  try {
    const text = decodeText(body);
    const value = parser.parse(text, limits);
    assertStructureLimits(value, limits);
    const output = serializer.serialize(value);
    return { ok: true, body: Buffer.from(output, 'utf8') };
  } catch (error) {
    if (error instanceof TransformationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}
