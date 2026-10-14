import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '@/core/storage/storage.service';
import { Transformation } from '../entities/transformation.entity';
import { ConversionResult } from './types';
import { StoredObject } from '@/core/storage/storage.types';

@Injectable()
export class TransformationsStorageService {
  private readonly logger = new Logger(TransformationsStorageService.name);

  constructor(
    @InjectRepository(Transformation)
    private readonly transformations: Repository<Transformation>,
    private readonly storage: StorageService,
  ) {}

  async saveResult(
    history: Transformation,
    result: ConversionResult,
  ): Promise<void> {
    if (history.storageKey === null) {
      return;
    }

    const startedAt = performance.now();

    try {
      await this.storage.put(history.storageKey, result.body, {
        contentType: result.mimeType,
      });
      await this.transformations.update(
        { id: history.id },
        { fileStatus: 'stored' },
      );
      this.logger.log({
        event: 'transformation.file.saved',
        userId: history.userId,
        transformationId: history.id,
        storageKey: history.storageKey,
        resultSize: result.body.length,
        durationMs: Math.round(performance.now() - startedAt),
        result: 'success',
      });
    } catch {
      this.logger.error({
        event: 'transformation.file.save_failed',
        userId: history.userId,
        transformationId: history.id,
        storageKey: history.storageKey,
        resultSize: result.body.length,
        durationMs: Math.round(performance.now() - startedAt),
        reason: 'storage_error',
      });
      await this.transformations
        .update({ id: history.id }, { fileStatus: 'failed' })
        .catch(() => undefined);
    }
  }

  downloadResult(key: string): Promise<StoredObject> {
    return this.storage.get(key);
  }
}
