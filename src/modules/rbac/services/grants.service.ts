import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { CreateGrantDto } from '../dto/create-grant.dto';
import { UpdateGrantDto } from '../dto/update-grant.dto';
import { RbacConfigService } from './rbac-config.service';

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepo: Repository<Permission>,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  findAll(): Promise<Grant[]> {
    return this.grantsRepo.find({ relations: ['role', 'permission'] });
  }

  private assertActionsSubset(actions: string[] | undefined, permission: Permission): void {
    if (!actions || actions.length === 0) return;
    const hasInvalid = actions.some((a) => !permission.actions.includes(a));
    if (hasInvalid) {
      throw new BadRequestException('Invalid actions for this permission');
    }
  }

  async create(dto: CreateGrantDto, actorUserId: string): Promise<Grant> {
    const role = await this.rolesRepo.findOneBy({ id: dto.roleId });
    if (!role) throw new NotFoundException('Role not found');

    const permission = await this.permissionsRepo.findOneBy({ id: dto.permissionId });
    if (!permission) throw new NotFoundException('Permission not found');

    this.assertActionsSubset(dto.actions, permission);

    const duplicate = await this.grantsRepo.findOneBy({
      roleId: dto.roleId,
      permissionId: dto.permissionId,
    });
    if (duplicate) {
      throw new ConflictException('Grant already exists for this role and permission');
    }

    const grant = await this.grantsRepo.save(
      this.grantsRepo.create({
        roleId: dto.roleId,
        permissionId: dto.permissionId,
        actions: dto.actions ?? null,
      }),
    );
    await this.rbacConfigService.reload();
    this.logger.log({ event: 'rbac.grant.created', actorUserId, grantId: grant.id });
    return grant;
  }

  async update(grantId: string, dto: UpdateGrantDto, actorUserId: string): Promise<Grant> {
    const grant = await this.grantsRepo.findOne({
      where: { id: grantId },
      relations: ['permission'],
    });
    if (!grant) throw new NotFoundException('Grant not found');

    this.assertActionsSubset(dto.actions, grant.permission);

    grant.actions = dto.actions ?? null;
    const saved = await this.grantsRepo.save(grant);
    await this.rbacConfigService.reload();
    this.logger.log({ event: 'rbac.grant.updated', actorUserId, grantId });
    return saved;
  }

  async remove(grantId: string, actorUserId: string): Promise<void> {
    const grant = await this.grantsRepo.findOneBy({ id: grantId });
    if (!grant) throw new NotFoundException('Grant not found');

    await this.grantsRepo.remove(grant);
    await this.rbacConfigService.reload();
    this.logger.log({ event: 'rbac.grant.deleted', actorUserId, grantId });
  }
}
