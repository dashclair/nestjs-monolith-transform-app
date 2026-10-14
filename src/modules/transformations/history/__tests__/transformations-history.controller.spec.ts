import { ParseUUIDPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';

import { PermissionsGuard, REQUIRE_PERMISSION_KEY } from '@/modules/rbac';

import { AdminTransformationHistoryController } from '../admin-transformation-history.controller';
import { TransformationHistoryQueryDto } from '../dto/transformations-history.dto';
import { TransformationHistoryController } from '../transformations-history.controller';
import type { TransformationsHistoryService } from '../services/history-transformations.service';

const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

const handlerOf = (controller: { prototype: object }, name: string) =>
  Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object;

const throttleOf = (handler: object) => ({
  limit: (
    Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler) as () => number
  )(),
  ttl: (
    Reflect.getMetadata(`${THROTTLER_TTL}default`, handler) as () => number
  )(),
});

describe('transformation history controllers', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
  const response = { items: [], nextCursor: null };

  const historyService = {
    getTransformationHistory: vi.fn(() => Promise.resolve(response)),
    getTransformationHistoryByAdmin: vi.fn(() => Promise.resolve(response)),
  };
  const service = historyService as unknown as TransformationsHistoryService;

  const query = Object.assign(new TransformationHistoryQueryDto(), {
    status: 'error' as const,
  });

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  describe('TransformationHistoryController (self)', () => {
    const controller = new TransformationHistoryController(service);
    const handler = handlerOf(
      TransformationHistoryController,
      'getUserTransformationHistory',
    );

    it('is mounted at GET /api/transformations/history', () => {
      expect(
        Reflect.getMetadata(PATH_METADATA, TransformationHistoryController),
      ).toBe('api/transformations');
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('history');
    });

    it('takes the user id only from the JWT', async () => {
      const request = { user: { userId: USER_ID } } as never;

      await expect(
        controller.getUserTransformationHistory(query, request),
      ).resolves.toBe(response);
      expect(
        historyService.getTransformationHistory,
      ).toHaveBeenCalledExactlyOnceWith(query, USER_ID);
    });

    it('requires no RBAC grant', () => {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, TransformationHistoryController),
      ).toBeUndefined();
    });

    it('throttles with THROTTLE_TRANSFORMATIONS_HISTORY_* (ttl in seconds)', () => {
      vi.stubEnv('THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT', '30');
      vi.stubEnv('THROTTLE_TRANSFORMATIONS_HISTORY_TTL', '60');

      expect(throttleOf(handler)).toEqual({ limit: 30, ttl: 60_000 });
    });
  });

  describe('AdminTransformationHistoryController', () => {
    const controller = new AdminTransformationHistoryController(service);
    const handler = handlerOf(
      AdminTransformationHistoryController,
      'getUserTransformationHistory',
    );

    it('is mounted at GET /admin/users/:userId/transformations/history', () => {
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          AdminTransformationHistoryController,
        ),
      ).toBe('admin/users');
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
        ':userId/transformations/history',
      );
    });

    it('passes the target user and the admin as actor', async () => {
      const request = { user: { userId: ADMIN_ID } } as never;

      await expect(
        controller.getUserTransformationHistory(USER_ID, query, request),
      ).resolves.toBe(response);
      expect(
        historyService.getTransformationHistoryByAdmin,
      ).toHaveBeenCalledExactlyOnceWith(query, USER_ID, ADMIN_ID);
    });

    it('is guarded by PermissionsGuard with transformations:read', () => {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          AdminTransformationHistoryController,
        ),
      ).toContain(PermissionsGuard);
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toEqual({
        resource: 'transformations',
        action: 'read',
      });
    });

    it('validates userId with ParseUUIDPipe', () => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        AdminTransformationHistoryController,
        'getUserTransformationHistory',
      ) as Record<string, { data?: string; pipes: unknown[] }>;

      const userIdArg = Object.values(args).find(
        (arg) => arg.data === 'userId',
      );

      expect(userIdArg?.pipes).toContain(ParseUUIDPipe);
    });

    it('throttles with THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_* (ttl in seconds)', () => {
      vi.stubEnv('THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT', '20');
      vi.stubEnv('THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_TTL', '60');

      expect(throttleOf(handler)).toEqual({ limit: 20, ttl: 60_000 });
    });
  });
});
