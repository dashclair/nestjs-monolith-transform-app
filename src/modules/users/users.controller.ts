import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { SelfOrPermission } from "../../core/self-or-permission/self-or-permission.decorator";
import { UserProfileDto } from "./dto/user-profile.dto";
import { UsersService } from "./services/users.service";
import { SelfOrPermissionAccessContext } from "../../core/self-or-permission/self-or-permission-access.decorator";
import { SelfOrPermissionGuard } from "../../core/self-or-permission/self-or-permission.guard";
import type { SelfOrPermissionAccess } from "../../core/self-or-permission/self-or-permission.types";
import { seconds, Throttle } from "@nestjs/throttler";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import { ConfirmEmailChangeLinkQueryDto } from "./dto/confirm-email-change-link.query.dto";
import { SelfOnly, SelfOnlyGuard } from "@/core/self-or-permission/self-only.guard";

@ApiTags('Users')
@UseGuards(SelfOrPermissionGuard)
@UseGuards(SelfOnlyGuard)
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

    @Patch(':userId')
    @SelfOrPermission('userId', 'users', 'update')
    async updateUser(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: UpdateUserDto,
        @SelfOrPermissionAccessContext()
        access: SelfOrPermissionAccess,
    ) {
        return this.usersService.updateUser(userId, dto, access);
    }

    @Post(':userId/email-change')
    @SelfOnly('userId')
    @HttpCode(HttpStatus.OK)
    async initiateEmailChange(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: ChangeEmailDto,
    ) {
        return this.usersService.initiateEmailChange(userId, dto.newEmail);
    }

    @Post(':userId/email-change/confirm')
    @SelfOnly('userId')
    @HttpCode(HttpStatus.OK)
    async confirmEmailChange(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: ConfirmEmailChangeDto,
    ) {
        return this.usersService.confirmEmailChange(userId, dto.code);
    }

    @Get(':userId/email-change/confirm-link')
    @SelfOnly('userId')
    async confirmEmailChangeLink(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Query() dto: ConfirmEmailChangeLinkQueryDto,
    ) {
        return this.usersService.confirmEmailChange(userId, dto.token);
    }
}