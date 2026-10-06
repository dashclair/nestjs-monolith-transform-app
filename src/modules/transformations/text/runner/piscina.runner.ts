import { HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { TextConversionRunner } from './text-conversion.runner';
import Piscina from 'piscina';
import { ConfigService } from '@/core/config/config.service';
import { resolve } from 'path';
import { TransformationError } from '../../core/transformation-error';
import {
  TextConversionOutcome,
  TextConversionTask,
} from '../worker/convert-text';

const QUEUE_AT_LIMIT = /Task queue is at limit/;

const busy = () =>
  new TransformationError(
    'BUSY',
    HttpStatus.SERVICE_UNAVAILABLE,
    'Server is busy',
  );

@Injectable()
export class PiscinaRunner
  extends TextConversionRunner
  implements OnModuleDestroy
{
  private readonly pool: Piscina<TextConversionTask, TextConversionOutcome>;
  private readonly maxQueue: number;

  constructor(configService: ConfigService) {
    super();
    const workers = Number(configService.get('TRANSFORM_TEXT_WORKERS'));
    this.maxQueue = workers * 4;
    this.pool = new Piscina<TextConversionTask, TextConversionOutcome>({
      filename: resolve(__dirname, '../worker/text-conversion.worker.js'),
      maxThreads: workers,
      maxQueue: this.maxQueue,
    });
  }

  async run(
    task: TextConversionTask,
    signal: AbortSignal,
  ): Promise<TextConversionOutcome> {
    if (this.pool.queueSize >= this.maxQueue) {
      throw busy();
    }

    try {
      return await this.pool.run(task, { signal });
    } catch (error) {
      // piscina enforces maxQueue itself too, with a plain Error.
      if (error instanceof Error && QUEUE_AT_LIMIT.test(error.message)) {
        throw busy();
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.pool.destroy();
  }
}
