import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';

import { AppModule } from '@/core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { PasswordService } from '@/modules/auth/services/password.service';
import { Role } from '@/modules/rbac/entities/role.entity';
import { User } from '@/modules/users/entities/user.entity';

// Hits the real Postgres instance from `docker compose up -d postgres` — see
// the same note in rbac.e2e-spec.ts. Fixtures here are namespaced
// `e2e-auth-` to avoid colliding with rbac.e2e-spec.ts's `e2e-rbac-` fixtures
// or seeded dev data.
describe('Auth cookie transport (e2e)', () => {
  let app: NestFastifyApplication;
  let usersRepo: Repository<User>;
  let rolesRepo: Repository<Role>;

  const PASSWORD = 'Password123!';
  const USER_EMAIL = 'e2e-auth-user@test.local';
  const ADMIN_EMAIL = 'e2e-auth-admin@test.local';

  const extractSetCookie = (res: request.Response, name: string): string => {
    const setCookieHeader = res.headers['set-cookie'] as unknown as
      | string[]
      | undefined;
    const cookie = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
    if (!cookie) {
      throw new Error(
        `Expected a Set-Cookie header for "${name}", got: ${JSON.stringify(setCookieHeader)}`,
      );
    }
    return cookie;
  };

  const extractCookieValue = (cookieHeader: string): string =>
    cookieHeader.split(';')[0].split('=')[1];

  const login = async (email: string): Promise<request.Response> =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

  const createVerifiedUser = async (
    email: string,
    roleNames: string[] = [],
  ) => {
    const passwordHash = await new PasswordService().hash(PASSWORD);
    const roles = roleNames.length
      ? await rolesRepo.findBy({ name: In(roleNames) })
      : [];
    return usersRepo.save(
      usersRepo.create({ email, passwordHash, isEmailVerified: true, roles }),
    );
  };

  const cleanup = async () => {
    if (!usersRepo) return;
    await usersRepo.delete({ email: In([USER_EMAIL, ADMIN_EMAIL]) });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
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
    await app.register(fastifyCookie, {
      secret: moduleFixture.get(ConfigService).get('COOKIE_SECRET'),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    usersRepo = moduleFixture.get(getRepositoryToken(User));
    rolesRepo = moduleFixture.get(getRepositoryToken(Role));

    await cleanup();

    await createVerifiedUser(USER_EMAIL);
    await createVerifiedUser(ADMIN_EMAIL, ['admin']);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  describe('POST /auth/login', () => {
    it('sets HttpOnly cookies for both tokens and never returns them in the body', async () => {
      const res = await login(USER_EMAIL);

      const accessCookie = extractSetCookie(res, 'access_token');
      const refreshCookie = extractSetCookie(res, 'refresh_token');

      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/Path=\//);
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/Path=\/auth(;|$)/);

      expect(res.body).toEqual({ success: true });
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
    });
  });

  describe('a protected route', () => {
    it('returns 401 with neither a cookie nor an Authorization header', async () => {
      await request(app.getHttpServer()).get('/admin/rbac/roles').expect(401);
    });

    it('authenticates via the access_token cookie alone, without any Authorization header', async () => {
      const loginRes = await login(ADMIN_EMAIL);
      const accessToken = extractCookieValue(
        extractSetCookie(loginRes, 'access_token'),
      );

      await request(app.getHttpServer())
        .get('/admin/rbac/roles')
        .set('Cookie', [`access_token=${accessToken}`])
        .expect(200);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 401 without a refresh_token cookie', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });

    it('rotates the token pair when the refresh cookie is valid', async () => {
      const loginRes = await login(USER_EMAIL);
      const oldAccess = extractCookieValue(
        extractSetCookie(loginRes, 'access_token'),
      );
      const oldRefresh = extractCookieValue(
        extractSetCookie(loginRes, 'refresh_token'),
      );

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefresh}`])
        .expect(200);

      const newAccess = extractCookieValue(
        extractSetCookie(refreshRes, 'access_token'),
      );
      const newRefresh = extractCookieValue(
        extractSetCookie(refreshRes, 'refresh_token'),
      );

      expect(refreshRes.body).toEqual({ success: true });
      expect(newAccess).not.toBe(oldAccess);
      expect(newRefresh).not.toBe(oldRefresh);
    });

    it('treats a reused refresh token as theft and revokes the whole chain', async () => {
      const oldRefresh = extractCookieValue(
        extractSetCookie(await login(USER_EMAIL), 'refresh_token'),
      );
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefresh}`])
        .expect(200);
      const newRefresh = extractCookieValue(
        extractSetCookie(refreshRes, 'refresh_token'),
      );

      // Replaying the already-rotated token is rejected...
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefresh}`])
        .expect(401);
      // ...and it also kills the legitimate successor.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${newRefresh}`])
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears both cookies with an expired Expires attribute, even with no cookies at all', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(200);

      const accessCookie = extractSetCookie(res, 'access_token');
      const refreshCookie = extractSetCookie(res, 'refresh_token');

      expect(accessCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(refreshCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(res.body).toEqual({ loggedOut: true });
    });

    it('revokes the refresh session, so the token cannot be used afterwards', async () => {
      const refresh = extractCookieValue(
        extractSetCookie(await login(USER_EMAIL), 'refresh_token'),
      );

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', [`refresh_token=${refresh}`])
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${refresh}`])
        .expect(401);
    });
  });
});
