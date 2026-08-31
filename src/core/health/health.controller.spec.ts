import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';

import { ConfigService } from '@/core/config/config.service';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: {
    checkHealth: ReturnType<typeof vi.fn>;
    getEmptyResponse: ReturnType<typeof vi.fn>;
  };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    healthService = { checkHealth: vi.fn(), getEmptyResponse: vi.fn() };
    configService = { get: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: healthService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return the empty response when health checks are disabled', async () => {
      configService.get.mockReturnValue(false);
      healthService.getEmptyResponse.mockReturnValue({
        status: 'ok',
        details: {},
      });

      const result = await controller.check();

      expect(healthService.getEmptyResponse).toHaveBeenCalled();
      expect(healthService.checkHealth).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'ok', details: {} });
    });

    it('should run the real health checks when health checks are enabled', async () => {
      configService.get.mockReturnValue(true);
      healthService.checkHealth.mockResolvedValue({
        status: 'ok',
        details: { database: { status: 'up' } },
      });

      const result = await controller.check();

      expect(healthService.checkHealth).toHaveBeenCalled();
      expect(healthService.getEmptyResponse).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'ok',
        details: { database: { status: 'up' } },
      });
    });
  });

  describe('testError', () => {
    it('should throw an error', () => {
      expect(() => controller.testError()).toThrow('Test unexpected error');
    });
  });
});
