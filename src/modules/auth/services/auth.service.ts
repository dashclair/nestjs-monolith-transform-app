import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { MailerService } from '@/core/mailer/mailer.service';
import { UsersService } from '@/modules/users/users.service';
import { User } from '@/modules/users/entities/user.entity';

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

  private async sendConfirmationEmail(
    email: string,
    plaintext: string,
  ): Promise<void> {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your email',
      html: `Code: ${plaintext}`,
    });
  }

  private async findUserForConfirmation(email: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new NotFoundException('No pending confirmation for this email');
    }

    return user;
  }

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

    if (!requireConfirmation) {
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    }

    const { method, plaintext } = await this.emailVerificationService.issue(
      user.id,
    );
    await this.sendConfirmationEmail(email, plaintext);

    return { requiresConfirmation: true, method, email };
  }

  @Transactional()
  async confirmOtp(email: string, code: string) {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(user.id, code);

    user.isEmailVerified = true;
    await this.usersService.save(user);

    return { verified: true as const };
  }

  @Transactional()
  async confirmMagicLink(email: string, token: string) {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(user.id, token);

    user.isEmailVerified = true;
    await this.usersService.save(user);

    return { verified: true as const };
  }

  @Transactional()
  async resend(email: string) {
    const user = await this.findUserForConfirmation(email);

    const canResend = await this.emailVerificationService.canResend(user.id);
    if (!canResend) {
      throw new HttpException(
        'Please wait before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { plaintext } = await this.emailVerificationService.issue(user.id);
    await this.sendConfirmationEmail(email, plaintext);

    return { sent: true as const };
  }
}
