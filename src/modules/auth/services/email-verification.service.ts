import * as crypto from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { EmailVerificationMethod } from '../email-verification-method.enum';
import { EmailVerification } from '../entities/email-verification.entity';

@Injectable()
export class EmailVerificationService {
  constructor(
    @InjectRepository(EmailVerification)
    private readonly repo: Repository<EmailVerification>,
    private readonly configService: ConfigService,
  ) {}

  async issue(
    userId: string,
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

    const existing = await this.repo.findOneBy({ userId });
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

  async confirm(userId: string, submittedCode: string): Promise<void> {
    const verification = await this.repo.findOneBy({ userId });
    if (!verification || verification.consumedAt) {
      throw new NotFoundException('No pending confirmation for this email');
    }

    const maxAttempts = Number(
      this.configService.get('EMAIL_VERIFICATION_MAX_ATTEMPTS'),
    );
    if (verification.attemptsUsed >= maxAttempts) {
      throw new HttpException(
        'Too many attempts, request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Confirmation code expired');
    }

    if (verification.codeHash !== this.hash(submittedCode)) {
      verification.attemptsUsed += 1;
      await this.repo.save(verification);
      throw new BadRequestException('Invalid confirmation code');
    }

    verification.consumedAt = new Date();
    await this.repo.save(verification);
  }

  async canResend(userId: string): Promise<boolean> {
    const verification = await this.repo.findOneBy({ userId });
    if (!verification || verification.consumedAt) return false;
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
