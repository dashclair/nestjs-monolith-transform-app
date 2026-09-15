import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Role } from '../entities/role.entity';
import { RbacConfigService } from '../services/rbac-config.service';
import { RolesService } from '../services/roles.service';

describe('RolesService', () => {
  let service: RolesService;

  const rolesRepoMock = {
    find: vi.fn<Repository<Role>['find']>(),
    findOneBy: vi.fn<Repository<Role>['findOneBy']>(),
    create: vi.fn<Repository<Role>['create']>(),
    save: vi.fn<Repository<Role>['save']>(),
    remove: vi.fn<Repository<Role>['remove']>(),
  };
  const grantsRepoMock = {
    count: vi.fn<Repository<Grant>['count']>(),
  };
  const rbacConfigServiceMock = {
    reload: vi.fn(),
  };

  const buildRole = (overrides: Partial<Role> = {}): Role =>
    ({
      id: 'role-id',
      name: 'editor',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Role;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useValue: rolesRepoMock },
        { provide: getRepositoryToken(Grant), useValue: grantsRepoMock },
        { provide: RbacConfigService, useValue: rbacConfigServiceMock },
      ],
    }).compile();

    service = module.get(RolesService);
  });

  describe('findAll', () => {
    it('returns every role', async () => {
      rolesRepoMock.find.mockResolvedValue([buildRole()]);

      await expect(service.findAll()).resolves.toHaveLength(1);
    });
  });

  describe('create', () => {
    it('throws ConflictException when the name is already taken', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(buildRole());

      await expect(
        service.create({ name: 'editor' }, 'actor-id'),
      ).rejects.toThrow(ConflictException);
      expect(rolesRepoMock.save).not.toHaveBeenCalled();
    });

    it('creates the role and reloads the RBAC cache', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(null);
      rolesRepoMock.create.mockReturnValue(buildRole() as never);
      rolesRepoMock.save.mockResolvedValue(buildRole());

      const result = await service.create(
        { name: 'editor', description: 'can edit' },
        'actor-id',
      );

      expect(result.name).toBe('editor');
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the role does not exist', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'new-name' }, 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when renaming to an already-used name', async () => {
      rolesRepoMock.findOneBy
        .mockResolvedValueOnce(buildRole({ name: 'editor' }))
        .mockResolvedValueOnce(buildRole({ id: 'other-id', name: 'admin' }));

      await expect(
        service.update('role-id', { name: 'admin' }, 'actor-id'),
      ).rejects.toThrow(ConflictException);
    });

    it('does not check for duplicates when the name is left unchanged', async () => {
      rolesRepoMock.findOneBy.mockResolvedValueOnce(buildRole({ name: 'editor' }));
      rolesRepoMock.save.mockResolvedValue(buildRole({ description: 'updated' }));

      await service.update('role-id', { description: 'updated' }, 'actor-id');

      expect(rolesRepoMock.findOneBy).toHaveBeenCalledTimes(1);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the role does not exist', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id', 'actor-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the role still has active grants', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(buildRole());
      grantsRepoMock.count.mockResolvedValue(1);

      await expect(service.remove('role-id', 'actor-id')).rejects.toThrow(
        ConflictException,
      );
      expect(rolesRepoMock.remove).not.toHaveBeenCalled();
    });

    it('removes the role and reloads the cache when there are no active grants', async () => {
      const role = buildRole();
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      grantsRepoMock.count.mockResolvedValue(0);

      await service.remove('role-id', 'actor-id');

      expect(rolesRepoMock.remove).toHaveBeenCalledWith(role);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });
});
