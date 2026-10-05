import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Transformation } from '@/modules/transformations/entities/transformation.entity';
import type { ConversionOptions, Format, TransformationKind } from './types';
import type { TransformationErrorCode } from './transformation-error';

export type WriteTransformationInput = {
  userId: string;
  type: TransformationKind;
  sourceFormat: Format | null;
  targetFormat: Format | null;
  fileSize: number;
  durationMs: number;
  // Pass only options validated by the engine, never raw multipart fields.
  options: ConversionOptions | null;
} & (
  | { status: 'success'; errorCode: null }
  | { status: 'error'; errorCode: TransformationErrorCode }
);

@Injectable()
export class TransformationHistoryService {
  private readonly logger = new Logger(TransformationHistoryService.name);

  constructor(
    @InjectRepository(Transformation)
    private readonly transformations: Repository<Transformation>,
  ) {}

  async write(input: WriteTransformationInput): Promise<Transformation | null> {
    try {
      const entry = this.transformations.create(input);
      return await this.transformations.save(entry);
    } catch {
      // Database errors can contain SQL parameters; do not log their raw text.
      this.logger.error({
        event: 'transformation.history.write_failed',
        userId: input.userId,
        type: input.type,
        status: input.status,
        errorCode: input.errorCode,
      });
      return null;
    }
  }
}
