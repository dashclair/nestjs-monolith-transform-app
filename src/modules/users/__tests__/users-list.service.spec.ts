import { BadRequestException, Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';

import { User } from '../entities/user.entity';
import {
  ListUsersQueryDto,
  SortOrder,
  UserSortField,
  UserStatus,
} from '../dto/list-users.dto';
import { UsersListService } from '../services/users-list.service';
import { encodeUsersCursor } from '../utils/users-list-cursor';

describe('UsersListService', () => {
  let service: UsersListService;

  // Cursor validation requires real UUIDs.
  const ID_1 = '11111111-1111-4111-8111-111111111111';
  const ID_2 = '22222222-2222-4222-8222-222222222222';
  const ID_3 = '33333333-3333-4333-8333-333333333333';
  const ADMIN_ID = 'admin-1';

  const qbMock = {
    select: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    addOrderBy: vi.fn(),
    take: vi.fn(),
    getMany: vi.fn<() => Promise<User[]>>(),
  };
  const usersRepoMock = {
    createQueryBuilder: vi.fn(),
  };
  // ConfigService.get() returns raw strings, like the real one.
  const configValues: Record<string, string> = {
    USERS_LIST_MAX_LIMIT: '100',
    USERS_LIST_DEFAULT_LIMIT: '20',
  };
  const configServiceMock = {
    get: vi.fn((key: string) => configValues[key]),
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: ID_1,
      email: 'user@example.com',
      photo: 'https://example.com/photo.jpg',
      passwordHash: 'hashed-password',
      pendingEmail: null,
      isEmailVerified: true,
      createdAt: new Date('2026-09-09T10:00:00.000Z'),
      updatedAt: new Date('2026-09-09T10:00:00.000Z'),
      failedLoginAttempts: 3,
      lockedUntil: new Date('2026-09-10T10:00:00.000Z'),
      tokenVersion: 7,
      deletedAt: null,
      roles: [],
      ...overrides,
    }) as User;

  const listUsers = (count: number): User[] =>
    [ID_1, ID_2, ID_3].slice(0, count).map((id, i) =>
      buildUser({
        id,
        email: `user${i + 1}@example.com`,
        createdAt: new Date(`2026-09-0${3 - i}T10:00:00.000Z`),
      }),
    );

  const buildQuery = (
    overrides: Partial<ListUsersQueryDto> = {},
  ): ListUsersQueryDto => Object.assign(new ListUsersQueryDto(), overrides);

  const list = (query: ListUsersQueryDto) =>
    service.getUsersList(query, ADMIN_ID);

  const decode = (cursor: string): unknown =>
    JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

  beforeEach(async () => {
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(
      (key: string) => configValues[key],
    );
    for (const method of [
      'select',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'take',
    ] as const) {
      qbMock[method].mockReturnValue(qbMock);
    }
    qbMock.getMany.mockResolvedValue([]);
    usersRepoMock.createQueryBuilder.mockReturnValue(qbMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersListService,
        { provide: getRepositoryToken(User), useValue: usersRepoMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(UsersListService);
  });

  it('selects only the list columns, never secrets or auth state', async () => {
    await list(buildQuery());

    expect(qbMock.select).toHaveBeenCalledWith([
      'user.id',
      'user.email',
      'user.photo',
      'user.createdAt',
      'user.deletedAt',
    ]);
  });

  it('maps rows to list items without service fields', async () => {
    qbMock.getMany.mockResolvedValue([buildUser({ deletedAt: null })]);

    const { items } = await list(buildQuery());

    expect(Object.keys(items[0]).sort()).toEqual(
      ['createdAt', 'email', 'id', 'photo', 'status'].sort(),
    );
    for (const field of [
      'passwordHash',
      'tokenVersion',
      'failedLoginAttempts',
      'lockedUntil',
      'pendingEmail',
      'roles',
      'deletedAt',
    ]) {
      expect(items[0]).not.toHaveProperty(field);
    }
  });

  it('computes status: deletedAt null → active, set → deleted', async () => {
    qbMock.getMany.mockResolvedValue([
      buildUser({ id: ID_1, deletedAt: null }),
      buildUser({ id: ID_2, deletedAt: new Date('2026-09-20T00:00:00.000Z') }),
    ]);

    const { items } = await list(buildQuery());

    expect(items.map((item) => item.status)).toEqual([
      UserStatus.Active,
      UserStatus.Deleted,
    ]);
  });

  describe('sorting', () => {
    it('defaults to createdAt DESC with id DESC as the tie-breaker', async () => {
      await list(buildQuery());

      expect(qbMock.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
      expect(qbMock.addOrderBy).toHaveBeenCalledWith('user.id', 'DESC');
    });

    it('sorts by email ASC when requested, keeping id in the same direction', async () => {
      await list(
        buildQuery({ sort: UserSortField.Email, order: SortOrder.Asc }),
      );

      expect(qbMock.orderBy).toHaveBeenCalledWith('user.email', 'ASC');
      expect(qbMock.addOrderBy).toHaveBeenCalledWith('user.id', 'ASC');
    });
  });

  describe('limit', () => {
    it('requests limit + 1 rows to detect the next page without a COUNT', async () => {
      await list(buildQuery({ limit: 2 }));

      expect(qbMock.take).toHaveBeenCalledWith(3);
    });

    it('falls back to USERS_LIST_DEFAULT_LIMIT when limit is omitted', async () => {
      await list(buildQuery());

      expect(qbMock.take).toHaveBeenCalledWith(21);
    });

    it('accepts limit equal to USERS_LIST_MAX_LIMIT', async () => {
      await list(buildQuery({ limit: 100 }));

      expect(qbMock.take).toHaveBeenCalledWith(101);
    });

    it('rejects limit above USERS_LIST_MAX_LIMIT with 400, before querying', async () => {
      await expect(list(buildQuery({ limit: 101 }))).rejects.toThrow(
        new BadRequestException('limit must not be greater than 100'),
      );

      expect(usersRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('honors a different configured max', async () => {
      configServiceMock.get.mockImplementation((key: string) =>
        key === 'USERS_LIST_MAX_LIMIT' ? '10' : configValues[key],
      );

      await expect(list(buildQuery({ limit: 11 }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('pagination', () => {
    it('trims the extra row and returns a cursor pointing at the last returned item', async () => {
      qbMock.getMany.mockResolvedValue(listUsers(3));

      const result = await list(buildQuery({ limit: 2 }));

      expect(result.items.map((item) => item.id)).toEqual([ID_1, ID_2]);
      expect(result.nextCursor).not.toBeNull();
      expect(decode(result.nextCursor!)).toEqual({
        sort: UserSortField.CreatedAt,
        order: SortOrder.Desc,
        value: '2026-09-02T10:00:00.000Z',
        id: ID_2,
      });
    });

    it('returns nextCursor null on the last page', async () => {
      qbMock.getMany.mockResolvedValue(listUsers(2));

      const result = await list(buildQuery({ limit: 2 }));

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('puts the email into the cursor when sorting by email', async () => {
      qbMock.getMany.mockResolvedValue(listUsers(3));

      const result = await list(
        buildQuery({
          limit: 2,
          sort: UserSortField.Email,
          order: SortOrder.Asc,
        }),
      );

      expect(decode(result.nextCursor!)).toEqual({
        sort: UserSortField.Email,
        order: SortOrder.Asc,
        value: 'user2@example.com',
        id: ID_2,
      });
    });

    it('a cursor it issued round-trips into the keyset condition (desc → <)', async () => {
      qbMock.getMany.mockResolvedValueOnce(listUsers(3));
      const { nextCursor } = await list(buildQuery({ limit: 2 }));

      await list(buildQuery({ limit: 2, cursor: nextCursor! }));

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(user.createdAt, user.id) < (:value, :id)',
        { value: '2026-09-02T10:00:00.000Z', id: ID_2 },
      );
    });

    it('uses > for ascending order', async () => {
      const cursor = encodeUsersCursor({
        sort: UserSortField.Email,
        order: SortOrder.Asc,
        value: 'user2@example.com',
        id: ID_2,
      });

      await list(
        buildQuery({ sort: UserSortField.Email, order: SortOrder.Asc, cursor }),
      );

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(user.email, user.id) > (:value, :id)',
        { value: 'user2@example.com', id: ID_2 },
      );
    });

    // Validation cases themselves live in users-list-cursor.spec.ts; this
    // only pins that a rejected cursor stops the request before the DB.
    it('an invalid cursor → 400 without querying the database', async () => {
      await expect(list(buildQuery({ cursor: 'garbage!!' }))).rejects.toThrow(
        new BadRequestException('Invalid cursor'),
      );

      expect(qbMock.getMany).not.toHaveBeenCalled();
    });
  });

  describe('filters', () => {
    it('applies no filters when neither q nor status nor cursor is given', async () => {
      await list(buildQuery());

      expect(qbMock.andWhere).not.toHaveBeenCalled();
    });

    it('filters status=active by deletedAt IS NULL', async () => {
      await list(buildQuery({ status: UserStatus.Active }));

      expect(qbMock.andWhere).toHaveBeenCalledWith('user.deletedAt IS NULL');
    });

    it('filters status=deleted by deletedAt IS NOT NULL', async () => {
      await list(buildQuery({ status: UserStatus.Deleted }));

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'user.deletedAt IS NOT NULL',
      );
    });

    it('searches q as an email substring and escapes ILIKE wildcards', async () => {
      await list(buildQuery({ q: '50%_off' }));

      expect(qbMock.andWhere).toHaveBeenCalledWith('user.email ILIKE :q', {
        q: '%50\\%\\_off%',
      });
    });

    it('looks a full UUID in q up by exact id, not by email substring', async () => {
      await list(buildQuery({ q: ID_2 }));

      expect(qbMock.andWhere).toHaveBeenCalledTimes(1);
      expect(qbMock.andWhere).toHaveBeenCalledWith('user.id = :id', {
        id: ID_2,
      });
    });

    it('treats a partial UUID as an email substring (no partial-id search)', async () => {
      await list(buildQuery({ q: '22222222' }));

      expect(qbMock.andWhere).toHaveBeenCalledWith('user.email ILIKE :q', {
        q: '%22222222%',
      });
    });
  });

  it('logs users.list.viewed without the raw search query', async () => {
    qbMock.getMany.mockResolvedValue(listUsers(2));
    const logSpy = vi.spyOn(Logger.prototype, 'log');

    await list(
      buildQuery({ q: 'secret@example.com', status: UserStatus.Active }),
    );

    expect(logSpy).toHaveBeenCalledWith({
      event: 'users.list.viewed',
      actorUserId: ADMIN_ID,
      hasSearchQuery: true,
      status: UserStatus.Active,
      sort: UserSortField.CreatedAt,
      order: SortOrder.Desc,
      limit: 20,
      hasCursor: false,
      resultCount: 2,
      result: 200,
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      'secret@example.com',
    );
  });
});
