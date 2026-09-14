import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from '../entities/grant.entity';

interface CachedGrant {
  permissionName: string;
  actions: string[] | null;
}

@Injectable()
export class RbacConfigService implements OnModuleInit {
  private readonly logger = new Logger(RbacConfigService.name);
  private grantsByRoleName = new Map<string, CachedGrant[]>();

  constructor(
    @InjectRepository(Grant) private readonly grantsRepo: Repository<Grant>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const grants = await this.grantsRepo.find({
      relations: ['role', 'permission'],
    });

    const next = new Map<string, CachedGrant[]>();
    for (const grant of grants) {
      const list = next.get(grant.role.name) ?? [];
      list.push({
        permissionName: grant.permission.name,
        actions: grant.actions ?? null,
      });
      next.set(grant.role.name, list);
    }

    this.grantsByRoleName = next;
    this.logger.log({ event: 'rbac.config.reloaded', grantsCount: grants.length });
  }

  getGrantsForRole(roleName: string): CachedGrant[] {
    return this.grantsByRoleName.get(roleName) ?? [];
  }
}