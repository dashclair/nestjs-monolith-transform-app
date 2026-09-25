import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ConfigService } from '@/core/config/config.service';

import { AuthController } from '../auth.controller';
import { EmailVerificationMethod } from '../../../core/email-verification/email-verification-method.enum';
import { EmailVerificationPurpose } from '../../../core/email-verification/email-verification-purpose.enum';
import { AuthService } from '../services/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authServiceMock = {
    register: vi.fn<AuthService['register']>(),
    confirmOtp: vi.fn<AuthService['confirmOtp']>(),
    confirmMagicLink: vi.fn<AuthService['confirmMagicLink']>(),
    resendRegisterConfirmation:
      vi.fn<AuthService['resendRegisterConfirmation']>(),
    login: vi.fn<AuthService['login']>(),
    confirmLoginOtp: vi.fn<AuthService['confirmLoginOtp']>(),
    confirmLoginMagicLink: vi.fn<AuthService['confirmLoginMagicLink']>(),
    resendLoginConfirmation: vi.fn<AuthService['resendLoginConfirmation']>(),
    refresh: vi.fn<AuthService['refresh']>(),
    logout: vi.fn<AuthService['logout']>(),
  };
  const configServiceMock = {
    get: vi.fn<ConfigService['get']>((key: string) => {
      const values: Record<string, string> = {
        COOKIE_SECURE: 'false',
        COOKIE_SAMESITE: 'lax',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '30d',
      };
      return values[key];
    }),
  };

  function buildResponse(status = vi.fn()): FastifyReply {
    return {
      setCookie: vi.fn(),
      clearCookie: vi.fn(),
      status,
    } as unknown as FastifyReply;
  }

  function buildRequest(cookies: Record<string, string> = {}): FastifyRequest {
    return {
      cookies,
      headers: { 'user-agent': 'test-agent' },
      ip: '127.0.0.1',
    } as unknown as FastifyRequest;
  }

  const meta = { userAgent: 'test-agent', ip: '127.0.0.1' };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('sets auth cookies and returns { success: true } when login succeeds', async () => {
      const serviceResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      authServiceMock.login.mockResolvedValue(serviceResult);
      const response = buildResponse();

      const dto = { email: 'user@example.com', password: 'password123' };
      const result = await controller.login(dto, buildRequest(), response);

      expect(authServiceMock.login).toHaveBeenCalledWith(dto, meta);
      expect(response.setCookie).toHaveBeenCalledWith(
        'access_token',
        'access-token',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(response.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true, path: '/auth' }),
      );
      expect(result).toEqual({ success: true });
    });

    it('does not set cookies and passes through the confirmation payload when login requires confirmation', async () => {
      const serviceResult = {
        requiresConfirmation: true as const,
        purpose: EmailVerificationPurpose.LOGIN,
        method: EmailVerificationMethod.OTP,
        email: 'user@example.com',
      };
      authServiceMock.login.mockResolvedValue(serviceResult);
      const response = buildResponse();

      const dto = { email: 'user@example.com', password: 'password123' };
      const result = await controller.login(dto, buildRequest(), response);

      expect(response.setCookie).not.toHaveBeenCalled();
      expect(result).toBe(serviceResult);
    });
  });

  describe('confirmLoginOtp', () => {
    it('sets auth cookies and returns { success: true }', async () => {
      const serviceResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      authServiceMock.confirmLoginOtp.mockResolvedValue(serviceResult);
      const response = buildResponse();

      const result = await controller.confirmLoginOtp(
        { email: 'user@example.com', code: '123456' },
        buildRequest(),
        response,
      );

      expect(authServiceMock.confirmLoginOtp).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
        meta,
      );
      expect(response.setCookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });
  });

  describe('confirmLoginLink', () => {
    it('sets auth cookies and returns { success: true }', async () => {
      const serviceResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      authServiceMock.confirmLoginMagicLink.mockResolvedValue(serviceResult);
      const response = buildResponse();

      const result = await controller.confirmLoginLink(
        { email: 'user@example.com', token: 'abc123' },
        buildRequest(),
        response,
      );

      expect(authServiceMock.confirmLoginMagicLink).toHaveBeenCalledWith(
        'user@example.com',
        'abc123',
        meta,
      );
      expect(response.setCookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });
  });

  describe('resendLogin', () => {
    it('should resend via AuthService and return its result', async () => {
      const serviceResult = { sent: true as const };
      authServiceMock.resendLoginConfirmation.mockResolvedValue(serviceResult);

      const result = await controller.resendLogin({
        email: 'user@example.com',
      });

      expect(authServiceMock.resendLoginConfirmation).toHaveBeenCalledWith(
        'user@example.com',
      );
      expect(result).toBe(serviceResult);
    });
  });

  describe('refresh', () => {
    it('reads the refresh token from the cookie, sets new cookies and returns { success: true }', async () => {
      const serviceResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };
      authServiceMock.refresh.mockResolvedValue(serviceResult);
      const response = buildResponse();
      const request = buildRequest({ refresh_token: 'old-refresh-token' });

      const result = await controller.refresh(request, response);

      expect(authServiceMock.refresh).toHaveBeenCalledWith(
        'old-refresh-token',
        meta,
      );
      expect(response.setCookie).toHaveBeenCalledWith(
        'access_token',
        'new-access-token',
        expect.objectContaining({ path: '/' }),
      );
      expect(response.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        'new-refresh-token',
        expect.objectContaining({ path: '/auth' }),
      );
      expect(result).toEqual({ success: true });
    });

    it('rejects with 401 without calling AuthService when the refresh cookie is missing', async () => {
      const response = buildResponse();
      const request = buildRequest();

      await expect(controller.refresh(request, response)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(authServiceMock.refresh).not.toHaveBeenCalled();
      expect(response.setCookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('delegates to AuthService.logout with the refresh token cookie', async () => {
      const response = buildResponse();
      const request = buildRequest({ refresh_token: 'refresh-token-value' });

      const result = await controller.logout(request, response);

      expect(authServiceMock.logout).toHaveBeenCalledWith(
        response,
        'refresh-token-value',
      );
      expect(result).toEqual({ loggedOut: true });
    });

    it('still logs out when there is no refresh token cookie', async () => {
      const response = buildResponse();
      const request = buildRequest();

      const result = await controller.logout(request, response);

      expect(authServiceMock.logout).toHaveBeenCalledWith(response, undefined);
      expect(result).toEqual({ loggedOut: true });
    });
  });

  describe('register', () => {
    it('should return the registered user and set status 201 when confirmation is not required', async () => {
      const serviceResult = {
        id: 'user-id',
        email: 'user@example.com',
        createdAt: new Date('2026-09-09T10:00:00.000Z'),
        isEmailVerified: false,
      };
      const status = vi.fn();
      const response = buildResponse(status);

      authServiceMock.register.mockResolvedValue(serviceResult);

      const result = await controller.register(
        {
          email: 'user@example.com',
          password: 'password123',
        },
        response,
      );

      expect(authServiceMock.register).toHaveBeenCalledWith(
        'user@example.com',
        'password123',
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(result).toBe(serviceResult);
    });

    it('should return confirmation details and set status 200 when confirmation is required', async () => {
      const serviceResult = {
        requiresConfirmation: true,
        method: EmailVerificationMethod.OTP,
        email: 'user@example.com',
      };
      const status = vi.fn();
      const response = buildResponse(status);

      authServiceMock.register.mockResolvedValue(serviceResult);

      const result = await controller.register(
        {
          email: 'user@example.com',
          password: 'password123',
        },
        response,
      );

      expect(authServiceMock.register).toHaveBeenCalledWith(
        'user@example.com',
        'password123',
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result).toBe(serviceResult);
    });
  });

  describe('confirmOtp', () => {
    it('should confirm via AuthService and return its result', async () => {
      const serviceResult = { verified: true as const };
      authServiceMock.confirmOtp.mockResolvedValue(serviceResult);

      const result = await controller.confirmOtp({
        email: 'user@example.com',
        code: '123456',
      });

      expect(authServiceMock.confirmOtp).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
      );
      expect(result).toBe(serviceResult);
    });
  });

  describe('confirmLink', () => {
    it('should confirm via AuthService using the magic-link token and return its result', async () => {
      const serviceResult = { verified: true as const };
      authServiceMock.confirmMagicLink.mockResolvedValue(serviceResult);

      const result = await controller.confirmLink({
        email: 'user@example.com',
        token: 'abc123',
      });

      expect(authServiceMock.confirmMagicLink).toHaveBeenCalledWith(
        'user@example.com',
        'abc123',
      );
      expect(result).toBe(serviceResult);
    });
  });

  describe('resend', () => {
    it('should resend via AuthService and return its result', async () => {
      const serviceResult = { sent: true as const };
      authServiceMock.resendRegisterConfirmation.mockResolvedValue(
        serviceResult,
      );

      const result = await controller.resend({ email: 'user@example.com' });

      expect(authServiceMock.resendRegisterConfirmation).toHaveBeenCalledWith(
        'user@example.com',
      );
      expect(result).toBe(serviceResult);
    });
  });
});
