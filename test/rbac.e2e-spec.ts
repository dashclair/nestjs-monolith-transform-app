import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';

import { AppModule } from '@/core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { PasswordService } from '@/modules/auth/services/password.service';
import { Permission } from '@/modules/rbac/entities/permission.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { User } from '@/modules/users/entities/user.entity';

// Hits the real Postgres instance from `docker compose up -d postgres` —
// there's no isolated test DB/testcontainers setup yet (see PLAN.md's
// "стоит добавить" list), so every fixture this file creates is cleaned up
// in afterAll, and all names/emails are namespaced with `e2e-rbac-` to avoid
// colliding with the seeded admin/user roles or manually-created dev data.
describe('RBAC (e2e)', () => {
  let app: NestFastifyApplication;
  let usersRepo: Repository<User>;
  let rolesRepo: Repository<Role>;
  let permissionsRepo: Repository<Permission>;

  const PASSWORD = 'Password123!';
  const NONADMIN_EMAIL = 'e2e-rbac-nonadmin@test.local';
  const ADMIN_EMAIL = 'e2e-rbac-admin@test.local';
  const CACHE_USER_EMAIL = 'e2e-rbac-cache-user@test.local';
  const ROLE_NAME = 'e2e-rbac-editor';
  const PERMISSION_NAME = 'e2e-rbac-articles';
  const NON_EXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  // Since T-014, login no longer returns tokens in the body — the access
  // token travels only as a `Set-Cookie`. Extracting it here and reusing it
  // as a Bearer header below is a deliberate choice, not an oversight: it
  // lets this whole suite keep testing RBAC/guards without also having to
  // juggle a cookie jar through every subsequent request (Bearer fallback
  // in JwtStrategy exists exactly for this kind of tooling convenience).
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

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return extractCookieValue(res, 'access_token');
  };

  const createVerifiedUser = async (email: string, roleNames: string[] = []) => {
    const passwordHash = await new PasswordService().hash(PASSWORD);
    const roles = roleNames.length
      ? await rolesRepo.findBy({ name: In(roleNames) })
      : [];
    return usersRepo.save(
      usersRepo.create({ email, passwordHash, isEmailVerified: true, roles }),
    );
  };

  const cleanup = async () => {
    // No-op if beforeAll failed before the repositories were assigned (e.g.
    // the app never finished booting) — otherwise afterAll's cleanup() call
    // throws its own TypeError and hides the real failure.
    if (!rolesRepo) return;

    // Deleting roles/permissions cascades their grants (ON DELETE CASCADE on
    // Grant.roleId/permissionId); deleting users cascades user_roles. Order
    // between the three doesn't matter.
    await rolesRepo.delete({ name: ROLE_NAME });
    await permissionsRepo.delete({ name: PERMISSION_NAME });
    await usersRepo.delete({
      email: In([NONADMIN_EMAIL, ADMIN_EMAIL, CACHE_USER_EMAIL]),
    });
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
    // e2e specs boot AppModule directly (see the file-level comment above),
    // bypassing main.ts's bootstrap() — so @fastify/cookie has to be
    // registered here too, otherwise `reply.setCookie()`/`request.cookies`
    // don't exist and every login/refresh call 500s.
    await app.register(fastifyCookie, {
      secret: moduleFixture.get(ConfigService).get('COOKIE_SECRET'),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    usersRepo = moduleFixture.get(getRepositoryToken(User));
    rolesRepo = moduleFixture.get(getRepositoryToken(Role));
    permissionsRepo = moduleFixture.get(getRepositoryToken(Permission));

    // In case a previous run crashed before its own cleanup ran.
    await cleanup();

    await createVerifiedUser(NONADMIN_EMAIL);
    await createVerifiedUser(ADMIN_EMAIL, ['admin']);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  describe('a non-admin user', () => {
    it('gets 403 on every /admin/rbac/* resource, even just to read', async () => {
      const token = await login(NONADMIN_EMAIL);

      for (const path of [
        '/admin/rbac/roles',
        '/admin/rbac/permissions',
        '/admin/rbac/grants',
      ]) {
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('gets 401 with no token at all', async () => {
      await request(app.getHttpServer()).get('/admin/rbac/roles').expect(401);
    });
  });

  describe('full CRUD cycle as admin', () => {
    let adminToken: string;
    let roleId: string;
    let permissionId: string;

    beforeAll(async () => {
      adminToken = await login(ADMIN_EMAIL);
    });

    it('creates a role', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: ROLE_NAME, description: 'e2e fixture' })
        .expect(201);

      roleId = res.body.id;
      expect(res.body.name).toBe(ROLE_NAME);
    });

    it('rejects a duplicate role name with 409', async () => {
      await request(app.getHttpServer())
        .post('/admin/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: ROLE_NAME })
        .expect(409);
    });

    it('creates a permission', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/rbac/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: PERMISSION_NAME, actions: ['create', 'update', 'delete'] })
        .expect(201);

      permissionId = res.body.id;
      expect(res.body.actions).toEqual(['create', 'update', 'delete']);
    });

    it('rejects a grant whose actions are not a subset of the permission’s actions', async () => {
      await request(app.getHttpServer())
        .post('/admin/rbac/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId, permissionId, actions: ['publish'] })
        .expect(400);
    });

    it('creates a grant with a restricted actions list', async () => {
      await request(app.getHttpServer())
        .post('/admin/rbac/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId, permissionId, actions: ['create', 'update'] })
        .expect(201);
    });

    it('rejects a duplicate (role, permission) grant with 409', async () => {
      await request(app.getHttpServer())
        .post('/admin/rbac/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId, permissionId })
        .expect(409);
    });

    it('refuses to delete a role that still has an active grant', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/rbac/roles/${roleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('refuses to delete a permission that still has an active grant', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/rbac/permissions/${permissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('returns 404 for a role/permission id that does not exist', async () => {
      await request(app.getHttpServer())
        .put(`/admin/rbac/roles/${NON_EXISTENT_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'no-op' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/admin/rbac/permissions/${NON_EXISTENT_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('a grant change applies to the next request without a restart', () => {
    let adminToken: string;
    let cacheUserToken: string;
    let grantId: string;

    beforeAll(async () => {
      adminToken = await login(ADMIN_EMAIL);

      // The `e2e-rbac-editor` role from the previous describe block already
      // exists with a grant on `e2e-rbac-articles` — give it read-only access
      // to the `rbac` resource too, then put a user on that role, so we have
      // a live, HTTP-reachable permission check to flip on and off.
      const rolesRes = await request(app.getHttpServer())
        .get('/admin/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const role = rolesRes.body.find((r: { name: string }) => r.name === ROLE_NAME);

      const permissionsRes = await request(app.getHttpServer())
        .get('/admin/rbac/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const rbacPermission = permissionsRes.body.find(
        (p: { name: string }) => p.name === 'rbac',
      );

      const grantRes = await request(app.getHttpServer())
        .post('/admin/rbac/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: role.id, permissionId: rbacPermission.id, actions: ['read'] })
        .expect(201);
      grantId = grantRes.body.id;

      await createVerifiedUser(CACHE_USER_EMAIL, [ROLE_NAME]);
      cacheUserToken = await login(CACHE_USER_EMAIL);
    });

    it('grants read access once the grant exists', async () => {
      await request(app.getHttpServer())
        .get('/admin/rbac/roles')
        .set('Authorization', `Bearer ${cacheUserToken}`)
        .expect(200);
    });

    it('still refuses actions outside the granted list', async () => {
      await request(app.getHttpServer())
        .post('/admin/rbac/roles')
        .set('Authorization', `Bearer ${cacheUserToken}`)
        .send({ name: 'should-never-be-created' })
        .expect(403);
    });

    it('revokes access on the very next request after the grant is deleted — same token, no restart', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/rbac/grants/${grantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/admin/rbac/roles')
        .set('Authorization', `Bearer ${cacheUserToken}`)
        .expect(403);
    });
  });
});
