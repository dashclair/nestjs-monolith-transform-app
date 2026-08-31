import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { vi } from 'vitest';

import { ConfigService } from '@/core/config/config.service';

import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let healthCheckService: { check: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let db: { pingCheck: ReturnType<typeof vi.fn> };
  let memory: {
    checkHeap: ReturnType<typeof vi.fn>;
    checkRSS: ReturnType<typeof vi.fn>;
  };
  let disk: { checkStorage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    healthCheckService = { check: vi.fn() };
    configService = { get: vi.fn() };
    db = { pingCheck: vi.fn() };
    memory = { checkHeap: vi.fn(), checkRSS: vi.fn() };
    disk = { checkStorage: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: ConfigService, useValue: configService },
        { provide: TypeOrmHealthIndicator, useValue: db },
        { provide: MemoryHealthIndicator, useValue: memory },
        { provide: DiskHealthIndicator, useValue: disk },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEmptyResponse', () => {
    it('should return an ok status with empty details', () => {
      expect(service.getEmptyResponse()).toEqual({ status: 'ok', details: {} });
    });
  });

  describe('checkHealth', () => {
    it('should read the disk path and threshold from config and run all indicators', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'HEALTH_DISK_PATH') return '/';
        if (key === 'HEALTH_DISK_THRESHOLD') return '0.9';

        return undefined;
      });
      healthCheckService.check.mockImplementation(
        (indicators: Array<() => unknown>) =>
          indicators.map((indicator) => indicator()),
      );

      await service.checkHealth();

      expect(healthCheckService.check).toHaveBeenCalledWith(expect.any(Array));
      expect(db.pingCheck).toHaveBeenCalledWith('database');
      expect(memory.checkHeap).toHaveBeenCalledWith(
        'memory_heap',
        150 * 1024 * 1024,
      );
      expect(memory.checkRSS).toHaveBeenCalledWith(
        'memory_rss',
        150 * 1024 * 1024,
      );
      expect(disk.checkStorage).toHaveBeenCalledWith('storage', {
        path: '/',
        thresholdPercent: 0.9,
      });
    });

    it('should fall back to an OS-native disk path when HEALTH_DISK_PATH is not set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'HEALTH_DISK_THRESHOLD') return '0.9';

        return undefined;
      });
      healthCheckService.check.mockImplementation(
        (indicators: Array<() => unknown>) =>
          indicators.map((indicator) => indicator()),
      );

      await service.checkHealth();

      const expectedPath = process.platform === 'win32' ? 'C:\\' : '/';

      expect(disk.checkStorage).toHaveBeenCalledWith('storage', {
        path: expectedPath,
        thresholdPercent: 0.9,
      });
    });
  });
});
