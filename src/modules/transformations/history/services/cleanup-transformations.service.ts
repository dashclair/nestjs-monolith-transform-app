import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DataSource, QueryRunner } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { StorageService } from '@/core/storage/storage.service';

import { retentionCutoff } from '../utils/retention.utils';

const CLEANUP_LOCK_KEY = 22_022;
const JOB_NAME = 'transformations-cleanup';

@Injectable()
export class TransformationsCleanupService implements OnModuleInit {
  private readonly logger = new Logger(TransformationsCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    if (String(this.config.get('TRANSFORMATIONS_CLEANUP_ENABLED')) !== 'true') {
      return;
    }

    const job = new CronJob(
      String(this.config.get('TRANSFORMATIONS_CLEANUP_CRON')),
      () => void this.run(),
    );
    this.schedulerRegistry.addCronJob(JOB_NAME, job);
    job.start();
  }

  async run(): Promise<void> {
    const startedAt = Date.now();
    const qr = this.dataSource.createQueryRunner();
    let locked = false;

    try {
      await qr.connect();

      const [lock] = (await qr.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [CLEANUP_LOCK_KEY],
      )) as { locked: boolean }[];
      locked = lock.locked;

      if (!locked) {
        this.logger.debug('Transformations cleanup is already running');
        return;
      }

      const cutoff = retentionCutoff(
        Number(this.config.get('TRANSFORMATIONS_RETENTION_DAYS')),
      );
      const batchSize = Number(
        this.config.get('TRANSFORMATIONS_CLEANUP_BATCH'),
      );

      let deletedCount = 0;
      let batchCount: number;
      do {
        batchCount = await this.deleteBatch(qr, cutoff, batchSize);
        deletedCount += batchCount;
      } while (batchCount === batchSize);

      this.logger.log({
        event: 'transformations.cleanup.completed',
        deletedCount,
        cutoff,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.error({
        event: 'transformations.cleanup.failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      if (locked) {
        await qr
          .query('SELECT pg_advisory_unlock($1)', [CLEANUP_LOCK_KEY])
          .catch((error: unknown) =>
            this.logger.warn({
              event: 'transformations.cleanup.unlock_failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          );
      }
      await qr.release();
    }
  }

  private async deleteBatch(
    qr: QueryRunner,
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    await qr.startTransaction();

    try {
      const rows = (await qr.query(
        `SELECT id, "storageKey" FROM "transformations"
          WHERE "createdAt" < $1
          ORDER BY "createdAt"
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [cutoff, batchSize],
      )) as {
        id: string;
        storageKey: string | null;
      }[];

      if (rows.length > 0) {
        for (const row of rows) {
          if (row.storageKey !== null) {
            await this.storage.delete(row.storageKey);
          }
        }

        await qr.query(
          'DELETE FROM "transformations" WHERE id = ANY($1::uuid[])',
          [rows.map((row) => row.id)],
        );
      }

      await qr.commitTransaction();
      return rows.length;
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    }
  }
}
