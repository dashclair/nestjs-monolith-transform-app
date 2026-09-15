import {
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';
import { RbacConfigService } from './rbac-config.service';
import { Permission } from '../entities/permission.entity';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';

@Injectable()
export class PermissionsService {
    private readonly logger = new Logger(PermissionsService.name)

    constructor(
        @InjectRepository(Permission) private readonly permissionsRepo: Repository<Permission>,
        @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
        private readonly rbacConfigService: RbacConfigService,
    ) { }

    async create(dto: CreatePermissionDto, actorUserId: string): Promise<Permission> {
        const existing = await this.permissionsRepo.findOneBy({ name: dto.name });
        if (existing) {
            throw new ConflictException('Permission with this name already exists');

        }

        const permission = await this.permissionsRepo.save(this.permissionsRepo.create(dto));
        await this.rbacConfigService.reload();
        this.logger.log({ event: 'rbac.permission.created', actorUserId, permissionId: permission.id });
        return permission;
    }

    findAll(): Promise<Permission[]> {
        return this.permissionsRepo.find();
    }

    async update(permissionId: string, dto: UpdatePermissionDto, actorUserId: string): Promise<Permission> {
        const permission = await this.permissionsRepo.findOneBy({ id: permissionId});
        if (!permission) {
            throw new NotFoundException('Permission not found');
        }

        if (dto.name && dto.name !== permission.name) {
            const duplicate = await this.permissionsRepo.findOneBy({ name: dto.name });
            if (duplicate) {
                throw new ConflictException('Permission with this name already exists');
            }
        }

        if (dto.name !== undefined) permission.name = dto.name;
        if (dto.actions !== undefined) permission.actions = dto.actions;
        const saved = await this.permissionsRepo.save(permission);
        await this.rbacConfigService.reload();
        this.logger.log({ event: 'rbac.permission.updated', actorUserId, permissionId });
        return saved;
    }

    async remove(permissionId: string, actorUserId: string): Promise<void> {
        const permission = await this.permissionsRepo.findOneBy({ id: permissionId });
        if (!permission) {
            throw new NotFoundException('Permission not found');
        }

        const activeGrants = await this.grantsRepo.count({ where: { permissionId } });
        if (activeGrants > 0) {
            throw new ConflictException('Cannot delete: active grants exist');
        }

        await this.permissionsRepo.remove(permission);
        await this.rbacConfigService.reload();
        this.logger.log({ event: 'rbac.permission.deleted', actorUserId, permissionId });
    }
}