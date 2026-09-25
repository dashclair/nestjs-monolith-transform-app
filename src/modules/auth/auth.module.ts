import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthCoreModule } from '@/core/auth/auth-core.module';
import { EmailVerificationModule } from '@/core/email-verification/email-verification.module';
import { UsersModule } from '@/modules/users/users.module';
import { SettingsModule } from '@/modules/settings/settings.module';

import { AuthController } from './auth.controller';
import { RefreshSession } from './entities/refresh-session.entity';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { RefreshSessionService } from './services/refresh-session.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    SettingsModule,
    AuthCoreModule,
    EmailVerificationModule,
    TypeOrmModule.forFeature([RefreshSession]),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshSessionService, JwtStrategy],
})
export class AuthModule {}
