import { Module } from '@nestjs/common';

import { AuthCoreModule } from '@/core/auth/auth-core.module';
import { EmailVerificationModule } from '@/core/email-verification/email-verification.module';
import { UsersModule } from '@/modules/users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [UsersModule, AuthCoreModule, EmailVerificationModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtStrategy],
})
export class AuthModule {}
