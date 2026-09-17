import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RbacConfigService } from '../services/rbac-config.service';

describe('RbacConfigService', () => {
  let service: RbacConfigService;

  const grantsRepoMock = {
    find: vi.fn<Repository<Grant>['find']>(),
  };

  const buildGrant = (overrides: Partial<Grant> = {}): Grant =>
    ({
      id: 'grant-id',
      roleId: 'role-id',
      role: { id: 'role-id', name: 'admin' } as Role,
      permissionId: 'permission-id',
      permission: { id: 'permission-id', name: 'rbac' } as Permission,
      actions: null,
      ...overrides,
    }) as Grant;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacConfigService,
        { provide: getRepositoryToken(Grant), useValue: grantsRepoMock },
      ],
    }).compile();

    service = module.get(RbacConfigService);
  });

  describe('onModuleInit', () => {
    it('loads the grant map at startup', async () => {
      grantsRepoMock.find.mockResolvedValue([buildGrant()]);

      await service.onModuleInit();

      expect(grantsRepoMock.find).toHaveBeenCalledWith({
        relations: ['role', 'permission'],
      });
      expect(service.getGrantsForRole('admin')).toEqual([
        { permissionName: 'rbac', actions: null },
      ]);
    });
  });

  describe('reload', () => {
    it('rebuilds the map from the repository, keyed by role name', async () => {
      grantsRepoMock.find.mockResolvedValue([
        buildGrant({
          role: { id: 'role-1', name: 'editor' } as Role,
          permission: { id: 'perm-1', name: 'articles' } as Permission,
          actions: ['create', 'update'],
        }),
      ]);

      await service.reload();

      expect(service.getGrantsForRole('editor')).toEqual([
        { permissionName: 'articles', actions: ['create', 'update'] },
      ]);
    });

    it('groups multiple grants for the same role into one list', async () => {
      grantsRepoMock.find.mockResolvedValue([
        buildGrant({
          role: { id: 'role-1', name: 'editor' } as Role,
          permission: { id: 'perm-1', name: 'articles' } as Permission,
        }),
        buildGrant({
          role: { id: 'role-1', name: 'editor' } as Role,
          permission: { id: 'perm-2', name: 'comments' } as Permission,
        }),
      ]);

      await service.reload();

      expect(service.getGrantsForRole('editor')).toHaveLength(2);
    });

    it('replaces the previous map instead of merging into it', async () => {
      grantsRepoMock.find.mockResolvedValue([buildGrant()]);
      await service.reload();
      expect(service.getGrantsForRole('admin')).toHaveLength(1);

      grantsRepoMock.find.mockResolvedValue([]);
      await service.reload();

      expect(service.getGrantsForRole('admin')).toEqual([]);
    });

    it('returns an empty array for a role with no grants', async () => {
      grantsRepoMock.find.mockResolvedValue([]);

      await service.reload();

      expect(service.getGrantsForRole('user')).toEqual([]);
    });
  });

  describe('hasPermission', () => {
    it('allows any action when the grant has no actions restriction', async () => {
      grantsRepoMock.find.mockResolvedValue([buildGrant({ actions: null })]);
      await service.reload();

      expect(service.hasPermission(['admin'], 'rbac', 'delete')).toBe(true);
    });

    it('allows the action only when it is in the grant’s actions list', async () => {
      grantsRepoMock.find.mockResolvedValue([
        buildGrant({
          role: { id: 'role-1', name: 'editor' } as Role,
          permission: { id: 'perm-1', name: 'articles' } as Permission,
          actions: ['create', 'update'],
        }),
      ]);
      await service.reload();

      expect(service.hasPermission(['editor'], 'articles', 'create')).toBe(
        true,
      );
      expect(service.hasPermission(['editor'], 'articles', 'delete')).toBe(
        false,
      );
    });

    it('returns false when none of the user’s roles have a grant for the resource', async () => {
      grantsRepoMock.find.mockResolvedValue([
        buildGrant({
          role: { id: 'role-1', name: 'editor' } as Role,
          permission: { id: 'perm-1', name: 'articles' } as Permission,
        }),
      ]);
      await service.reload();

      expect(service.hasPermission(['editor'], 'rbac', 'read')).toBe(false);
    });

    it('returns false (not a throw) when the role is not present in the cached config at all', async () => {
      grantsRepoMock.find.mockResolvedValue([]);
      await service.reload();

      expect(service.hasPermission(['role-not-in-cache'], 'rbac', 'read')).toBe(
        false,
      );
    });

    it('allows access when at least one of several roles grants it (union, not intersection)', async () => {
      grantsRepoMock.find.mockResolvedValue([buildGrant()]);
      await service.reload();

      expect(service.hasPermission(['user', 'admin'], 'rbac', 'read')).toBe(
        true,
      );
    });
  });
});
