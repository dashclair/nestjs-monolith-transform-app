import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DataSource, QueryRunner } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { retentionCutoff } from './retention.utils';

// Arbitrary, but must be unique among the advisory locks taken in this database.
const CLEANUP_LOCK_KEY = 22_022;
const JOB_NAME = 'transformations-cleanup';

@Injectable()
export class TransformationsCleanupService implements OnModuleInit {
  private readonly logger = new Logger(TransformationsCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
  ) {}

  // Registered here rather than with @Cron(): the decorator argument is
  // evaluated at import time, before the config is available.
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

  /**
   * Deletes history entries older than the retention period in batches.
   * Never throws: a failed run is logged and the next one picks up the rest.
   */
  async run(): Promise<void> {
    const startedAt = Date.now();
    // One connection for the whole run: the advisory lock belongs to the
    // session, so it must be taken and released on the same connection.
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
      // Only the message: a QueryFailedError also carries the query parameters.
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

  // Each batch is its own short transaction, so a large backlog never holds
  // row locks for the whole run.
  private async deleteBatch(
    qr: QueryRunner,
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    await qr.startTransaction();

    try {
      const rows = (await qr.query(
        `SELECT id FROM "transformations"
          WHERE "createdAt" < $1
          ORDER BY "createdAt"
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [cutoff, batchSize],
      )) as { id: string }[];

      if (rows.length > 0) {
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
