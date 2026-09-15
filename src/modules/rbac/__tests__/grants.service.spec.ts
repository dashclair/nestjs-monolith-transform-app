import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { GrantsService } from '../services/grants.service';
import { RbacConfigService } from '../services/rbac-config.service';

describe('GrantsService', () => {
  let service: GrantsService;

  const grantsRepoMock = {
    find: vi.fn<Repository<Grant>['find']>(),
    findOne: vi.fn<Repository<Grant>['findOne']>(),
    findOneBy: vi.fn<Repository<Grant>['findOneBy']>(),
    create: vi.fn<Repository<Grant>['create']>(),
    save: vi.fn<Repository<Grant>['save']>(),
    remove: vi.fn<Repository<Grant>['remove']>(),
  };
  const rolesRepoMock = {
    findOneBy: vi.fn<Repository<Role>['findOneBy']>(),
  };
  const permissionsRepoMock = {
    findOneBy: vi.fn<Repository<Permission>['findOneBy']>(),
  };
  const rbacConfigServiceMock = {
    reload: vi.fn(),
  };

  const role = { id: 'role-id', name: 'editor' } as Role;
  const permission = {
    id: 'permission-id',
    name: 'articles',
    actions: ['create', 'update', 'delete'],
  } as Permission;

  const buildGrant = (overrides: Partial<Grant> = {}): Grant =>
    ({
      id: 'grant-id',
      roleId: role.id,
      permissionId: permission.id,
      permission,
      actions: null,
      ...overrides,
    }) as Grant;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantsService,
        { provide: getRepositoryToken(Grant), useValue: grantsRepoMock },
        { provide: getRepositoryToken(Role), useValue: rolesRepoMock },
        { provide: getRepositoryToken(Permission), useValue: permissionsRepoMock },
        { provide: RbacConfigService, useValue: rbacConfigServiceMock },
      ],
    }).compile();

    service = module.get(GrantsService);
  });

  describe('create', () => {
    it('throws NotFoundException when the role does not exist', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ roleId: 'missing', permissionId: permission.id }, 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the permission does not exist', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      permissionsRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ roleId: role.id, permissionId: 'missing' }, 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when actions is not a subset of the permission’s actions', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      permissionsRepoMock.findOneBy.mockResolvedValue(permission);

      await expect(
        service.create(
          { roleId: role.id, permissionId: permission.id, actions: ['publish'] },
          'actor-id',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(grantsRepoMock.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a grant for this role+permission already exists', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      permissionsRepoMock.findOneBy.mockResolvedValue(permission);
      grantsRepoMock.findOneBy.mockResolvedValue(buildGrant());

      await expect(
        service.create({ roleId: role.id, permissionId: permission.id }, 'actor-id'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the grant with actions = null when none are given (all actions allowed)', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      permissionsRepoMock.findOneBy.mockResolvedValue(permission);
      grantsRepoMock.findOneBy.mockResolvedValue(null);
      grantsRepoMock.create.mockReturnValue(buildGrant() as never);
      grantsRepoMock.save.mockResolvedValue(buildGrant());

      const result = await service.create(
        { roleId: role.id, permissionId: permission.id },
        'actor-id',
      );

      expect(grantsRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ actions: null }),
      );
      expect(result).toBeDefined();
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });

    it('creates the grant with a restricted actions list when given', async () => {
      rolesRepoMock.findOneBy.mockResolvedValue(role);
      permissionsRepoMock.findOneBy.mockResolvedValue(permission);
      grantsRepoMock.findOneBy.mockResolvedValue(null);
      grantsRepoMock.create.mockReturnValue(buildGrant({ actions: ['create'] }) as never);
      grantsRepoMock.save.mockResolvedValue(buildGrant({ actions: ['create'] }));

      await service.create(
        { roleId: role.id, permissionId: permission.id, actions: ['create'] },
        'actor-id',
      );

      expect(grantsRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ actions: ['create'] }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the grant does not exist', async () => {
      grantsRepoMock.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { actions: ['create'] }, 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the new actions are not a subset of the permission’s actions', async () => {
      grantsRepoMock.findOne.mockResolvedValue(buildGrant());

      await expect(
        service.update('grant-id', { actions: ['publish'] }, 'actor-id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates actions and reloads the cache', async () => {
      grantsRepoMock.findOne.mockResolvedValue(buildGrant());
      grantsRepoMock.save.mockResolvedValue(buildGrant({ actions: ['create'] }));

      const result = await service.update(
        'grant-id',
        { actions: ['create'] },
        'actor-id',
      );

      expect(result.actions).toEqual(['create']);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });

    it('clears the actions restriction back to null (all actions) when an empty update is sent', async () => {
      grantsRepoMock.findOne.mockResolvedValue(buildGrant({ actions: ['create'] }));
      grantsRepoMock.save.mockResolvedValue(buildGrant({ actions: null }));

      await service.update('grant-id', {}, 'actor-id');

      expect(grantsRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ actions: null }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the grant does not exist', async () => {
      grantsRepoMock.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id', 'actor-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the grant and reloads the cache', async () => {
      const grant = buildGrant();
      grantsRepoMock.findOneBy.mockResolvedValue(grant);

      await service.remove('grant-id', 'actor-id');

      expect(grantsRepoMock.remove).toHaveBeenCalledWith(grant);
      expect(rbacConfigServiceMock.reload).toHaveBeenCalledTimes(1);
    });
  });
});
