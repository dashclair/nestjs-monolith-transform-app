import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';

import { TokenService } from '@/core/auth/services/token.service';
import { ConfigService } from '@/core/config/config.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/services/users.service';

import { EmailVerificationMethod } from '../../../core/email-verification/email-verification-method.enum';
import { EmailVerificationPurpose } from '../../../core/email-verification/email-verification-purpose.enum';
import { EmailVerificationService } from '@/core/email-verification/email-verification.service';

import { AuthService } from '../services/auth.service';
import { PasswordService } from '../services/password.service';
import { RefreshSessionService } from '../services/refresh-session.service';

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
  Propagation: { REQUIRES_NEW: 'REQUIRES_NEW' },
}));

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    findByEmail: vi.fn<UsersService['findByEmail']>(),
    findById: vi.fn<UsersService['findById']>(),
    create: vi.fn<UsersService['create']>(),
    save: vi.fn<UsersService['save']>(),
    recordFailedLoginAttempt: vi.fn<UsersService['recordFailedLoginAttempt']>(),
  };
  const passwordServiceMock = {
    hash: vi.fn<PasswordService['hash']>(),
    verify: vi.fn<PasswordService['verify']>(),
  };
  const emailVerificationServiceMock = {
    issueAndSend: vi.fn<EmailVerificationService['issueAndSend']>(),
    confirm: vi.fn<EmailVerificationService['confirm']>(),
    canResend: vi.fn<EmailVerificationService['canResend']>(),
  };
  const configServiceMock = {
    get: vi.fn<ConfigService['get']>(),
  };
  const tokenServiceMock = {
    issueTokens: vi.fn<TokenService['issueTokens']>(),
    verifyRefreshToken: vi.fn<TokenService['verifyRefreshToken']>(),
    verifyAccessToken: vi.fn<TokenService['verifyAccessToken']>(),
  };
  const refreshSessionServiceMock = {
    create: vi.fn<RefreshSessionService['create']>(),
    rotate: vi.fn<RefreshSessionService['rotate']>(),
    revoke: vi.fn<RefreshSessionService['revoke']>(),
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'hashed',
      isEmailVerified: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
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
        { provide: ConfigService, useValue: configServiceMock },
        { provide: TokenService, useValue: tokenServiceMock },
        {
          provide: RefreshSessionService,
          useValue: refreshSessionServiceMock,
        },
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
      expect(emailVerificationServiceMock.issueAndSend).not.toHaveBeenCalled();
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
      emailVerificationServiceMock.issueAndSend.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
      });

      const result = await service.register('user@example.com', 'password123');

      expect(usersServiceMock.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'hashed-password',
        isEmailVerified: false,
      });
      expect(emailVerificationServiceMock.issueAndSend).toHaveBeenCalledWith(
        createdUser.id,
        EmailVerificationPurpose.REGISTER,
        'user@example.com',
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
        EmailVerificationPurpose.REGISTER,
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
        EmailVerificationPurpose.REGISTER,
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

      expect(emailVerificationServiceMock.issueAndSend).not.toHaveBeenCalled();
    });

    it('should issue a new code and send an email when canResend returns true', async () => {
      const user = buildUser();
      usersServiceMock.findByEmail.mockResolvedValue(user);
      emailVerificationServiceMock.canResend.mockResolvedValue(true);
      emailVerificationServiceMock.issueAndSend.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
      });

      const result = await service.resend('user@example.com');

      expect(emailVerificationServiceMock.issueAndSend).toHaveBeenCalledWith(
        user.id,
        EmailVerificationPurpose.REGISTER,
        'user@example.com',
      );
      expect(result).toEqual({ sent: true });
    });
  });

  describe('login', () => {
    const loginDto = { email: 'user@example.com', password: 'password123' };

    beforeEach(() => {
      configServiceMock.get.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          AUTH_LOGIN_MAX_FAILED_ATTEMPTS: '5',
          AUTH_LOGIN_LOCKOUT_MINUTES: '15',
          AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION: 'false',
        };
        return values[key];
      });
    });

    it('should throw 401 when no user matches the email', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwordServiceMock.verify).not.toHaveBeenCalled();
    });

    it('should throw the same 401 as an unknown email for a deleted user, without calling verify()', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);
      const unknownEmailError = (await service
        .login(loginDto)
        .catch((error: Error) => error)) as Error;

      usersServiceMock.findByEmail.mockResolvedValue(
        buildUser({ deletedAt: new Date(), passwordHash: '' }),
      );
      const deletedUserError = (await service
        .login(loginDto)
        .catch((error: Error) => error)) as Error;

      expect(deletedUserError).toBeInstanceOf(UnauthorizedException);
      expect(deletedUserError.message).toBe(unknownEmailError.message);
      expect(passwordServiceMock.verify).not.toHaveBeenCalled();
      expect(usersServiceMock.recordFailedLoginAttempt).not.toHaveBeenCalled();
    });

    it('should throw 429 without checking the password when the account is locked', async () => {
      const user = buildUser({ lockedUntil: new Date(Date.now() + 60_000) });
      usersServiceMock.findByEmail.mockResolvedValue(user);

      await expect(service.login(loginDto)).rejects.toThrow(HttpException);
      expect(passwordServiceMock.verify).not.toHaveBeenCalled();
    });

    it('should record a failed attempt and throw the same 401 as an unknown email', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(false);
      usersServiceMock.recordFailedLoginAttempt.mockResolvedValue(false);

      const unknownEmailError = await service
        .login({ email: 'nobody@example.com', password: 'x' })
        .catch((error: Error) => error);
      usersServiceMock.findByEmail.mockResolvedValue(user);
      const wrongPasswordError = await service
        .login(loginDto)
        .catch((error: Error) => error);

      expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect((unknownEmailError as UnauthorizedException).message).toBe(
        (wrongPasswordError as UnauthorizedException).message,
      );
      expect(usersServiceMock.recordFailedLoginAttempt).toHaveBeenCalledWith(
        user,
        { maxAttempts: 5, lockoutMinutes: 15 },
      );
    });

    it('should lock the account once the failed-attempt limit is reached, even with a correct password', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(false);
      usersServiceMock.recordFailedLoginAttempt.mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersServiceMock.recordFailedLoginAttempt).toHaveBeenCalledWith(
        user,
        { maxAttempts: 5, lockoutMinutes: 15 },
      );
    });

    it('should throw 403 when the email is not verified, even with a correct password', async () => {
      const user = buildUser({ isEmailVerified: false });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
    });

    // Regression: the counter reset used to be set in memory but only ever
    // persisted in the branches *after* the isEmailVerified check, so a
    // correct password on an unverified account threw 403 without ever
    // saving failedLoginAttempts=0/lockedUntil=null.
    it('should persist the failed-attempt reset even when the email is not verified', async () => {
      const user = buildUser({
        isEmailVerified: false,
        failedLoginAttempts: 3,
        lockedUntil: null,
      });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);

      expect(usersServiceMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
      );
    });

    it('should reset the failed-attempt counter and lockout on successful login', async () => {
      const user = buildUser({
        isEmailVerified: true,
        failedLoginAttempts: 3,
        lockedUntil: null,
      });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);
      tokenServiceMock.issueTokens.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      await service.login(loginDto);

      expect(usersServiceMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
      );
    });

    it('should issue tokens directly when login confirmation is disabled', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      tokenServiceMock.issueTokens.mockResolvedValue(tokens);

      const result = await service.login(loginDto);

      expect(emailVerificationServiceMock.issueAndSend).not.toHaveBeenCalled();
      expect(result).toEqual(tokens);
    });

    it('stores a refresh session under the same jti the refresh token was signed with', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);
      tokenServiceMock.issueTokens.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      const meta = { userAgent: 'test-agent', ip: '127.0.0.1' };

      await service.login(loginDto, meta);

      const jti = tokenServiceMock.issueTokens.mock.calls[0][1];
      expect(refreshSessionServiceMock.create).toHaveBeenCalledWith(
        user.id,
        jti,
        'refresh-token',
        meta,
      );
    });

    it('should require confirmation and not issue tokens when login confirmation is enabled', async () => {
      configServiceMock.get.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          AUTH_LOGIN_MAX_FAILED_ATTEMPTS: '5',
          AUTH_LOGIN_LOCKOUT_MINUTES: '15',
          AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION: 'true',
        };
        return values[key];
      });
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      passwordServiceMock.verify.mockResolvedValue(true);
      emailVerificationServiceMock.issueAndSend.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
      });

      const result = await service.login(loginDto);

      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
      expect(emailVerificationServiceMock.issueAndSend).toHaveBeenCalledWith(
        user.id,
        EmailVerificationPurpose.LOGIN,
        user.email,
      );
      expect(result).toEqual({
        requiresConfirmation: true,
        method: EmailVerificationMethod.OTP,
        email: user.email,
      });
    });
  });

  describe('confirmLoginOtp', () => {
    it('should confirm with purpose=login and issue tokens', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      tokenServiceMock.issueTokens.mockResolvedValue(tokens);

      const result = await service.confirmLoginOtp(
        'user@example.com',
        '123456',
      );

      expect(emailVerificationServiceMock.confirm).toHaveBeenCalledWith(
        user.id,
        '123456',
        EmailVerificationPurpose.LOGIN,
      );
      expect(result).toEqual(tokens);
    });
  });

  describe('confirmLoginMagicLink', () => {
    it('should confirm with purpose=login and issue tokens', async () => {
      const user = buildUser({ isEmailVerified: true });
      usersServiceMock.findByEmail.mockResolvedValue(user);
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      tokenServiceMock.issueTokens.mockResolvedValue(tokens);

      const result = await service.confirmLoginMagicLink(
        'user@example.com',
        'token-abc',
      );

      expect(emailVerificationServiceMock.confirm).toHaveBeenCalledWith(
        user.id,
        'token-abc',
        EmailVerificationPurpose.LOGIN,
      );
      expect(result).toEqual(tokens);
    });
  });

  describe('resendLoginConfirmation', () => {
    it('should issue a new code with purpose=login and send an email', async () => {
      const user = buildUser();
      usersServiceMock.findByEmail.mockResolvedValue(user);
      emailVerificationServiceMock.canResend.mockResolvedValue(true);
      emailVerificationServiceMock.issueAndSend.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
      });

      const result = await service.resendLoginConfirmation('user@example.com');

      expect(emailVerificationServiceMock.canResend).toHaveBeenCalledWith(
        user.id,
        EmailVerificationPurpose.LOGIN,
      );
      expect(emailVerificationServiceMock.issueAndSend).toHaveBeenCalledWith(
        user.id,
        EmailVerificationPurpose.LOGIN,
        'user@example.com',
      );
      expect(result).toEqual({ sent: true });
    });
  });

  describe('refresh', () => {
    it('should throw 401 when the refresh token is invalid or expired', async () => {
      tokenServiceMock.verifyRefreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw 401 when the tokenVersion no longer matches the user', async () => {
      const user = buildUser({ tokenVersion: 2 });
      tokenServiceMock.verifyRefreshToken.mockResolvedValue({
        sub: user.id,
        email: user.email,
        roles: ['user'],
        tokenVersion: 1,
        type: 'refresh',
        jti: 'jti-1',
      });
      usersServiceMock.findById.mockResolvedValue(user);

      await expect(service.refresh('stale-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
      expect(refreshSessionServiceMock.rotate).not.toHaveBeenCalled();
    });

    it('should rotate the session and return the new token pair when the refresh token is valid', async () => {
      const user = buildUser({ tokenVersion: 1 });
      tokenServiceMock.verifyRefreshToken.mockResolvedValue({
        sub: user.id,
        email: user.email,
        roles: ['user'],
        tokenVersion: 1,
        type: 'refresh',
        jti: 'jti-1',
      });
      usersServiceMock.findById.mockResolvedValue(user);
      const tokens = { accessToken: 'new-access', refreshToken: 'new-refresh' };
      tokenServiceMock.issueTokens.mockResolvedValue(tokens);
      const meta = { userAgent: 'test-agent', ip: '127.0.0.1' };

      const result = await service.refresh('valid-token', meta);

      const newJti = tokenServiceMock.issueTokens.mock.calls[0][1];
      expect(newJti).not.toBe('jti-1');
      expect(refreshSessionServiceMock.rotate).toHaveBeenCalledWith(
        'jti-1',
        'valid-token',
        newJti,
        'new-refresh',
        meta,
      );
      expect(result).toEqual(tokens);
    });

    it('should propagate the 401 when the session cannot be rotated (revoked or reused)', async () => {
      const user = buildUser({ tokenVersion: 1 });
      tokenServiceMock.verifyRefreshToken.mockResolvedValue({
        sub: user.id,
        email: user.email,
        roles: ['user'],
        tokenVersion: 1,
        type: 'refresh',
        jti: 'jti-1',
      });
      usersServiceMock.findById.mockResolvedValue(user);
      tokenServiceMock.issueTokens.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
      refreshSessionServiceMock.rotate.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(service.refresh('reused-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    const buildResponse = (): FastifyReply =>
      ({ clearCookie: vi.fn() }) as unknown as FastifyReply;

    it('clears both auth cookies regardless of the refresh token', async () => {
      const clearCookie = vi.fn();
      const response = { clearCookie } as unknown as FastifyReply;

      await service.logout(response);

      expect(clearCookie).toHaveBeenCalledWith('access_token', {
        path: '/',
      });
      expect(clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: '/auth',
      });
    });

    it('does not verify or revoke anything when no refresh token was provided', async () => {
      await service.logout(buildResponse());

      expect(tokenServiceMock.verifyRefreshToken).not.toHaveBeenCalled();
      expect(refreshSessionServiceMock.revoke).not.toHaveBeenCalled();
    });

    it('revokes the session and logs the userId when a valid refresh token is provided', async () => {
      tokenServiceMock.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        email: 'user@example.com',
        roles: ['user'],
        tokenVersion: 0,
        type: 'refresh',
        jti: 'jti-1',
      });
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await service.logout(buildResponse(), 'valid-token');

      expect(refreshSessionServiceMock.revoke).toHaveBeenCalledWith('jti-1');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'auth.logout', userId: 'user-1' }),
      );
    });

    it('still succeeds and logs anonymously when the refresh token is invalid', async () => {
      tokenServiceMock.verifyRefreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await service.logout(buildResponse(), 'expired-token');

      expect(refreshSessionServiceMock.revoke).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith({ event: 'auth.logout' });
    });
  });
});
