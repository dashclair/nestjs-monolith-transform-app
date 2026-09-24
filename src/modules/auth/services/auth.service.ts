import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';

import { clearAuthCookies } from '@/core/auth/cookie.util';
import { TokenService, TokenPair } from '@/core/auth/services/token.service';
import { ConfigService } from '@/core/config/config.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/services/users.service';

import { EmailVerificationService } from '@/core/email-verification/email-verification.service';
import { PasswordService } from './password.service';
import { EmailVerificationPurpose } from '../../../core/email-verification/email-verification-purpose.enum';
import { LoginDto } from '../dto/login.dto';
import { EmailVerificationMethod } from '../../../core/email-verification/email-verification-method.enum';
import { FastifyReply } from 'fastify';
import { RefreshSessionService } from './refresh-session.service';
import type { SessionMeta } from './refresh-session.service';
import { isUniqueViolation } from '@/common/database/is-unique-violation';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private static readonly INVALID_CREDENTIALS_MESSAGE =
    'Invalid email or password';
  private static readonly ACCOUNT_LOCKED_MESSAGE =
    'Account temporarily locked, try again later';

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly refreshSessionService: RefreshSessionService,
  ) {}

  private async findUserForConfirmation(email: string): Promise<User> {
    const user = await this.usersService.findByEmail(email, ['roles']);

    if (!user) {
      throw new NotFoundException('No pending confirmation for this email');
    }

    return user;
  }

  private async startSession(
    user: User,
    meta?: SessionMeta,
  ): Promise<TokenPair> {
    const jti = randomUUID();
    const tokens = await this.tokenService.issueTokens(user, jti);
    await this.refreshSessionService.create(
      user.id,
      jti,
      tokens.refreshToken,
      meta,
    );
    return tokens;
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
    let user: User;
    try {
      user = await this.usersService.create({
        email,
        passwordHash,
        isEmailVerified: !requireConfirmation,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn({ event: 'auth.register.conflict', email });
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    if (!requireConfirmation) {
      this.logger.log({
        event: 'auth.register.success',
        email,
        requiresConfirmation: false,
      });
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    }

    const { method } = await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.REGISTER,
      email,
    );

    this.logger.log({
      event: 'auth.register.success',
      email,
      requiresConfirmation: true,
      method,
    });
    return { requiresConfirmation: true, method, email };
  }

  @Transactional()
  async login(
    dto: LoginDto,
    meta?: SessionMeta,
  ): Promise<
    | TokenPair
    | {
        requiresConfirmation: true;
        method: EmailVerificationMethod;
        email: string;
      }
  > {
    this.logger.log({ event: 'auth.login.attempt', email: dto.email });

    const user = await this.usersService.findByEmail(dto.email, ['roles']);
    if (!user) {
      this.logger.warn({
        event: 'auth.login.failed',
        email: dto.email,
        reason: 'user_not_found',
      });
      throw new UnauthorizedException(AuthService.INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.deletedAt) {
      this.logger.warn({
        event: 'auth.login.failed',
        userId: user.id,
        reason: 'user_deleted',
      });
      throw new UnauthorizedException(AuthService.INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.logger.warn({ event: 'auth.login.locked', userId: user.id });
      throw new HttpException(
        AuthService.ACCOUNT_LOCKED_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordValid = await this.passwordService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordValid) {
      const maxAttempts = Number(
        this.configService.get('AUTH_LOGIN_MAX_FAILED_ATTEMPTS'),
      );
      const lockoutMinutes = Number(
        this.configService.get('AUTH_LOGIN_LOCKOUT_MINUTES'),
      );
      const locked = await this.usersService.recordFailedLoginAttempt(user, {
        maxAttempts,
        lockoutMinutes,
      });
      if (locked) {
        this.logger.warn({ event: 'auth.login.locked', userId: user.id });
      }
      this.logger.warn({
        event: 'auth.login.failed',
        userId: user.id,
        reason: 'invalid_password',
      });
      throw new UnauthorizedException(AuthService.INVALID_CREDENTIALS_MESSAGE);
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.usersService.save(user);

    if (!user.isEmailVerified) {
      this.logger.warn({
        event: 'auth.login.failed',
        userId: user.id,
        reason: 'email_not_verified',
      });
      throw new ForbiddenException('Email not verified');
    }

    const requireLoginConfirmation =
      String(
        this.configService.get('AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION'),
      ) === 'true';

    if (!requireLoginConfirmation) {
      const tokens = await this.startSession(user, meta);
      this.logger.log({ event: 'auth.login.success', userId: user.id });
      return tokens;
    }

    const { method } = await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.LOGIN,
      user.email,
    );
    this.logger.log({
      event: 'auth.login.success',
      userId: user.id,
      requiresConfirmation: true,
    });
    return { requiresConfirmation: true, method, email: user.email };
  }

  @Transactional()
  async confirmLoginOtp(
    email: string,
    code: string,
    meta?: SessionMeta,
  ): Promise<TokenPair> {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(
      user.id,
      code,
      EmailVerificationPurpose.LOGIN,
    );

    const tokens = await this.startSession(user, meta);
    this.logger.log({
      event: 'auth.login.confirmation_confirmed',
      userId: user.id,
    });
    return tokens;
  }

  @Transactional()
  async confirmLoginMagicLink(
    email: string,
    token: string,
    meta?: SessionMeta,
  ): Promise<TokenPair> {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(
      user.id,
      token,
      EmailVerificationPurpose.LOGIN,
    );

    const tokens = await this.startSession(user, meta);
    this.logger.log({
      event: 'auth.login.confirmation_confirmed',
      userId: user.id,
    });
    return tokens;
  }

  @Transactional()
  async resendLoginConfirmation(email: string) {
    const user = await this.findUserForConfirmation(email);

    const canResend = await this.emailVerificationService.canResend(
      user.id,
      EmailVerificationPurpose.LOGIN,
    );
    if (!canResend) {
      throw new HttpException(
        'Please wait before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.LOGIN,
      email,
    );

    this.logger.log({ event: 'auth.login.confirmation_sent', email });
    return { sent: true as const };
  }

  async refresh(refreshToken: string, meta?: SessionMeta): Promise<TokenPair> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);
    const user = await this.usersService.findById(payload.sub, ['roles']);

    if (!user || payload.tokenVersion !== user.tokenVersion) {
      this.logger.warn({
        event: 'auth.refresh.failed',
        userId: payload.sub,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newJti = randomUUID();
    const tokens = await this.tokenService.issueTokens(user, newJti);
    await this.refreshSessionService.rotate(
      payload.jti,
      refreshToken,
      newJti,
      tokens.refreshToken,
      meta,
    );

    this.logger.log({ event: 'auth.refresh.success', userId: user.id });
    return tokens;
  }

  @Transactional()
  async confirmOtp(email: string, code: string) {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(
      user.id,
      code,
      EmailVerificationPurpose.REGISTER,
    );

    user.isEmailVerified = true;
    await this.usersService.save(user);

    return { verified: true as const };
  }

  @Transactional()
  async confirmMagicLink(email: string, token: string) {
    const user = await this.findUserForConfirmation(email);

    await this.emailVerificationService.confirm(
      user.id,
      token,
      EmailVerificationPurpose.REGISTER,
    );

    user.isEmailVerified = true;
    await this.usersService.save(user);

    return { verified: true as const };
  }

  @Transactional()
  async resend(email: string) {
    const user = await this.findUserForConfirmation(email);

    const canResend = await this.emailVerificationService.canResend(
      user.id,
      EmailVerificationPurpose.REGISTER,
    );
    if (!canResend) {
      throw new HttpException(
        'Please wait before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.REGISTER,
      email,
    );

    this.logger.log({ event: 'auth.email_verification.resend', email });
    return { sent: true as const };
  }

  async logout(response: FastifyReply, refreshToken?: string): Promise<void> {
    clearAuthCookies(response);

    // Logout must succeed even with a missing/expired/forged token — there's
    // just nothing to revoke then.
    const payload = refreshToken
      ? await this.tokenService
          .verifyRefreshToken(refreshToken)
          .catch(() => null)
      : null;

    if (payload) {
      await this.refreshSessionService.revoke(payload.jti);
    }

    this.logger.log({
      event: 'auth.logout',
      ...(payload && { userId: payload.sub }),
    });
  }
}
