import { Injectable } from '@nestjs/common';

import { TextConversionRunner } from './text-conversion.runner';
import {
  convertText,
  TextConversionOutcome,
  TextConversionTask,
} from '../worker/convert-text';

/**
 * Runs the worker's code in the current thread — for unit tests, where
 * piscina would need the compiled `.js` worker file that vitest does not build.
 *
 * The conversion is synchronous, so an abort can only be honoured before it
 * starts; a hung parse here cannot be interrupted. Production uses
 * `PiscinaRunner`, which terminates the worker thread instead.
 */
@Injectable()
export class InlineRunner extends TextConversionRunner {
  run(
    task: TextConversionTask,
    signal: AbortSignal,
  ): Promise<TextConversionOutcome> {
    if (signal.aborted) {
      return Promise.reject(signal.reason as Error);
    }

    return Promise.resolve(convertText(task));
  }
}
