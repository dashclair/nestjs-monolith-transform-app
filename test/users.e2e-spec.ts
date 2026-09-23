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
import { TokenService } from '@/core/auth/services/token.service';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';
import { PasswordService } from '@/modules/auth/services/password.service';
import { Role } from '@/modules/rbac/entities/role.entity';
import { User } from '@/modules/users/entities/user.entity';

// Hits the real Postgres instance from `docker compose up -d postgres`, same
// as auth.e2e-spec.ts/rbac.e2e-spec.ts, plus the real Mailpit SMTP/API
// (`docker compose up -d` also starts it) to verify the email-change OTP
// actually lands at the *new* address, not the old one — that's the one
// behavior a mocked MailerService can't prove. Fixtures are namespaced
// `e2e-users-` to avoid colliding with the other e2e suites' fixtures.
//
// Tokens for API calls are minted directly via TokenService rather than
// through `POST /auth/login` — that route is throttled to 5 requests/60s
// (AuthController.login's @Throttle()), and login itself isn't what this
// suite tests. The two `/auth/login` calls in the round-trip test below are
// the only real login attempts, and are the actual point of that assertion.
describe('Users profile & email change (e2e)', () => {
  let app: NestFastifyApplication;
  let usersRepo: Repository<User>;
  let rolesRepo: Repository<Role>;
  let tokenService: TokenService;

  const PASSWORD = 'Password123!';

  const SELF_EMAIL = 'e2e-users-self@test.local';
  const OTHER_EMAIL = 'e2e-users-other@test.local';
  const ADMIN_EMAIL = 'e2e-users-admin@test.local';
  const ADMIN_TARGET_EMAIL = 'e2e-users-admin-target@test.local';
  const ADMIN_TARGET_NEW_EMAIL = 'e2e-users-admin-target-new@test.local';
  const CHANGE_EMAIL = 'e2e-users-change@test.local';
  const CHANGE_NEW_EMAIL = 'e2e-users-change-new@test.local';
  const WRONG_CODE_EMAIL = 'e2e-users-wrong-code@test.local';
  const WRONG_CODE_NEW_EMAIL = 'e2e-users-wrong-code-new@test.local';
  const GRANT_EMAIL = 'e2e-users-grant@test.local';
  const GRANT_TARGET_EMAIL = 'e2e-users-grant-target@test.local';

  const ROLE_NAME = 'e2e-users-update-role';

  const ALL_FIXTURE_EMAILS = [
    SELF_EMAIL,
    OTHER_EMAIL,
    ADMIN_EMAIL,
    ADMIN_TARGET_EMAIL,
    ADMIN_TARGET_NEW_EMAIL,
    CHANGE_EMAIL,
    CHANGE_NEW_EMAIL,
    WRONG_CODE_EMAIL,
    WRONG_CODE_NEW_EMAIL,
    GRANT_EMAIL,
    GRANT_TARGET_EMAIL,
  ];

  const MAILPIT_URL = 'http://localhost:8025';

  const extractCookieValue = (res: request.Response, name: string): string => {
    const setCookieHeader = res.headers['set-cookie'] as unknown as
      | string[]
      | undefined;
    const cookie = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
    if (!cookie) {
      throw new Error(
        `Expected a Set-Cookie header for "${name}", got: ${JSON.stringify(setCookieHeader)}`,
      );
    }
    return cookie.split(';')[0].split('=')[1];
  };

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

  const findUser = (email: string): Promise<User> =>
    usersRepo.findOneOrFail({ where: { email }, relations: ['roles'] });

  const tokenFor = async (email: string): Promise<string> => {
    const user = await findUser(email);
    const { accessToken } = await tokenService.issueTokens(user);
    return accessToken;
  };

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

  type MailpitMessage = { To: { Address: string }[]; Snippet: string };

  const clearMailbox = async (): Promise<void> => {
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  };

  const messagesTo = async (email: string): Promise<MailpitMessage[]> => {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const json = (await res.json()) as { messages: MailpitMessage[] };
    return json.messages.filter((m) =>
      m.To.some((t) => t.Address === email),
    );
  };

  // MailerService.sendMail() is awaited inside the same request that
  // triggers it, so the message is already in Mailpit by the time the HTTP
  // response comes back — this loop is defensive padding, not the primary
  // wait mechanism.
  const waitForCodeSentTo = async (email: string): Promise<string> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [message] = await messagesTo(email);
      const match = message?.Snippet.match(/Code: (\S+)/);
      if (match) return match[1];
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No confirmation email arrived for ${email}`);
  };

  const cleanup = async () => {
    if (!usersRepo) return;
    await usersRepo.delete({ email: In(ALL_FIXTURE_EMAILS) });
    await rolesRepo.delete({ name: ROLE_NAME });
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
    tokenService = moduleFixture.get(TokenService);

    await cleanup();
    await clearMailbox();

    await createVerifiedUser(SELF_EMAIL);
    await createVerifiedUser(OTHER_EMAIL);
    await createVerifiedUser(ADMIN_EMAIL, ['admin']);
    await createVerifiedUser(ADMIN_TARGET_EMAIL);
    await createVerifiedUser(CHANGE_EMAIL);
    await createVerifiedUser(WRONG_CODE_EMAIL);
    await createVerifiedUser(GRANT_TARGET_EMAIL);

    // Give a plain (non-admin) role an explicit `users:update` grant, to
    // prove PATCH honors the permission — not a hardcoded 'admin' role name.
    const adminToken = await tokenFor(ADMIN_EMAIL);
    const roleRes = await request(app.getHttpServer())
      .post('/admin/rbac/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: ROLE_NAME })
      .expect(201);
    const permissionsRes = await request(app.getHttpServer())
      .get('/admin/rbac/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const usersPermission = permissionsRes.body.find(
      (p: { name: string }) => p.name === 'users',
    );
    await request(app.getHttpServer())
      .post('/admin/rbac/grants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roleId: roleRes.body.id,
        permissionId: usersPermission.id,
        actions: ['update'],
      })
      .expect(201);
    await createVerifiedUser(GRANT_EMAIL, [ROLE_NAME]);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  describe('PATCH /users/:id', () => {
    it('lets self update their own photo without touching email', async () => {
      const self = await findUser(SELF_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      const res = await request(app.getHttpServer())
        .patch(`/users/${self.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photo: 'https://example.com/self.jpg' })
        .expect(200);

      expect(res.body.photo).toBe('https://example.com/self.jpg');
      expect(res.body.email).toBe(SELF_EMAIL);
    });

    it('rejects self passing email with 403 and the specific hint to use /email-change', async () => {
      const self = await findUser(SELF_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      const res = await request(app.getHttpServer())
        .patch(`/users/${self.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'sneaky@example.com' })
        .expect(403);

      expect(res.body.message).toBe(
        'Cannot change email via this endpoint — use /email-change',
      );

      const reloaded = await usersRepo.findOneByOrFail({ id: self.id });
      expect(reloaded.email).toBe(SELF_EMAIL);
    });

    it('403s a self-or-permission mismatch: no grant and not self', async () => {
      const other = await findUser(OTHER_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      await request(app.getHttpServer())
        .patch(`/users/${other.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photo: 'https://example.com/should-not-apply.jpg' })
        .expect(403);
    });

    it('lets admin change another user’s email directly, with no confirmation email sent', async () => {
      const target = await findUser(ADMIN_TARGET_EMAIL);
      const adminToken = await tokenFor(ADMIN_EMAIL);
      await clearMailbox();

      const res = await request(app.getHttpServer())
        .patch(`/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: ADMIN_TARGET_NEW_EMAIL })
        .expect(200);

      expect(res.body.email).toBe(ADMIN_TARGET_NEW_EMAIL);
      expect(await messagesTo(ADMIN_TARGET_NEW_EMAIL)).toHaveLength(0);
    });

    it('rejects an admin email change to an address already taken by someone else, with 409', async () => {
      const target = await findUser(ADMIN_TARGET_NEW_EMAIL);
      const adminToken = await tokenFor(ADMIN_EMAIL);

      await request(app.getHttpServer())
        .patch(`/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: OTHER_EMAIL })
        .expect(409);
    });

    it('lets a non-admin user with an explicit users:update grant update someone else’s photo', async () => {
      const target = await findUser(GRANT_TARGET_EMAIL);
      const grantToken = await tokenFor(GRANT_EMAIL);

      const res = await request(app.getHttpServer())
        .patch(`/users/${target.id}`)
        .set('Authorization', `Bearer ${grantToken}`)
        .send({ photo: 'https://example.com/via-grant.jpg' })
        .expect(200);

      expect(res.body.photo).toBe('https://example.com/via-grant.jpg');
    });
  });

  describe('email-change flow (self)', () => {
    it('rejects newEmail equal to the current email with 400', async () => {
      const self = await findUser(SELF_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      await request(app.getHttpServer())
        .post(`/users/${self.id}/email-change`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: SELF_EMAIL })
        .expect(400);
    });

    it('rejects an already-registered newEmail with 409 and does not set pendingEmail', async () => {
      const self = await findUser(SELF_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      await request(app.getHttpServer())
        .post(`/users/${self.id}/email-change`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: OTHER_EMAIL })
        .expect(409);

      const reloaded = await usersRepo.findOneByOrFail({ id: self.id });
      expect(reloaded.pendingEmail).toBeNull();
    });

    it('403s when a self-only route is used against someone else’s userId', async () => {
      const other = await findUser(OTHER_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      await request(app.getHttpServer())
        .post(`/users/${other.id}/email-change`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: 'irrelevant@example.com' })
        .expect(403);
    });

    it('404s confirm when there is no pending email change', async () => {
      const self = await findUser(SELF_EMAIL);
      const token = await tokenFor(SELF_EMAIL);

      await request(app.getHttpServer())
        .post(`/users/${self.id}/email-change/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })
        .expect(404);
    });

    it(
      'sends the code only to the new address, confirms with it, and the old email can no longer log in',
      async () => {
        const user = await findUser(CHANGE_EMAIL);
        const token = await tokenFor(CHANGE_EMAIL);
        await clearMailbox();

        const initiateRes = await request(app.getHttpServer())
          .post(`/users/${user.id}/email-change`)
          .set('Authorization', `Bearer ${token}`)
          .send({ newEmail: CHANGE_NEW_EMAIL })
          .expect(200);

        expect(initiateRes.body).toEqual({
          requiresConfirmation: true,
          method: EmailVerificationMethod.OTP,
        });

        const code = await waitForCodeSentTo(CHANGE_NEW_EMAIL);
        expect(await messagesTo(CHANGE_EMAIL)).toHaveLength(0);

        const confirmRes = await request(app.getHttpServer())
          .post(`/users/${user.id}/email-change/confirm`)
          .set('Authorization', `Bearer ${token}`)
          .send({ code })
          .expect(200);
        expect(confirmRes.body).toEqual({ email: CHANGE_NEW_EMAIL });

        await login(CHANGE_EMAIL).expect(401);
        await login(CHANGE_NEW_EMAIL).expect(200);
      },
      15000,
    );

    it(
      'increments the attempt count on a wrong code and locks out with 429 past the limit',
      async () => {
        const user = await findUser(WRONG_CODE_EMAIL);
        const token = await tokenFor(WRONG_CODE_EMAIL);

        await request(app.getHttpServer())
          .post(`/users/${user.id}/email-change`)
          .set('Authorization', `Bearer ${token}`)
          .send({ newEmail: WRONG_CODE_NEW_EMAIL })
          .expect(200);

        // EMAIL_VERIFICATION_MAX_ATTEMPTS=5 by default (.env.example).
        for (let attempt = 0; attempt < 5; attempt++) {
          await request(app.getHttpServer())
            .post(`/users/${user.id}/email-change/confirm`)
            .set('Authorization', `Bearer ${token}`)
            .send({ code: 'wrong-code' })
            .expect(400);
        }

        await request(app.getHttpServer())
          .post(`/users/${user.id}/email-change/confirm`)
          .set('Authorization', `Bearer ${token}`)
          .send({ code: 'wrong-code' })
          .expect(429);

        const reloaded = await usersRepo.findOneByOrFail({ id: user.id });
        expect(reloaded.email).toBe(WRONG_CODE_EMAIL);
      },
      15000,
    );
  });
});
