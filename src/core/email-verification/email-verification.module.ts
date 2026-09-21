import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailerModule } from '@/core/mailer/mailer.module';
import { EmailVerification } from '@/modules/auth/entities/email-verification.entity';

import { EmailVerificationService } from './email-verification.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmailVerification]), MailerModule],
  providers: [EmailVerificationService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
