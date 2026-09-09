import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';

import { AuthController } from './auth.controller';
import { EmailVerificationMethod } from './email-verification-method.enum';
import { AuthService } from './services/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authServiceMock = {
    register: vi.fn<AuthService['register']>(),
    confirmOtp: vi.fn<AuthService['confirmOtp']>(),
    confirmMagicLink: vi.fn<AuthService['confirmMagicLink']>(),
    resend: vi.fn<AuthService['resend']>(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return a placeholder response', () => {
      expect(controller.login()).toEqual({ message: 'Not implemented yet' });
    });
  });

  describe('register', () => {
    it('should return the registered user and set status 201 when confirmation is not required', async () => {
      const serviceResult = {
        id: 'user-id',
        email: 'user@example.com',
        createdAt: new Date('2026-09-09T10:00:00.000Z'),
      };
      const status = vi.fn();
      const response = { status } as unknown as FastifyReply;

      authServiceMock.register.mockResolvedValue(serviceResult);

      const result = await controller.register(
        {
          email: 'user@example.com',
          password: 'password123',
        },
        response,
      );

      expect(authServiceMock.register).toHaveBeenCalledOnce();
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
      const response = { status } as unknown as FastifyReply;

      authServiceMock.register.mockResolvedValue(serviceResult);

      const result = await controller.register(
        {
          email: 'user@example.com',
          password: 'password123',
        },
        response,
      );

      expect(authServiceMock.register).toHaveBeenCalledOnce();
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

      expect(authServiceMock.confirmOtp).toHaveBeenCalledOnce();
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

      expect(authServiceMock.confirmMagicLink).toHaveBeenCalledOnce();
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
      authServiceMock.resend.mockResolvedValue(serviceResult);

      const result = await controller.resend({ email: 'user@example.com' });

      expect(authServiceMock.resend).toHaveBeenCalledOnce();
      expect(authServiceMock.resend).toHaveBeenCalledWith('user@example.com');
      expect(result).toBe(serviceResult);
    });
  });
});
