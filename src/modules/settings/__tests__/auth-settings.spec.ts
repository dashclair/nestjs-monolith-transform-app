import { ValidationPipe, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { ConfigService } from '@/core/config/config.service';
import { RbacConfigService } from '@/modules/rbac/services/rbac-config.service';
import { AuthSettingsController } from '../auth-settings.controller';
import { AuthSettingsService } from '../auth-settings.service';
import { AUTH_SETTING_KEYS } from '../auth-settings.registry';
import { Setting, SettingValue } from '../entities/setting.entity';

vi.mock('typeorm-transactional', () => ({
  Transactional:
    () => (_target: object, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

describe('Auth settings API', () => {
  let app: NestFastifyApplication;
  let service: AuthSettingsService;
  const stored = new Map<string, SettingValue>();
  let env: Record<string, string>;
  const repo = {
    find: vi.fn(() =>
      Promise.resolve(
        [...stored]
          .filter(([key]) =>
            AUTH_SETTING_KEYS.includes(
              key as (typeof AUTH_SETTING_KEYS)[number],
            ),
          )
          .map(([key, value]) => ({ key, value })),
      ),
    ),
    upsert: vi.fn(({ key, value }: { key: string; value: SettingValue }) => {
      stored.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn(({ key }: { key: string }) => {
      stored.delete(key);
      return Promise.resolve();
    }),
  };
  const config = { get: vi.fn((key: string) => env[key]) };
  const rbac = {
    hasPermission: vi.fn(
      (roles: string[], resource: string, action: string) =>
        resource === 'settings' &&
        (roles.includes('admin') ||
          (roles.includes('reader') && action === 'read')),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthSettingsController],
      providers: [
        AuthSettingsService,
        { provide: getRepositoryToken(Setting), useValue: repo },
        { provide: ConfigService, useValue: config },
        { provide: RbacConfigService, useValue: rbac },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    // Simulate the identity supplied by the global JWT guard; exercise the real permissions guard.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (request, _reply, done) => {
        const role = request.headers['x-test-role'];
        if (typeof role === 'string')
          Object.assign(request, {
            user: { userId: 'actor-1', roles: [role] },
          });
        done();
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = module.get(AuthSettingsService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    env = {};
  });
  afterAll(async () => {
    await app.close();
  });

  const url = '/admin/settings/auth';
  const admin = { 'x-test-role': 'admin' };

  it('returns defaults when the table and env contain no overrides', async () => {
    const response = await app.inject({ method: 'GET', url, headers: admin });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      registrationConfirmationRequired: false,
      registrationConfirmationMethod: 'otp',
      loginConfirmationRequired: false,
      loginConfirmationMethod: 'otp',
    });
    expect(repo.find).toHaveBeenCalledWith({
      where: { key: In(AUTH_SETTING_KEYS) },
    });
  });

  it('uses database false over env true and only returns auth settings', async () => {
    env = {
      AUTH_REGISTER_REQUIRE_EMAIL_CONFIRMATION: 'true',
      AUTH_LOGIN_CONFIRMATION_METHOD: 'magic_link',
    };
    stored.set('registrationConfirmationRequired', false);
    stored.set('uploadsLimit', 200);
    const response = await app.inject({ method: 'GET', url, headers: admin });
    expect(response.json()).toEqual({
      registrationConfirmationRequired: false,
      registrationConfirmationMethod: 'otp',
      loginConfirmationRequired: false,
      loginConfirmationMethod: 'magic_link',
    });
  });

  it('inserts and updates only supplied keys and returns the effective settings', async () => {
    stored.set('registrationConfirmationRequired', true);
    const log = vi.spyOn(Logger.prototype, 'log');
    const response = await app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload: {
        loginConfirmationRequired: false,
        loginConfirmationMethod: 'magic_link',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      registrationConfirmationRequired: true,
      loginConfirmationRequired: false,
      loginConfirmationMethod: 'magic_link',
    });
    expect(repo.upsert).toHaveBeenCalledTimes(2);
    expect(repo.upsert).toHaveBeenCalledWith(
      { key: 'loginConfirmationRequired', value: false },
      ['key'],
    );
    expect(repo.upsert).toHaveBeenCalledWith(
      { key: 'loginConfirmationMethod', value: 'magic_link' },
      ['key'],
    );
    expect(repo.delete).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      event: 'settings.auth.updated',
      actorUserId: 'actor-1',
      changes: {
        loginConfirmationRequired: false,
        loginConfirmationMethod: 'magic_link',
      },
    });
    const updated = await app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload: { loginConfirmationRequired: true },
    });
    expect(updated.json()).toMatchObject({
      loginConfirmationRequired: true,
      loginConfirmationMethod: 'magic_link',
    });
    log.mockRestore();
  });

  it.each([
    {},
    { unknown: true },
    { field: 'loginConfirmationRequired', value: true },
    { loginConfirmationRequired: 'false' },
    { loginConfirmationRequired: 'true' },
    { loginConfirmationRequired: 0 },
    { registrationConfirmationRequired: 'false' },
    { loginConfirmationMethod: 'sms' },
    {
      loginConfirmationRequired: true,
      registrationConfirmationMethod: 'invalid',
    },
  ])('rejects invalid patches without writing: %j', async (payload) => {
    const response = await app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('resets a field to its env value when patched with null', async () => {
    env = { AUTH_LOGIN_REQUIRE_EMAIL_CONFIRMATION: 'true' };
    stored.set('loginConfirmationRequired', false);
    stored.set('loginConfirmationMethod', 'magic_link');
    const response = await app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload: { loginConfirmationRequired: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      loginConfirmationRequired: true,
      loginConfirmationMethod: 'magic_link',
    });
    expect(repo.delete).toHaveBeenCalledTimes(1);
    expect(repo.delete).toHaveBeenCalledWith({
      key: 'loginConfirmationRequired',
    });
    // Regression: a reset must not also upsert a null value (NOT NULL column).
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(stored.has('loginConfirmationMethod')).toBe(true);
  });

  it('applies updates and resets from the same patch', async () => {
    stored.set('registrationConfirmationMethod', 'magic_link');
    const response = await app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload: {
        registrationConfirmationMethod: null,
        loginConfirmationRequired: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      registrationConfirmationMethod: 'otp',
      loginConfirmationRequired: true,
    });
    expect(repo.delete).toHaveBeenCalledWith({
      key: 'registrationConfirmationMethod',
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      { key: 'loginConfirmationRequired', value: true },
      ['key'],
    );
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });

  // Regression: without awaiting the writes the response was read before
  // they landed, returning stale values.
  it('returns values only after the writes have completed', async () => {
    let finishWrite!: () => void;
    repo.upsert.mockImplementationOnce(({ key, value }) => {
      return new Promise<void>((resolve) => {
        finishWrite = () => {
          stored.set(key, value);
          resolve();
        };
      });
    });
    const pending = app.inject({
      method: 'PATCH',
      url,
      headers: admin,
      payload: { loginConfirmationRequired: true },
    });
    await vi.waitFor(() => expect(repo.upsert).toHaveBeenCalled());
    expect(repo.find).not.toHaveBeenCalled();
    finishWrite();
    const response = await pending;
    expect(response.json()).toMatchObject({ loginConfirmationRequired: true });
  });

  it.each(['GET', 'PATCH'] as const)(
    'rejects anonymous %s requests',
    async (method) => {
      const response = await app.inject({
        method,
        url,
        ...(method === 'PATCH'
          ? { payload: { loginConfirmationRequired: true } }
          : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(repo.find).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    },
  );

  it.each(['GET', 'PATCH'] as const)(
    'rejects ordinary users on %s',
    async (method) => {
      const response = await app.inject({
        method,
        url,
        headers: { 'x-test-role': 'user' },
        ...(method === 'PATCH'
          ? { payload: { loginConfirmationRequired: true } }
          : {}),
      });
      expect(response.statusCode).toBe(403);
    },
  );

  it('allows a read grant to GET but not PATCH', async () => {
    const headers = { 'x-test-role': 'reader' };
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { loginConfirmationRequired: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('propagates database failures instead of silently using env', async () => {
    const error = new Error('database unavailable');
    repo.find.mockRejectedValueOnce(error);
    await expect(service.getEffectiveSettings()).rejects.toBe(error);
  });

  it('rejects invalid stored values instead of treating the string false as a boolean', async () => {
    stored.set('loginConfirmationRequired', 'false');
    await expect(service.getEffectiveSettings()).rejects.toThrow(
      'Invalid configuration for loginConfirmationRequired',
    );
  });
});
