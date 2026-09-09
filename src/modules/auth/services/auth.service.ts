import { ConflictException, Injectable } from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { MailerService } from '@/core/mailer/mailer.service';
import { UsersService } from '@/modules/users/users.service';

import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  @Transactional()
  async register(email: string, password: string) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email already registered');

    const requireConfirmation =
      this.configService.get('AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION') ===
      'true';
    const passwordHash = await this.passwordService.hash(password);
    const user = await this.usersService.create({
      email,
      passwordHash,
      isEmailVerified: !requireConfirmation,
    });

    if (!requireConfirmation)
      return { id: user.id, email: user.email, createdAt: user.createdAt };

    const { method, plaintext } = await this.emailVerificationService.issue(
      user.id,
    );
    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your email',
      html: `Code: ${plaintext}`,
    });

    return { requiresConfirmation: true, method, email };
  }
}
