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
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { EmailVerificationMethod } from '../email-verification-method.enum';
import { EmailVerification } from '../entities/email-verification.entity';
import { EmailVerificationPurpose } from '../email-verification-purpose.enum';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(EmailVerification)
    private readonly repo: Repository<EmailVerification>,
    private readonly configService: ConfigService,
  ) {}

  async issue(
    userId: string,
    purpose: EmailVerificationPurpose
  ): Promise<{ method: EmailVerificationMethod; plaintext: string }> {
    const method = this.configService.get(
      'AUTH_REGISTER_CONFIRMATION_METHOD',
    ) as EmailVerificationMethod;
    const plaintext =
      method === EmailVerificationMethod.OTP
        ? this.generateOtp()
        : this.generateToken();
    const ttlMinutes = Number(
      this.configService.get('EMAIL_VERIFICATION_TTL_MINUTES'),
    );

    const existing = await this.repo.findOneBy({ userId, purpose});
    await this.repo.save({
      ...existing,
      userId,
      method,
      codeHash: this.hash(plaintext),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      attemptsUsed: 0,
      consumedAt: null,
      lastSentAt: new Date(),
    });

    return { method, plaintext };
  }

  async confirm(userId: string, submittedCode: string, purpose: EmailVerificationPurpose): Promise<void> {
    const verification = await this.repo.findOneBy({ userId, purpose });
    if (!verification || verification.consumedAt) {
      throw new NotFoundException('No pending confirmation for this email');
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
      verification.attemptsUsed += 1;
      await this.repo.save(verification);
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

  async canResend(userId: string, purpose: EmailVerificationPurpose): Promise<boolean> {
    const verification = await this.repo.findOneBy({ userId, purpose });

    if (!verification || verification.consumedAt) {
      throw new NotFoundException('No pending confirmation for this email');
    }
    if (!verification.lastSentAt) return true;

    const intervalMs =
      Number(
        this.configService.get('EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS'),
      ) * 1000;
    return Date.now() - verification.lastSentAt.getTime() >= intervalMs;
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
