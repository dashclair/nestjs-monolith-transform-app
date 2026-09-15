import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { PermissionsService } from '../services/permissions.service';
import { RbacConfigService } from '../services/rbac-config.service';

describe('PermissionsService', () => {
  let service: PermissionsService;

  const permissionsRepoMock = {
    find: vi.fn<Repository<Permission>['find']>(),
    findOneBy: vi.fn<Repository<Permission>['findOneBy']>(),
    create: vi.fn<Repository<Permission>['create']>(),
    save: vi.fn<Repository<Permission>['save']>(),
    remove: vi.fn<Repository<Permission>['remove']>(),
  };
  const grantsRepoMock = {
    count: vi.fn<Repository<Grant>['count']>(),
  };
  const rbacConfigServiceMock = {
    reload: vi.fn(),
  };

  const buildPermission = (overrides: Partial<Permission> = {}): Permission =>
    ({
      id: 'permission-id',
      name: 'articles',
      actions: ['create', 'update', 'delete'],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Permission;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: getRepositoryToken(Permission), useValue: permissionsRepoMock },
        { provide: getRepositoryToken(Grant), useValue: grantsRepoMock },
        { provide: RbacConfigService, useValue: rbacConfigServiceMock },
      ],
    }).compile();

    service = module.get(PermissionsService);
  });

  describe('findAll', () => {
    it('returns every permission', async () => {
      permissionsRepoMock.find.mockResolvedValue([buildPermission()]);

      await expect(service.findAll()).resolves.toHaveLength(1);
    });
  });

  describe('create', () => {
    it('throws ConflictException when the name is already taken', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValue(buildPermission());

      await expect(
        service.create({ name: 'articles', actions: ['create'] }, 'actor-id'),
      ).rejects.toThrow(ConflictException);
      expect(permissionsRepoMock.save).not.toHaveBeenCalled();
    });

    it('creates the permission and reloads the RBAC cache', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValue(null);
      permissionsRepoMock.create.mockReturnValue(buildPermission() as never);
      permissionsRepoMock.save.mockResolvedValue(buildPermission());

      const result = await service.create(
        { name: 'articles', actions: ['create', 'update'] },
        'actor-id',
      );

      expect(result.name).toBe('articles');
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the permission does not exist', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'renamed' }, 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when renaming to an already-used name', async () => {
      permissionsRepoMock.findOneBy
        .mockResolvedValueOnce(buildPermission({ name: 'articles' }))
        .mockResolvedValueOnce(buildPermission({ id: 'other-id', name: 'comments' }));

      await expect(
        service.update('permission-id', { name: 'comments' }, 'actor-id'),
      ).rejects.toThrow(ConflictException);
    });

    it('updates the actions list and reloads the cache', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValueOnce(buildPermission());
      permissionsRepoMock.save.mockResolvedValue(
        buildPermission({ actions: ['create'] }),
      );

      const result = await service.update(
        'permission-id',
        { actions: ['create'] },
        'actor-id',
      );

      expect(result.actions).toEqual(['create']);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the permission does not exist', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id', 'actor-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the permission still has active grants', async () => {
      permissionsRepoMock.findOneBy.mockResolvedValue(buildPermission());
      grantsRepoMock.count.mockResolvedValue(2);

      await expect(service.remove('permission-id', 'actor-id')).rejects.toThrow(
        ConflictException,
      );
      expect(permissionsRepoMock.remove).not.toHaveBeenCalled();
    });

    it('removes the permission and reloads the cache when there are no active grants', async () => {
      const permission = buildPermission();
      permissionsRepoMock.findOneBy.mockResolvedValue(permission);
      grantsRepoMock.count.mockResolvedValue(0);

      await service.remove('permission-id', 'actor-id');

      expect(permissionsRepoMock.remove).toHaveBeenCalledWith(permission);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });
});
