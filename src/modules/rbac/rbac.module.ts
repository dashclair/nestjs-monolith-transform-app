import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { GrantsController } from './grants.controller';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { PermissionsGuard } from './guards/permissions.guard';
import { GrantsService } from './services/grants.service';
import { PermissionsService } from './services/permissions.service';
import { RbacConfigService } from './services/rbac-config.service';
import { RolesService } from './services/roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, Grant])],
  controllers: [RolesController, PermissionsController, GrantsController],
  providers: [
    RbacConfigService,
    PermissionsGuard,
    RolesService,
    PermissionsService,
    GrantsService,
  ],
  exports: [RbacConfigService, PermissionsGuard],
})
export class RbacModule {}
