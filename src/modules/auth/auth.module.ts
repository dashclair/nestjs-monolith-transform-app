import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailerModule } from '@/core/mailer/mailer.module';
import { UsersModule } from '@/modules/users/users.module';

import { AuthController } from './auth.controller';
import { EmailVerification } from './entities/email-verification.entity';
import { AuthService } from './services/auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmailVerification]),
    UsersModule,
    MailerModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, EmailVerificationService],
  exports: [TypeOrmModule],
})
export class AuthModule {}
