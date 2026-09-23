import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { SelfOrPermission } from "../../core/self-or-permission/self-or-permission.decorator";
import { UserProfileDto } from "./dto/user-profile.dto";
import { UsersService } from "./services/users.service";
import { UsersListService } from "./services/users-list.service";
import { SelfOrPermissionAccessContext } from "../../core/self-or-permission/self-or-permission-access.decorator";
import { SelfOrPermissionGuard } from "../../core/self-or-permission/self-or-permission.guard";
import type { SelfOrPermissionAccess } from "../../core/self-or-permission/self-or-permission.types";
import { seconds, Throttle } from "@nestjs/throttler";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import { ConfirmEmailChangeLinkQueryDto } from "./dto/confirm-email-change-link.query.dto";
import { SelfOnly, SelfOnlyGuard } from "@/core/self-or-permission/self-only.guard";
import { DeleteRequestDto } from "./dto/delete-request.dto";
import { ConfirmDeleteDto } from "./dto/confirm-delete.dto";
import { ConfirmDeleteLinkQueryDto } from "./dto/confirm-delete-link.query.dto";
import { PermissionsGuard } from "@/modules/rbac/guards/permissions.guard";
import { RequirePermission } from "@/modules/rbac/decorators/require-permission.decorator";
import type { RequestUser } from "@/core/auth/auth.types";
import { ListUsersQueryDto, ListUsersResponseDto } from "./dto/list-users.dto";
import { throttleFromConfig } from "@/core/throttler/throttle-from-config";

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('Users')
@UseGuards(SelfOrPermissionGuard)
@UseGuards(SelfOnlyGuard)
@UseGuards(PermissionsGuard)
@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly usersListService: UsersListService,
    ) { }

    @Throttle(throttleFromConfig('THROTTLE_USERS_LIST_LIMIT', 'THROTTLE_USERS_LIST_TTL'))
    @Get()
    @RequirePermission('users', 'list')
    async getUsersList(
        @Query() query: ListUsersQueryDto,
        @Req() request: AuthenticatedRequest,
    ): Promise<ListUsersResponseDto> {
        return this.usersListService.getUsersList(query, request.user.userId)
    }

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

    @Post(':userId/delete-request')
    @SelfOnly('userId')
    @HttpCode(HttpStatus.OK)
    async requestDelete(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: DeleteRequestDto,
    ) {
        return this.usersService.requestDelete(userId, dto.reason);
    }

    @Post(':userId/delete/confirm')
    @SelfOnly('userId')
    @HttpCode(HttpStatus.OK)
    async confirmDelete(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: ConfirmDeleteDto,
        @Res({ passthrough: true }) response: FastifyReply,
    ) {
        const result = await this.usersService.confirmDelete(userId, dto.code);
        this.clearSessionCookies(response);
        return result;
    }

    @Get(':userId/delete/confirm-link')
    @SelfOnly('userId')
    async confirmDeleteLink(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Query() dto: ConfirmDeleteLinkQueryDto,
        @Res({ passthrough: true }) response: FastifyReply,
    ) {
        const result = await this.usersService.confirmDelete(userId, dto.token);
        this.clearSessionCookies(response);
        return result;
    }

    @RequirePermission('users', 'delete')
    @Delete(':userId')
    async deleteUserByPermission(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Req() request: AuthenticatedRequest,
    ) {
        return this.usersService.deleteUserByPermission(userId, request.user.userId);
    }

    private clearSessionCookies(response: FastifyReply): void {
        response.clearCookie('access_token', { path: '/' });
        response.clearCookie('refresh_token', { path: '/auth/refresh' });
    }
}