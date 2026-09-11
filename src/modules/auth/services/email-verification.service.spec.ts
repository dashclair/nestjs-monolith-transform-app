import * as crypto from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { EmailVerificationMethod } from '../email-verification-method.enum';
import { EmailVerificationPurpose } from '../email-verification-purpose.enum';
import { EmailVerification } from '../entities/email-verification.entity';
import { EmailVerificationService } from './email-verification.service';

// `recordFailedAttempt` is decorated with `@Transactional()`, which needs
// `initializeTransactionalContext()` to have run first (only happens in
// `main.ts`'s `bootstrap()`, never in a unit test). Replacing the decorator
// with a no-op keeps the tests focused on business logic, not on standing up
// a real CLS/DataSource context. See `auth.service.spec.ts` for the same
// pattern.
vi.mock('typeorm-transactional', () => ({
  Transactional:
    () =>
    (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
      descriptor,
  Propagation: { REQUIRES_NEW: 'REQUIRES_NEW' },
}));

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const repoMock = {
    findOneBy: vi.fn<Repository<EmailVerification>['findOneBy']>(),
    save: vi.fn<Repository<EmailVerification>['save']>(),
  };
  const configValues: Record<string, string> = {
    AUTH_REGISTER_CONFIRMATION_METHOD: 'otp',
    AUTH_LOGIN_CONFIRMATION_METHOD: 'otp',
    EMAIL_VERIFICATION_TTL_MINUTES: '10',
    EMAIL_VERIFICATION_MAX_ATTEMPTS: '5',
    EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS: '60',
    OTP_LENGTH: '6',
  };
  const configServiceMock = {
    get: vi.fn((key: string) => configValues[key]),
  };

  const hash = (value: string) =>
    crypto.createHash('sha256').update(value).digest('hex');

  const buildVerification = (
    overrides: Partial<EmailVerification> = {},
  ): EmailVerification =>
    ({
      id: 'verification-id',
      userId: 'user-id',
      method: EmailVerificationMethod.OTP,
      codeHash: hash('111111'),
      expiresAt: new Date(Date.now() + 10 * 60_000),
      attemptsUsed: 0,
      consumedAt: null,
      lastSentAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as EmailVerification;

  beforeEach(async () => {
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(
      (key: string) => configValues[key],
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: getRepositoryToken(EmailVerification), useValue: repoMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(EmailVerificationService);
  });

  describe('issue', () => {
    it('should create a new row with a hashed OTP code when none exists', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      const { method, plaintext } = await service.issue(
        'user-id',
        EmailVerificationPurpose.REGISTER,
      );

      expect(method).toBe(EmailVerificationMethod.OTP);
      expect(plaintext).toMatch(/^\d{6}$/);
      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          method: EmailVerificationMethod.OTP,
          codeHash: hash(plaintext),
          attemptsUsed: 0,
          consumedAt: null,
        }),
      );
    });

    it('should generate a hex magic-link token when the method is magic_link', async () => {
      configValues.AUTH_REGISTER_CONFIRMATION_METHOD = 'magic_link';
      repoMock.findOneBy.mockResolvedValue(null);

      const { method, plaintext } = await service.issue(
        'user-id',
        EmailVerificationPurpose.REGISTER,
      );

      expect(method).toBe(EmailVerificationMethod.MAGIC_LINK);
      expect(plaintext).toMatch(/^[0-9a-f]{64}$/);

      configValues.AUTH_REGISTER_CONFIRMATION_METHOD = 'otp';
    });

    it('should update the existing row instead of creating a new one (resend)', async () => {
      const existing = buildVerification({ id: 'existing-row' });
      repoMock.findOneBy.mockResolvedValue(existing);

      await service.issue('user-id', EmailVerificationPurpose.REGISTER);

      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-row', attemptsUsed: 0 }),
      );
    });

    // Regression: `purpose` was only ever used for the findOneBy() lookup,
    // never included in the object passed to repo.save(). For an existing
    // row that's masked by the `...existing` spread, but the first-ever
    // issue() for a given (userId, purpose) — e.g. the very first login
    // confirmation, since only registration had exercised this before —
    // has no `existing` row to spread from, so the saved row silently fell
    // back to the `purpose` column's DB default ('register') regardless of
    // what was actually requested.
    it('persists the requested purpose on a newly created row, not just the DB column default', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      await service.issue('user-id', EmailVerificationPurpose.LOGIN);

      expect(repoMock.findOneBy).toHaveBeenCalledWith({
        userId: 'user-id',
        purpose: EmailVerificationPurpose.LOGIN,
      });
      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: EmailVerificationPurpose.LOGIN }),
      );
    });

    it('never stores the plaintext code, only its sha256 hash', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      const { plaintext } = await service.issue(
        'user-id',
        EmailVerificationPurpose.REGISTER,
      );

      const [savedRow] = repoMock.save.mock.calls[0];
      expect(savedRow.codeHash).not.toBe(plaintext);
      expect(savedRow.codeHash).toBe(hash(plaintext));
    });
  });

  describe('confirm', () => {
    it('should throw NotFoundException when there is no active verification', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.confirm('user-id', '111111', EmailVerificationPurpose.REGISTER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the row was already consumed', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ consumedAt: new Date() }),
      );

      await expect(
        service.confirm('user-id', '111111', EmailVerificationPurpose.REGISTER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 429 without comparing the code once attempts are exceeded', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ attemptsUsed: 5 }),
      );

      await expect(
        service.confirm('user-id', '111111', EmailVerificationPurpose.REGISTER),
      ).rejects.toThrow(HttpException);
      // The correct code was submitted, but the attempts limit blocks it
      // before the hash is even compared — save() must not run again.
      expect(repoMock.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the code has expired', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.confirm('user-id', '111111', EmailVerificationPurpose.REGISTER),
      ).rejects.toThrow(BadRequestException);
    });

    it('should increment attemptsUsed and throw on an invalid code', async () => {
      const verification = buildVerification({ attemptsUsed: 1 });
      repoMock.findOneBy.mockResolvedValue(verification);

      await expect(
        service.confirm(
          'user-id',
          'wrong-code',
          EmailVerificationPurpose.REGISTER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ attemptsUsed: 2 }),
      );
    });

    it('should mark the row consumed on a valid code', async () => {
      const verification = buildVerification();
      repoMock.findOneBy.mockResolvedValue(verification);

      await service.confirm(
        'user-id',
        '111111',
        EmailVerificationPurpose.REGISTER,
      );

      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ consumedAt: expect.any(Date) as Date }),
      );
    });
  });

  describe('canResend', () => {
    it('should throw NotFoundException when there is no active verification', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.canResend('user-id', EmailVerificationPurpose.REGISTER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow resend when the code was never sent before', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ lastSentAt: null }),
      );

      await expect(
        service.canResend('user-id', EmailVerificationPurpose.REGISTER),
      ).resolves.toBe(true);
    });

    it('should reject resend before the interval has elapsed', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ lastSentAt: new Date() }),
      );

      await expect(
        service.canResend('user-id', EmailVerificationPurpose.REGISTER),
      ).resolves.toBe(false);
    });

    it('should allow resend once the interval has elapsed', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildVerification({ lastSentAt: new Date(Date.now() - 61_000) }),
      );

      await expect(
        service.canResend('user-id', EmailVerificationPurpose.REGISTER),
      ).resolves.toBe(true);
    });
  });
});
