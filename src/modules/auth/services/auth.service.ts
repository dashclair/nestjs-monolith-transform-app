import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { MailerService } from '@/core/mailer/mailer.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    const sent = await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your email',
      html: `Code: ${plaintext}`,
    });
    this.logger.log({ event: 'auth.email_verification.sent', email, sent });
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
    this.logger.log({ event: 'auth.register.attempt', email });

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      this.logger.warn({ event: 'auth.register.conflict', email });
      throw new ConflictException('Email already registered');
    }

    const requireConfirmation =
      String(
        this.configService.get('AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION'),
      ) === 'true';
    const passwordHash = await this.passwordService.hash(password);
    const user = await this.usersService.create({
      email,
      passwordHash,
      isEmailVerified: !requireConfirmation,
    });

    if (!requireConfirmation) {
      this.logger.log({
        event: 'auth.register.success',
        email,
        requiresConfirmation: false,
      });
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    }

    const { method, plaintext } = await this.emailVerificationService.issue(
      user.id,
    );
    await this.sendConfirmationEmail(email, plaintext);

    this.logger.log({
      event: 'auth.register.success',
      email,
      requiresConfirmation: true,
      method,
    });
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

    this.logger.log({ event: 'auth.email_verification.resend', email });
    return { sent: true as const };
  }
}
