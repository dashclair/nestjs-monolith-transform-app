import {
  TextConversionOutcome,
  TextConversionTask,
} from '../worker/convert-text';

export abstract class TextConversionRunner {
  abstract run(
    task: TextConversionTask,
    signal: AbortSignal,
  ): Promise<TextConversionOutcome>;
}
