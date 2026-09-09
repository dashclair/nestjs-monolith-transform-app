import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { MailerService } from '@/core/mailer/mailer.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { EmailVerificationMethod } from '../email-verification-method.enum';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';

// `AuthService`'s methods are decorated with `@Transactional()`, which needs
// `initializeTransactionalContext()` to have run first (only happens in
// `main.ts`'s `bootstrap()`, never in a unit test). Replacing the decorator
// with a no-op keeps the tests focused on business logic, not on standing up
// a real CLS/DataSource context.
vi.mock('typeorm-transactional', () => ({
  Transactional:
    () =>
    (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    findByEmail: vi.fn<UsersService['findByEmail']>(),
    create: vi.fn<UsersService['create']>(),
    save: vi.fn<UsersService['save']>(),
  };
  const passwordServiceMock = {
    hash: vi.fn<PasswordService['hash']>(),
    verify: vi.fn<PasswordService['verify']>(),
  };
  const emailVerificationServiceMock = {
    issue: vi.fn<EmailVerificationService['issue']>(),
    confirm: vi.fn<EmailVerificationService['confirm']>(),
    canResend: vi.fn<EmailVerificationService['canResend']>(),
  };
  const mailerServiceMock = {
    sendMail: vi.fn<MailerService['sendMail']>(),
  };
  const configServiceMock = {
    get: vi.fn<ConfigService['get']>(),
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'hashed',
      isEmailVerified: false,
      createdAt: new Date('2026-09-09T10:00:00.000Z'),
      updatedAt: new Date('2026-09-09T10:00:00.000Z'),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: PasswordService, useValue: passwordServiceMock },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
        { provide: MailerService, useValue: mailerServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('should throw ConflictException when the email is already registered', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(buildUser());

      await expect(
        service.register('user@example.com', 'password123'),
      ).rejects.toThrow(ConflictException);

      expect(usersServiceMock.create).not.toHaveBeenCalled();
    });

    it('should create a verified user and not send an email when confirmation is disabled', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      configServiceMock.get.mockImplementation((key: string) =>
        key === 'AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION' ? 'false' : '',
      );
      passwordServiceMock.hash.mockResolvedValue('hashed-password');
      const createdUser = buildUser({ isEmailVerified: true });
      usersServiceMock.create.mockResolvedValue(createdUser);

      const result = await service.register('user@example.com', 'password123');

      expect(usersServiceMock.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'hashed-password',
        isEmailVerified: true,
      });
      expect(emailVerificationServiceMock.issue).not.toHaveBeenCalled();
      expect(mailerServiceMock.sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: createdUser.id,
        email: createdUser.email,
        createdAt: createdUser.createdAt,
      });
    });

    it('should create an unverified user, issue a code and send an email when confirmation is enabled', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      configServiceMock.get.mockImplementation((key: string) =>
        key === 'AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION' ? 'true' : '',
      );
      passwordServiceMock.hash.mockResolvedValue('hashed-password');
      const createdUser = buildUser({ isEmailVerified: false });
      usersServiceMock.create.mockResolvedValue(createdUser);
      emailVerificationServiceMock.issue.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
        plaintext: '123456',
      });

      const result = await service.register('user@example.com', 'password123');

      expect(usersServiceMock.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'hashed-password',
        isEmailVerified: false,
      });
      expect(emailVerificationServiceMock.issue).toHaveBeenCalledWith(
        createdUser.id,
      );
      expect(mailerServiceMock.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
      expect(result).toEqual({
        requiresConfirmation: true,
        method: EmailVerificationMethod.OTP,
        email: 'user@example.com',
      });
    });
  });

  describe('confirmOtp', () => {
    it('should throw NotFoundException when no user matches the email', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(
        service.confirmOtp('user@example.com', '123456'),
      ).rejects.toThrow(NotFoundException);

      expect(emailVerificationServiceMock.confirm).not.toHaveBeenCalled();
    });

    it('should confirm the code and mark the user as verified', async () => {
      const user = buildUser({ isEmailVerified: false });
      usersServiceMock.findByEmail.mockResolvedValue(user);

      const result = await service.confirmOtp('user@example.com', '123456');

      expect(emailVerificationServiceMock.confirm).toHaveBeenCalledWith(
        user.id,
        '123456',
      );
      expect(usersServiceMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ isEmailVerified: true }),
      );
      expect(result).toEqual({ verified: true });
    });
  });

  describe('confirmMagicLink', () => {
    it('should confirm the token and mark the user as verified', async () => {
      const user = buildUser({ isEmailVerified: false });
      usersServiceMock.findByEmail.mockResolvedValue(user);

      const result = await service.confirmMagicLink(
        'user@example.com',
        'token-abc',
      );

      expect(emailVerificationServiceMock.confirm).toHaveBeenCalledWith(
        user.id,
        'token-abc',
      );
      expect(usersServiceMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ isEmailVerified: true }),
      );
      expect(result).toEqual({ verified: true });
    });
  });

  describe('resend', () => {
    it('should throw NotFoundException when no user matches the email', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(service.resend('user@example.com')).rejects.toThrow(
        NotFoundException,
      );

      expect(emailVerificationServiceMock.canResend).not.toHaveBeenCalled();
    });

    // Regression test: canResend()'s result used to be ignored entirely, so
    // resend requested before EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS had
    // elapsed would still issue a brand-new code instead of being rejected.
    it('should throw 429 and not issue a new code when canResend returns false', async () => {
      const user = buildUser();
      usersServiceMock.findByEmail.mockResolvedValue(user);
      emailVerificationServiceMock.canResend.mockResolvedValue(false);

      await expect(service.resend('user@example.com')).rejects.toThrow(
        HttpException,
      );

      expect(emailVerificationServiceMock.issue).not.toHaveBeenCalled();
      expect(mailerServiceMock.sendMail).not.toHaveBeenCalled();
    });

    it('should issue a new code and send an email when canResend returns true', async () => {
      const user = buildUser();
      usersServiceMock.findByEmail.mockResolvedValue(user);
      emailVerificationServiceMock.canResend.mockResolvedValue(true);
      emailVerificationServiceMock.issue.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
        plaintext: '654321',
      });

      const result = await service.resend('user@example.com');

      expect(emailVerificationServiceMock.issue).toHaveBeenCalledWith(user.id);
      expect(mailerServiceMock.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
      expect(result).toEqual({ sent: true });
    });
  });
});
