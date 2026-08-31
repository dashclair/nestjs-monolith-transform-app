import { Injectable } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheckResult,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';

import { ConfigService } from '@/core/config/config.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly configService: ConfigService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  getEmptyResponse(): HealthCheckResult {
    return {
      status: 'ok',
      details: {},
    };
  }

  checkHealth() {
    const diskPath =
      this.configService.get('HEALTH_DISK_PATH') ||
      (process.platform === 'win32' ? 'C:\\' : '/');
    const diskThreshold = Number(
      this.configService.get('HEALTH_DISK_THRESHOLD'),
    );

    return this.healthCheckService.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      () =>
        this.disk.checkStorage('storage', {
          path: diskPath,
          thresholdPercent: diskThreshold,
        }),
    ]);
  }
}
