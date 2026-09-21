import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailVerificationModule } from '@/core/email-verification/email-verification.module';
import { Role } from '@/modules/rbac/entities/role.entity';
import { RbacModule } from '@/modules/rbac/rbac.module';

import { UsersController } from './users.controller';
import { UsersService } from './services/users.service';
import { UserProfileFieldsPolicy } from './services/user-profile-policy.service';
import { UserUpdateFieldsPolicy } from './services/user-update-fields-policy.service';
import { User } from './entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    RbacModule,
    EmailVerificationModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UserProfileFieldsPolicy, UserUpdateFieldsPolicy],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
