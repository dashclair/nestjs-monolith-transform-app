import * as crypto from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import { Repository } from 'typeorm';

import { Config } from '@/core/config/config.types';
import { ConfigService } from '@/core/config/config.service';
import { MailerService } from '@/core/mailer/mailer.service';

import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';
import { EmailVerification } from '@/modules/auth/entities/email-verification.entity';
import { EmailVerificationPurpose } from '@/core/email-verification/email-verification-purpose.enum';

const CONFIRMATION_METHOD_CONFIG_KEY: Record<
  EmailVerificationPurpose,
  keyof Config
> = {
  [EmailVerificationPurpose.REGISTER]: 'AUTH_REGISTER_CONFIRMATION_METHOD',
  [EmailVerificationPurpose.LOGIN]: 'AUTH_LOGIN_CONFIRMATION_METHOD',
  [EmailVerificationPurpose.EMAIL_CHANGE]:
    'AUTH_EMAIL_CHANGE_CONFIRMATION_METHOD',
  [EmailVerificationPurpose.DELETE_ACCOUNT]:
    'DELETE_ACCOUNT_CONFIRMATION_METHOD',
};

// Per-purpose wording for the "nothing to confirm" 404 — callers each have
// their own vocabulary for what a pending verification represents (account
// deletion wants "No pending deletion request", not the generic email-change
// phrasing).
const NO_PENDING_VERIFICATION_MESSAGE: Record<
  EmailVerificationPurpose,
  string
> = {
  [EmailVerificationPurpose.REGISTER]: 'No pending confirmation for this email',
  [EmailVerificationPurpose.LOGIN]: 'No pending confirmation for this email',
  [EmailVerificationPurpose.EMAIL_CHANGE]:
    'No pending confirmation for this email',
  [EmailVerificationPurpose.DELETE_ACCOUNT]: 'No pending deletion request',
};

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(EmailVerification)
    private readonly repo: Repository<EmailVerification>,
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {}

  async issueAndSend(
    userId: string,
    purpose: EmailVerificationPurpose,
    targetEmail: string,
  ): Promise<{ method: EmailVerificationMethod }> {
    const { method, plaintext } = await this.issue(userId, purpose);

    const sent = await this.mailerService.sendMail({
      to: targetEmail,
      subject: 'Confirm your email',
      html: `Code: ${plaintext}`,
    });
    this.logger.log({
      event: 'auth.email_verification.sent',
      userId,
      purpose,
      sent,
    });

    return { method };
  }

  async issue(
    userId: string,
    purpose: EmailVerificationPurpose,
  ): Promise<{ method: EmailVerificationMethod; plaintext: string }> {
    const method = this.configService.get(
      CONFIRMATION_METHOD_CONFIG_KEY[purpose],
    ) as EmailVerificationMethod;

    const plaintext =
      method === EmailVerificationMethod.OTP
        ? this.generateOtp()
        : this.generateToken();
    const ttlMinutes = Number(
      this.configService.get('EMAIL_VERIFICATION_TTL_MINUTES'),
    );

    const existing = await this.repo.findOneBy({ userId, purpose });
    await this.repo.save({
      ...existing,
      userId,
      purpose,
      method,
      codeHash: this.hash(plaintext),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      attemptsUsed: 0,
      consumedAt: null,
      lastSentAt: new Date(),
    });

    return { method, plaintext };
  }

  async confirm(
    userId: string,
    submittedCode: string,
    purpose: EmailVerificationPurpose,
  ): Promise<void> {
    const verification = await this.repo.findOneBy({ userId, purpose });
    if (!verification || verification.consumedAt) {
      throw new NotFoundException(NO_PENDING_VERIFICATION_MESSAGE[purpose]);
    }

    const maxAttempts = Number(
      this.configService.get('EMAIL_VERIFICATION_MAX_ATTEMPTS'),
    );
    if (verification.attemptsUsed >= maxAttempts) {
      this.logger.warn({
        event: 'auth.email_verification.failed',
        userId,
        reason: 'attempts_exceeded',
      });
      throw new HttpException(
        'Too many attempts, request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      this.logger.warn({
        event: 'auth.email_verification.failed',
        userId,
        reason: 'expired',
      });
      throw new BadRequestException('Confirmation code expired');
    }

    if (verification.codeHash !== this.hash(submittedCode)) {
      // Recorded in its own transaction (REQUIRES_NEW) so the attempt count
      // survives even though this method throws right after — a throw here
      // would otherwise roll back the enclosing @Transactional() call in
      // AuthService (e.g. confirmOtp), silently discarding the increment and
      // making EMAIL_VERIFICATION_MAX_ATTEMPTS never actually trigger.
      await this.recordFailedAttempt(verification);
      this.logger.warn({
        event: 'auth.email_verification.failed',
        userId,
        reason: 'invalid',
      });
      throw new BadRequestException('Invalid confirmation code');
    }

    verification.consumedAt = new Date();
    await this.repo.save(verification);
    this.logger.log({ event: 'auth.email_verification.confirmed', userId });
  }

  async canResend(
    userId: string,
    purpose: EmailVerificationPurpose,
  ): Promise<boolean> {
    const verification = await this.repo.findOneBy({ userId, purpose });

    if (!verification || verification.consumedAt) {
      throw new NotFoundException(NO_PENDING_VERIFICATION_MESSAGE[purpose]);
    }
    if (!verification.lastSentAt) return true;

    const intervalMs =
      Number(
        this.configService.get('EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS'),
      ) * 1000;
    return Date.now() - verification.lastSentAt.getTime() >= intervalMs;
  }

  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  private async recordFailedAttempt(
    verification: EmailVerification,
  ): Promise<void> {
    verification.attemptsUsed += 1;
    await this.repo.save(verification);
  }

  private generateOtp(): string {
    const length = Number(this.configService.get('OTP_LENGTH'));
    const digits = '0123456789';

    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[crypto.randomInt(0, digits.length)];
    }
    return otp;
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
