import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { AppModule } from '@/core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { TokenService } from '@/core/auth/services/token.service';
import { PasswordService } from '@/modules/auth/services/password.service';
import { Role } from '@/modules/rbac/entities/role.entity';
import { Transformation } from '@/modules/transformations/entities/transformation.entity';
import { TransformationsCleanupService } from '@/modules/transformations/history/transformations-cleanup.service';
import { User } from '@/modules/users/entities/user.entity';

type HistoryItem = Record<string, unknown> & { id: string };
type HistoryBody = { items: HistoryItem[]; nextCursor: string | null };

// Hits the real Postgres from `docker compose up -d postgres` and assumes
// migrations are applied (the admin role needs the `transformations:read`
// grant from SeedTransformationsResource). History rows are inserted
// directly through the repository; fixtures are namespaced `e2e-history-`
// and their history goes away with the users via ON DELETE CASCADE.
//
// Tokens are minted via TokenService, as in users.e2e-spec.ts, so the
// `/auth/login` throttle and confirmation settings don't matter here.
//
// The history throttles resolve `process.env` per request
// (throttleFromConfig), so the suite runs with high limits and the `429`
// block lowers them on the fly.
describe('Transformation history (e2e)', () => {
  let app: NestFastifyApplication;
  let usersRepo: Repository<User>;
  let rolesRepo: Repository<Role>;
  let transformationsRepo: Repository<Transformation>;
  let tokenService: TokenService;

  const SELF_EMAIL = 'e2e-history-self@test.local';
  const OTHER_EMAIL = 'e2e-history-other@test.local';
  const ADMIN_EMAIL = 'e2e-history-admin@test.local';
  const DELETED_EMAIL = 'e2e-history-deleted@test.local';
  const ALL_FIXTURE_EMAILS = [
    SELF_EMAIL,
    OTHER_EMAIL,
    ADMIN_EMAIL,
    DELETED_EMAIL,
  ];

  const THROTTLE_KEYS = [
    'THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT',
    'THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT',
  ] as const;

  const SELF_PATH = '/api/transformations/history';
  const adminPath = (userId: string) =>
    `/admin/users/${userId}/transformations/history`;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const base = Date.now() - 60 * MINUTE_MS;
  const at = (minutes: number) => new Date(base + minutes * MINUTE_MS);

  let selfId: string;
  let deletedId: string;
  let selfToken: string;
  let adminToken: string;

  // SELF's history, keyed by role in the test. `sameTime` rows share one
  // createdAt and are inserted in one INSERT — the keyset tie-break case.
  const ids = {
    csvToJson: '',
    jsonToXml: '',
    pngToJpeg: '',
    svgError: '',
    undetected: '',
    sameTime: [] as string[],
    expired: '',
  };
  let otherRowId: string;
  let deletedRowId: string;

  const findUser = (email: string): Promise<User> =>
    usersRepo.findOneOrFail({ where: { email }, relations: ['roles'] });

  const tokenFor = async (email: string): Promise<string> => {
    const user = await findUser(email);
    const { accessToken } = await tokenService.issueTokens(user, randomUUID());
    return accessToken;
  };

  const createUser = async (
    email: string,
    roleNames: string[] = [],
    deletedAt: Date | null = null,
  ): Promise<User> => {
    const passwordHash = await new PasswordService().hash('Password123!');
    const roles = roleNames.length
      ? await rolesRepo.findBy({ name: In(roleNames) })
      : [];
    return usersRepo.save(
      usersRepo.create({
        email,
        passwordHash,
        isEmailVerified: true,
        roles,
        deletedAt,
      }),
    );
  };

  const row = (
    userId: string,
    createdAt: Date,
    overrides: Partial<Transformation> = {},
  ): Partial<Transformation> => ({
    id: randomUUID(),
    userId,
    type: 'file',
    sourceFormat: 'csv',
    targetFormat: 'json',
    status: 'success',
    errorCode: null,
    fileSize: 1024,
    durationMs: 12,
    options: { delimiter: ',' },
    createdAt,
    ...overrides,
  });

  const insert = async (rows: Partial<Transformation>[]): Promise<string[]> => {
    await transformationsRepo.insert(
      rows as QueryDeepPartialEntity<Transformation>[],
    );
    return rows.map((r) => r.id!);
  };

  const getHistory = (
    path: string,
    token: string | null,
    query: Record<string, string | number> = {},
  ) => {
    const req = request(app.getHttpServer()).get(path).query(query);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const idsOf = (res: request.Response): string[] =>
    (res.body as HistoryBody).items.map((item) => item.id);

  const cleanup = async () => {
    if (!usersRepo) return;
    await usersRepo.delete({ email: In(ALL_FIXTURE_EMAILS) });
  };

  beforeAll(async () => {
    for (const key of THROTTLE_KEYS) process.env[key] = '1000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.register(fastifyCookie, {
      secret: moduleFixture.get(ConfigService).get('COOKIE_SECRET'),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    usersRepo = moduleFixture.get(getRepositoryToken(User));
    rolesRepo = moduleFixture.get(getRepositoryToken(Role));
    transformationsRepo = moduleFixture.get(getRepositoryToken(Transformation));
    tokenService = moduleFixture.get(TokenService);

    const retentionDays = Number(
      moduleFixture.get(ConfigService).get('TRANSFORMATIONS_RETENTION_DAYS'),
    );

    await cleanup();

    selfId = (await createUser(SELF_EMAIL)).id;
    const otherId = (await createUser(OTHER_EMAIL)).id;
    await createUser(ADMIN_EMAIL, ['admin']);
    deletedId = (await createUser(DELETED_EMAIL, [], new Date())).id;

    [
      ids.csvToJson,
      ids.jsonToXml,
      ids.pngToJpeg,
      ids.svgError,
      ids.undetected,
      ids.expired,
    ] = await insert([
      row(selfId, at(0)),
      row(selfId, at(1), { sourceFormat: 'json', targetFormat: 'xml' }),
      row(selfId, at(2), {
        type: 'image',
        sourceFormat: 'png',
        targetFormat: 'jpeg',
      }),
      row(selfId, at(3), {
        type: 'image',
        sourceFormat: 'svg',
        targetFormat: 'png',
        status: 'error',
        errorCode: 'UNSAFE_CONTENT',
      }),
      row(selfId, at(4), {
        sourceFormat: null,
        targetFormat: null,
        status: 'error',
        errorCode: 'UNSUPPORTED_FORMAT',
        options: null,
      }),
      row(selfId, new Date(Date.now() - (retentionDays + 1) * DAY_MS)),
    ]);
    ids.sameTime = await insert(
      [1, 2, 3].map(() => row(selfId, at(5), { sourceFormat: 'yaml' })),
    );
    [otherRowId] = await insert([row(otherId, at(0))]);
    [deletedRowId] = await insert([row(deletedId, at(0))]);

    selfToken = await tokenFor(SELF_EMAIL);
    adminToken = await tokenFor(ADMIN_EMAIL);
  }, 30000);

  afterAll(async () => {
    for (const key of THROTTLE_KEYS) delete process.env[key];
    await cleanup();
    await app?.close();
  });

  // Every non-expired SELF row, newest first; ties on createdAt by id DESC
  // (Postgres orders uuids bytewise, which matches lowercase hex order).
  const visibleSelfIds = () => [
    ...[...ids.sameTime].sort().reverse(),
    ids.undetected,
    ids.svgError,
    ids.pngToJpeg,
    ids.jsonToXml,
    ids.csvToJson,
  ];

  describe('GET /api/transformations/history', () => {
    it('returns 401 without a token', async () => {
      await getHistory(SELF_PATH, null).expect(401);
    });

    it("returns only the caller's own rows, newest first", async () => {
      const res = await getHistory(SELF_PATH, selfToken, { limit: 100 });

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual(visibleSelfIds());
      expect(idsOf(res)).not.toContain(otherRowId);
      expect((res.body as HistoryBody).nextCursor).toBeNull();
    });

    it('does not return rows older than the retention period, even before cleanup', async () => {
      expect(await transformationsRepo.existsBy({ id: ids.expired })).toBe(
        true,
      );

      const res = await getHistory(SELF_PATH, selfToken, { limit: 100 });

      expect(idsOf(res)).not.toContain(ids.expired);
    });

    it('exposes only the contract fields', async () => {
      const res = await getHistory(SELF_PATH, selfToken, { limit: 100 });
      const items = (res.body as HistoryBody).items;
      const success = items.find((item) => item.id === ids.csvToJson)!;
      const error = items.find((item) => item.id === ids.svgError)!;
      const undetected = items.find((item) => item.id === ids.undetected)!;

      expect(Object.keys(success).sort()).toEqual(
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
      expect(success).toMatchObject({
        type: 'file',
        sourceFormat: 'csv',
        targetFormat: 'json',
        status: 'success',
        fileSize: 1024,
        durationMs: 12,
        fileAvailable: false,
        createdAt: at(0).toISOString(),
      });
      expect(error).toMatchObject({
        status: 'error',
        errorCode: 'UNSAFE_CONTENT',
      });
      expect(undetected).toMatchObject({
        sourceFormat: null,
        targetFormat: null,
        errorCode: 'UNSUPPORTED_FORMAT',
      });
      for (const item of items) {
        expect(item).not.toHaveProperty('userId');
        expect(item).not.toHaveProperty('options');
        expect(item).not.toHaveProperty('storageKey');
      }
    });

    it('pages through every row by nextCursor without duplicates or gaps', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const res = await getHistory(SELF_PATH, selfToken, {
          limit: 3,
          ...(cursor ? { cursor } : {}),
        });
        expect(res.status).toBe(200);
        const body = res.body as HistoryBody;
        expect(body.items.length).toBeLessThanOrEqual(3);
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      // 8 visible rows at 3 per page: 3 + 3 + 2, the last page has no cursor.
      expect(pages).toBe(3);
      expect(cursor).toBeNull();
      expect(seen).toEqual(visibleSelfIds());
    });

    it('splits rows that share a createdAt across pages correctly', async () => {
      const sameTime = [...ids.sameTime].sort().reverse();

      const first = await getHistory(SELF_PATH, selfToken, { limit: 2 });
      expect(idsOf(first)).toEqual(sameTime.slice(0, 2));

      const second = await getHistory(SELF_PATH, selfToken, {
        limit: 2,
        cursor: (first.body as HistoryBody).nextCursor!,
      });
      expect(idsOf(second)).toEqual([sameTime[2], ids.undetected]);
    });

    it.each([
      ['type', { type: 'image' }, () => [ids.svgError, ids.pngToJpeg]],
      ['status', { status: 'error' }, () => [ids.undetected, ids.svgError]],
      ['sourceFormat', { sourceFormat: 'csv' }, () => [ids.csvToJson]],
      [
        'targetFormat',
        { targetFormat: 'json' },
        () => [...[...ids.sameTime].sort().reverse(), ids.csvToJson],
      ],
      [
        'type + status',
        { type: 'file', status: 'error' },
        () => [ids.undetected],
      ],
    ])('filters by %s', async (_name, query, expected) => {
      const res = await getHistory(SELF_PATH, selfToken, {
        limit: 100,
        ...query,
      });

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual(expected());
    });

    it('treats createdAtFrom as inclusive and createdAtTo as exclusive', async () => {
      const res = await getHistory(SELF_PATH, selfToken, {
        limit: 100,
        createdAtFrom: at(2).toISOString(),
        createdAtTo: at(4).toISOString(),
      });

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([ids.svgError, ids.pngToJpeg]);
    });

    it('returns 400 when createdAtFrom is after createdAtTo', async () => {
      const res = await getHistory(SELF_PATH, selfToken, {
        createdAtFrom: at(4).toISOString(),
        createdAtTo: at(2).toISOString(),
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'createdAtFrom must be before createdAtTo',
      });
    });

    it.each([
      ['a week date', { createdAtFrom: '2026-W41' }],
      ['an unknown type', { type: 'video' }],
      ['an unknown format', { sourceFormat: 'pdf' }],
      ['limit above 100', { limit: 101 }],
      ['limit 0', { limit: 0 }],
      ['an unknown parameter', { userId: randomUUID() }],
    ])('returns 400 for %s', async (_name, query) => {
      await getHistory(SELF_PATH, selfToken, query).expect(400);
    });

    it.each([
      ['not base64 JSON', 'not-a-cursor'],
      [
        'a non-uuid id',
        Buffer.from(
          JSON.stringify({ value: at(0).toISOString(), id: 'nope' }),
        ).toString('base64url'),
      ],
      [
        'a non-ISO value',
        Buffer.from(
          JSON.stringify({ value: '2026', id: randomUUID() }),
        ).toString('base64url'),
      ],
    ])('returns 400 Invalid cursor for %s', async (_name, cursor) => {
      const res = await getHistory(SELF_PATH, selfToken, { cursor });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: 'Invalid cursor' });
    });
  });

  describe('GET /admin/users/:userId/transformations/history', () => {
    it('returns 401 without a token', async () => {
      await getHistory(adminPath(selfId), null).expect(401);
    });

    it('returns 403 for a user without the transformations:read grant', async () => {
      await getHistory(adminPath(selfId), selfToken).expect(403);
    });

    it("returns another user's history to an admin", async () => {
      const res = await getHistory(adminPath(selfId), adminToken, {
        limit: 100,
      });

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual(visibleSelfIds());
      for (const item of (res.body as HistoryBody).items) {
        expect(item).not.toHaveProperty('userId');
      }
    });

    it('applies the same filters as the self endpoint', async () => {
      const res = await getHistory(adminPath(selfId), adminToken, {
        status: 'error',
      });

      expect(idsOf(res)).toEqual([ids.undetected, ids.svgError]);
    });

    it('returns the history of a soft-deleted user', async () => {
      const res = await getHistory(adminPath(deletedId), adminToken);

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([deletedRowId]);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await getHistory(adminPath(randomUUID()), adminToken);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ message: 'User not found' });
    });

    it('returns 400 for a non-uuid userId', async () => {
      await getHistory(adminPath('not-a-uuid'), adminToken).expect(400);
    });
  });

  describe('retention cleanup', () => {
    // vitest.config.e2e.ts sets TRANSFORMATIONS_CLEANUP_ENABLED=false.
    it('is not scheduled when TRANSFORMATIONS_CLEANUP_ENABLED is false', () => {
      expect(
        app.get(SchedulerRegistry).doesExist('cron', 'transformations-cleanup'),
      ).toBe(false);
    });

    // Runs on the shared dev database, so it also deletes any other row
    // older than the retention period — which is what the job does anyway.
    it('deletes expired rows and keeps fresh ones', async () => {
      await app.get(TransformationsCleanupService).run();

      expect(await transformationsRepo.existsBy({ id: ids.expired })).toBe(
        false,
      );
      expect(
        await transformationsRepo.countBy({ id: In(visibleSelfIds()) }),
      ).toBe(visibleSelfIds().length);
    });
  });

  // Must stay last: a throttled key stays blocked for the whole TTL even
  // after the limit is raised again, so nothing can call these routes after.
  describe('rate limiting', () => {
    // Earlier requests in the suite already count against the window, so a
    // limit of 2 can only make the 429 come sooner, never later.
    const exhaust = async (path: string, token: string) => {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await getHistory(path, token)).status);
      }
      return statuses;
    };

    it('returns 429 after the limit, with separate buckets for admin and self', async () => {
      process.env.THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT = '2';
      expect((await exhaust(adminPath(selfId), adminToken)).at(-1)).toBe(429);

      // The admin bucket is spent, the self one is not.
      await getHistory(SELF_PATH, selfToken).expect(200);

      process.env.THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT = '2';
      expect((await exhaust(SELF_PATH, selfToken)).at(-1)).toBe(429);
    });
  });
});
