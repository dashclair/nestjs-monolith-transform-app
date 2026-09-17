import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { SelfOrPermission } from "../../core/self-or-permission/self-or-permission.decorator";
import { UserProfileDto } from "./dto/user-profile.dto";
import { UsersService } from "./services/users.service";
import { SelfOrPermissionAccessContext } from "../../core/self-or-permission/self-or-permission-access.decorator";
import { SelfOrPermissionGuard } from "../../core/self-or-permission/self-or-permission.guard";
import type { SelfOrPermissionAccess } from "../../core/self-or-permission/self-or-permission.types";
import { seconds, Throttle } from "@nestjs/throttler";

@ApiTags('Users')
@UseGuards(SelfOrPermissionGuard)
@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
    ) { }

    @Throttle({ default: { limit: 20, ttl: seconds(60) } })
    @Get(':userId')
    @SelfOrPermission('userId', 'users', 'read')
    async getUser(
        @Param('userId', ParseUUIDPipe) userId: string,
        @SelfOrPermissionAccessContext() access: SelfOrPermissionAccess
    ): Promise<UserProfileDto> {
        return this.usersService.getUserProfile(userId, access)
    }
}