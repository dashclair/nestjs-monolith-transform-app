import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Role } from '../entities/role.entity';
import { CreateRoleDto } from '../dto/create-role.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { RbacConfigService } from './rbac-config.service';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  findAll(): Promise<Role[]> {
    return this.rolesRepo.find();
  }

  async create(dto: CreateRoleDto, actorUserId: string): Promise<Role> {
    const existing = await this.rolesRepo.findOneBy({ name: dto.name });
    if (existing) {
      throw new ConflictException('Role with this name already exists');
    }

    const role = await this.rolesRepo.save(this.rolesRepo.create(dto));
    await this.rbacConfigService.reload();
    this.logger.log({
      event: 'rbac.role.created',
      actorUserId,
      roleId: role.id,
    });
    return role;
  }

  async update(
    roleId: string,
    dto: UpdateRoleDto,
    actorUserId: string,
  ): Promise<Role> {
    const role = await this.rolesRepo.findOneBy({ id: roleId });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (dto.name && dto.name !== role.name) {
      const duplicate = await this.rolesRepo.findOneBy({ name: dto.name });
      if (duplicate) {
        throw new ConflictException('Role with this name already exists');
      }
    }

    if (dto.name !== undefined) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    const saved = await this.rolesRepo.save(role);
    await this.rbacConfigService.reload();
    this.logger.log({ event: 'rbac.role.updated', actorUserId, roleId });
    return saved;
  }

  async remove(roleId: string, actorUserId: string): Promise<void> {
    const role = await this.rolesRepo.findOneBy({ id: roleId });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const activeGrants = await this.grantsRepo.count({ where: { roleId } });
    if (activeGrants > 0) {
      throw new ConflictException('Cannot delete: active grants exist');
    }

    await this.rolesRepo.remove(role);
    await this.rbacConfigService.reload();
    this.logger.log({ event: 'rbac.role.deleted', actorUserId, roleId });
  }
}
