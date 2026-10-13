import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { MockInstance } from 'vitest';

import type { ConfigService } from '@/core/config/config.service';
import { encodeCursor } from '@/core/database/keyset-pagination';
import type { User } from '@/modules/users/entities/user.entity';

import type { Transformation } from '../../entities/transformation.entity';
import { TransformationHistoryQueryDto } from '../transformations-history.dto';
import { TransformationsHistoryService } from '../transformations-history.service';

describe('TransformationsHistoryService', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
  const ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ID_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const NOW = new Date('2026-10-12T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  const qbMock = {
    select: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    take: vi.fn(),
    getMany: vi.fn<() => Promise<Transformation[]>>(),
  };
  const repoMock = { createQueryBuilder: vi.fn() };
  const userRepoMock = { existsBy: vi.fn<() => Promise<boolean>>() };
  const configValues: Record<string, string> = {
    TRANSFORMATIONS_RETENTION_DAYS: '90',
  };
  const configServiceMock = {
    get: vi.fn((key: string) => configValues[key]),
  };

  const service = new TransformationsHistoryService(
    repoMock as unknown as Repository<Transformation>,
    userRepoMock as unknown as Repository<User>,
    configServiceMock as unknown as ConfigService,
  );

  let logSpy: MockInstance<Logger['log']>;

  const buildTransformation = (
    overrides: Partial<Transformation> = {},
  ): Transformation =>
    ({
      id: ID_1,
      userId: USER_ID,
      type: 'file',
      sourceFormat: 'csv',
      targetFormat: 'json',
      status: 'success',
      errorCode: null,
      fileSize: 1024,
      durationMs: 42,
      options: { delimiter: ';' },
      createdAt: new Date('2026-10-10T10:00:00.000Z'),
      ...overrides,
    }) as Transformation;

  const listTransformations = (count: number): Transformation[] =>
    [ID_1, ID_2, ID_3].slice(0, count).map((id, i) =>
      buildTransformation({
        id,
        createdAt: new Date(`2026-10-0${9 - i}T10:00:00.000Z`),
      }),
    );

  const buildQuery = (
    overrides: Partial<TransformationHistoryQueryDto> = {},
  ): TransformationHistoryQueryDto =>
    Object.assign(new TransformationHistoryQueryDto(), overrides);

  const list = (query: TransformationHistoryQueryDto) =>
    service.getTransformationHistory(query, USER_ID);

  const decode = (cursor: string): unknown =>
    JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

  const toJson = (value: unknown): Record<string, unknown> =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    configServiceMock.get.mockImplementation(
      (key: string) => configValues[key],
    );
    for (const method of [
      'select',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'take',
    ] as const) {
      qbMock[method].mockReturnValue(qbMock);
    }
    qbMock.getMany.mockResolvedValue([]);
    repoMock.createQueryBuilder.mockReturnValue(qbMock);
    userRepoMock.existsBy.mockResolvedValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('query', () => {
    it('selects only the columns the history exposes', async () => {
      await list(buildQuery());

      expect(qbMock.select).toHaveBeenCalledWith([
        'transformation.id',
        'transformation.type',
        'transformation.sourceFormat',
        'transformation.targetFormat',
        'transformation.status',
        'transformation.errorCode',
        'transformation.fileSize',
        'transformation.durationMs',
        'transformation.createdAt',
      ]);
    });

    it('always scopes to the user and the retention period', async () => {
      await list(buildQuery());

      expect(qbMock.where).toHaveBeenCalledWith(
        'transformation.userId = :userId',
        { userId: USER_ID },
      );
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'transformation.createdAt >= :retentionCutoff',
        { retentionCutoff: new Date(NOW.getTime() - 90 * DAY_MS) },
      );
    });

    it('takes the retention period from TRANSFORMATIONS_RETENTION_DAYS', async () => {
      configServiceMock.get.mockImplementation((key: string) =>
        key === 'TRANSFORMATIONS_RETENTION_DAYS' ? '7' : configValues[key],
      );

      await list(buildQuery());

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'transformation.createdAt >= :retentionCutoff',
        { retentionCutoff: new Date(NOW.getTime() - 7 * DAY_MS) },
      );
    });

    it('sorts by createdAt DESC with id DESC as the tie-breaker', async () => {
      await list(buildQuery());

      expect(qbMock.orderBy).toHaveBeenCalledWith(
        'transformation.createdAt',
        'DESC',
      );
      expect(qbMock.addOrderBy).toHaveBeenCalledWith(
        'transformation.id',
        'DESC',
      );
    });
  });

  describe('filters', () => {
    it('adds no optional filters when none are given', async () => {
      await list(buildQuery());

      expect(qbMock.andWhere).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'type',
        { type: 'image' as const },
        'transformation.type = :type',
        { type: 'image' },
      ],
      [
        'sourceFormat',
        { sourceFormat: 'png' as const },
        'transformation.sourceFormat = :sourceFormat',
        { sourceFormat: 'png' },
      ],
      [
        'targetFormat',
        { targetFormat: 'jpeg' as const },
        'transformation.targetFormat = :targetFormat',
        { targetFormat: 'jpeg' },
      ],
      [
        'status',
        { status: 'error' as const },
        'transformation.status = :status',
        { status: 'error' },
      ],
      [
        'createdAtFrom (inclusive)',
        { createdAtFrom: '2026-10-01T00:00:00Z' },
        'transformation.createdAt >= :createdAtFrom',
        { createdAtFrom: new Date('2026-10-01T00:00:00Z') },
      ],
      [
        'createdAtTo (exclusive)',
        { createdAtTo: '2026-10-05T00:00:00Z' },
        'transformation.createdAt < :createdAtTo',
        { createdAtTo: new Date('2026-10-05T00:00:00Z') },
      ],
    ])('filters by %s', async (_label, filter, condition, params) => {
      await list(buildQuery(filter));

      expect(qbMock.andWhere).toHaveBeenCalledWith(condition, params);
    });

    it('combines all filters with AND', async () => {
      await list(
        buildQuery({
          type: 'file',
          sourceFormat: 'csv',
          targetFormat: 'json',
          status: 'success',
          createdAtFrom: '2026-10-01',
          createdAtTo: '2026-10-05',
        }),
      );

      expect(qbMock.andWhere).toHaveBeenCalledTimes(7);
    });

    it('rejects createdAtFrom after createdAtTo with 400, before querying', async () => {
      await expect(
        list(
          buildQuery({
            createdAtFrom: '2026-10-05T00:00:00Z',
            createdAtTo: '2026-10-01T00:00:00Z',
          }),
        ),
      ).rejects.toThrow(
        new BadRequestException('createdAtFrom must be before createdAtTo'),
      );

      expect(repoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('accepts an empty range where createdAtFrom equals createdAtTo', async () => {
      await expect(
        list(
          buildQuery({
            createdAtFrom: '2026-10-05T00:00:00Z',
            createdAtTo: '2026-10-05T00:00:00Z',
          }),
        ),
      ).resolves.toEqual({ items: [], nextCursor: null });
    });
  });

  describe('pagination', () => {
    it('requests limit + 1 rows to detect the next page without a COUNT', async () => {
      await list(buildQuery({ limit: 2 }));

      expect(qbMock.take).toHaveBeenCalledWith(3);
    });

    it('uses the DTO default limit of 20', async () => {
      await list(buildQuery());

      expect(qbMock.take).toHaveBeenCalledWith(21);
    });

    it('trims the extra row and returns a cursor pointing at the last returned item', async () => {
      qbMock.getMany.mockResolvedValue(listTransformations(3));

      const result = await list(buildQuery({ limit: 2 }));

      expect(result.items.map((item) => item.id)).toEqual([ID_1, ID_2]);
      expect(decode(result.nextCursor!)).toEqual({
        value: '2026-10-08T10:00:00.000Z',
        id: ID_2,
      });
    });

    it('returns nextCursor null on the last page', async () => {
      qbMock.getMany.mockResolvedValue(listTransformations(2));

      const result = await list(buildQuery({ limit: 2 }));

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('a cursor it issued round-trips into the keyset condition', async () => {
      qbMock.getMany.mockResolvedValueOnce(listTransformations(3));
      const { nextCursor } = await list(buildQuery({ limit: 2 }));

      await list(buildQuery({ limit: 2, cursor: nextCursor! }));

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(transformation.createdAt, transformation.id) < (:value, :id)',
        { value: '2026-10-08T10:00:00.000Z', id: ID_2 },
      );
    });

    it.each([
      ['not base64/JSON', 'garbage!!'],
      [
        'id is not a UUID',
        encodeCursor({ value: '2026-10-08T10:00:00.000Z', id: 'nope' }),
      ],
      ['value is not a timestamp', encodeCursor({ value: '2026', id: ID_2 })],
      [
        'value is not in toISOString() format',
        encodeCursor({ value: '2026-10-08 10:00:00', id: ID_2 }),
      ],
    ])(
      'rejects a cursor that is %s with 400, before querying',
      async (_label, cursor) => {
        await expect(list(buildQuery({ cursor }))).rejects.toThrow(
          new BadRequestException('Invalid cursor'),
        );

        expect(repoMock.createQueryBuilder).not.toHaveBeenCalled();
      },
    );
  });

  describe('mapping', () => {
    it('serializes only the contract fields', async () => {
      qbMock.getMany.mockResolvedValue([buildTransformation()]);

      const { items } = await list(buildQuery());
      const item = toJson(items[0]);

      expect(Object.keys(item).sort()).toEqual(
        [
          'createdAt',
          'durationMs',
          'fileAvailable',
          'fileSize',
          'id',
          'sourceFormat',
          'status',
          'targetFormat',
          'type',
        ].sort(),
      );
      for (const field of ['userId', 'options', 'user', 'storageKey']) {
        expect(item).not.toHaveProperty(field);
      }
    });

    it('omits errorCode from a successful entry and returns it for a failed one', async () => {
      qbMock.getMany.mockResolvedValue([
        buildTransformation({ id: ID_1 }),
        buildTransformation({
          id: ID_2,
          status: 'error',
          errorCode: 'PARSE_ERROR',
        }),
      ]);

      const { items } = await list(buildQuery());

      expect(toJson(items[0])).not.toHaveProperty('errorCode');
      expect(toJson(items[1])).toHaveProperty('errorCode', 'PARSE_ERROR');
    });

    it('keeps null formats of an entry whose format was not detected', async () => {
      qbMock.getMany.mockResolvedValue([
        buildTransformation({
          sourceFormat: null,
          targetFormat: null,
          status: 'error',
          errorCode: 'UNSUPPORTED_FORMAT',
        }),
      ]);

      const { items } = await list(buildQuery());

      expect(items[0].sourceFormat).toBeNull();
      expect(items[0].targetFormat).toBeNull();
    });

    it('reports fileAvailable as false', async () => {
      qbMock.getMany.mockResolvedValue([buildTransformation()]);

      const { items } = await list(buildQuery());

      expect(items[0].fileAvailable).toBe(false);
    });
  });

  describe('admin access', () => {
    const listAsAdmin = (query: TransformationHistoryQueryDto) =>
      service.getTransformationHistoryByAdmin(query, USER_ID, ADMIN_ID);

    it('404 User not found when the user does not exist, without querying history', async () => {
      userRepoMock.existsBy.mockResolvedValue(false);

      await expect(listAsAdmin(buildQuery())).rejects.toThrow(
        new NotFoundException('User not found'),
      );

      expect(userRepoMock.existsBy).toHaveBeenCalledWith({ id: USER_ID });
      expect(repoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns the target user history when the user exists', async () => {
      qbMock.getMany.mockResolvedValue([buildTransformation()]);

      const { items } = await listAsAdmin(buildQuery());

      expect(items).toHaveLength(1);
      expect(qbMock.where).toHaveBeenCalledWith(
        'transformation.userId = :userId',
        { userId: USER_ID },
      );
    });

    it('logs a 404 view with actor and target', async () => {
      userRepoMock.existsBy.mockResolvedValue(false);

      await expect(listAsAdmin(buildQuery())).rejects.toThrow(
        NotFoundException,
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'transformations.history.viewed',
          actorUserId: ADMIN_ID,
          targetUserId: USER_ID,
          result: 404,
        }),
      );
    });

    it('logs a 200 view with the admin as actor', async () => {
      await listAsAdmin(buildQuery());

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ADMIN_ID,
          targetUserId: USER_ID,
          result: 200,
        }),
      );
    });
  });

  describe('audit log', () => {
    it('logs a self view with the filter summary and result count', async () => {
      qbMock.getMany.mockResolvedValue(listTransformations(2));

      await list(
        buildQuery({
          type: 'file',
          status: 'success',
          sourceFormat: 'csv',
          createdAtFrom: '2026-10-01',
        }),
      );

      expect(logSpy).toHaveBeenCalledWith({
        event: 'transformations.history.viewed',
        actorUserId: USER_ID,
        targetUserId: USER_ID,
        type: 'file',
        status: 'success',
        sourceFormat: 'csv',
        targetFormat: null,
        hasDateRange: true,
        limit: 20,
        hasCursor: false,
        resultCount: 2,
        result: 200,
      });
    });

    it('does not log the raw cursor or dates', async () => {
      const cursor = encodeCursor({
        value: '2026-10-08T10:00:00.000Z',
        id: ID_2,
      });

      await list(buildQuery({ cursor, createdAtTo: '2026-10-05T00:00:00Z' }));

      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).not.toContain(cursor);
      expect(logged).not.toContain('2026-10-05');
    });
  });
});
