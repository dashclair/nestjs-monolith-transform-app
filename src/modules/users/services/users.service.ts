import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import { Repository } from 'typeorm';

import { DEFAULT_ROLE_NAME } from '@/modules/rbac/rbac.constants';
import { Role } from '@/modules/rbac/entities/role.entity';


import { plainToInstance } from 'class-transformer';
import { User } from '../entities/user.entity';
import { UserProfileDto } from '../dto/user-profile.dto';
import { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';
import { UserProfileFieldsPolicy } from './user-profile-policy.service';
import { UserProfileField } from '../types/user-profile-policy.types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,

    private readonly userProfileFieldsPolicy: UserProfileFieldsPolicy
  ) { }

  findByEmail(email: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations });
  }

  findById(id: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    isEmailVerified: boolean;
    roles?: Role[];
  }): Promise<User> {
    const roles = data.roles ?? (await this.findDefaultRole());
    return this.repo.save(this.repo.create({ ...data, roles }));
  }

  private async findDefaultRole(): Promise<Role[]> {
    const role = await this.roleRepo.findOneBy({ name: DEFAULT_ROLE_NAME });
    if (!role) {
      throw new Error(
        `Default role "${DEFAULT_ROLE_NAME}" not found — has the RBAC seed migration run?`,
      );
    }
    return [role];
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async getUserProfile(
    userId: string,
    access: SelfOrPermissionAccess,
  ): Promise<UserProfileDto> {
    const allowedFields =
      this.userProfileFieldsPolicy.getAllowedFields(access);

    const isAllowed = (field: UserProfileField) =>
      allowedFields.includes(field);

    const user = await this.repo.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: isAllowed(UserProfileField.Email),
        photo: isAllowed(UserProfileField.Photo),
        isEmailVerified: isAllowed(UserProfileField.IsEmailVerified),
        createdAt: isAllowed(UserProfileField.CreatedAt),
      },
    });

    if (!user) {
      this.logger.log({
        event: 'users.profile.viewed',
        viewerUserId: access.actorUserId,
        targetUserId: userId,
        result: 404,
      });
      throw new NotFoundException('User not found');
    }

    const profile: Partial<UserProfileDto> = {};

    if (isAllowed(UserProfileField.Id)) {
      profile.id = user.id;
    }

    if (isAllowed(UserProfileField.Email)) {
      profile.email = user.email;
    }

    if (isAllowed(UserProfileField.Photo)) {
      profile.photo = user.photo ?? null;
    }

    if (isAllowed(UserProfileField.IsEmailVerified)) {
      profile.isEmailVerified = user.isEmailVerified;
    }

    if (isAllowed(UserProfileField.CreatedAt)) {
      profile.createdAt = user.createdAt;
    }

    this.logger.log({
      event: 'users.profile.viewed',
      viewerUserId: access.actorUserId,
      targetUserId: userId,
      result: 200,
    });

    return plainToInstance(UserProfileDto, profile, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Recorded in its own transaction (REQUIRES_NEW) so the attempt count and
   * lockout survive even when the caller (AuthService.login()) throws right
   * after this resolves — a throw there would otherwise roll back the
   * enclosing @Transactional() call, silently discarding the increment and
   * making AUTH_LOGIN_MAX_FAILED_ATTEMPTS never actually trigger.
   */
  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  async recordFailedLoginAttempt(
    user: User,
    {
      maxAttempts,
      lockoutMinutes,
    }: { maxAttempts: number; lockoutMinutes: number },
  ): Promise<boolean> {
    user.failedLoginAttempts += 1;
    const locked = user.failedLoginAttempts >= maxAttempts;
    if (locked) {
      user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
    }
    await this.repo.save(user);
    return locked;
  }
}
