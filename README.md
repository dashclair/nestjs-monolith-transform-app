# Prism platform

NestJS monolith for a file-transformation service: user accounts, auth and
RBAC now, file upload + text/image transformation later. HTTP kernel is
**Fastify** (`@nestjs/platform-fastify`), storage is PostgreSQL via TypeORM.

## Quick start (fresh clone)

Requires Node.js, npm and Docker.

```bash
cp .env.example .env        # works as-is for local development
npm ci
docker compose up -d        # PostgreSQL + Mailpit
npm run migration:run       # schema + roles, permissions and grants
npm run seed:admin          # admin@example.com / ChangeMe123! (from .env)
npm run start:dev
```

Run the migrations **before** starting the app: RBAC grants are loaded into
memory at startup, so a grant added while the app is running is not seen
until a restart.

| What | URL |
|---|---|
| API (no global prefix) | http://localhost:3007 |
| Swagger UI | http://localhost:3007/api/docs |
| Mailpit (every email the app sends) | http://localhost:8025 |

### Resetting the database

```bash
# Full reset: removes the Postgres volume, irreversible
docker compose down -v && docker compose up -d

# Or drop only the schema and keep the containers
docker exec mnt-postgres psql -U postgres -d app -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose restart mailpit
```

Then repeat `migration:run` → `seed:admin` → `start:dev`.

## Testing

### Automated

```bash
npm run test          # unit tests (vitest, **/*.spec.ts)
npm run test:e2e      # e2e tests (**/*.e2e-spec.ts) — need the database running
npm run test:cov      # coverage
```

- e2e tests use the **same database as the dev server** (`POSTGRES_DB`).
  Leftovers from manual testing — especially rows in the `settings` table —
  change their behaviour. Reset the database or the settings (see below)
  before running them.
- `test/app.e2e-spec.ts` is leftover `nest new` boilerplate for a `GET /`
  route that does not exist; its failure is expected.

### Manual (Postman / REST client)

General tips:

- Tokens are sent **only as httpOnly cookies** (`access_token`,
  `refresh_token`), and the cookie wins over an `Authorization: Bearer`
  header. Postman stores cookies automatically, so the **last account that
  logged in is the one making requests**. Log in as the admin again before
  admin calls.
- For requests without a body (`POST /auth/logout`, `POST /auth/refresh`) set
  Body to **none**. Fastify rejects `Content-Type: application/json` with an
  empty body (400 "Body cannot be empty…").
- Confirmation emails contain only `Code: <value>`: 6 digits for OTP, a
  64-character hex token for magic links. Put the token into the confirm-link
  query yourself: `?email=...&token=...`.
- Always use the **latest** email: every login of an unverified user issues a
  new code and invalidates the previous one.
- Rate limits: login 5/min, register 3/min, resend 5/min, and a resend is
  allowed once per 60 s.

#### Scenario: admin-controlled email confirmation

Setup: log in as the admin (`POST /auth/login`).

1. **Read settings.** `GET /admin/settings/auth` returns 200 and the four
   values from `.env`.
2. **Confirmation off.**
   - `PATCH /admin/settings/auth` `{ "registrationConfirmationRequired": false }`.
   - `POST /auth/register` `{ "email": "u1@test.com", "password": "Password123" }`
     → 201 with `isEmailVerified: false` and no email sent.
   - Log in as `u1` → `{ "success": true }`.
3. **Admin turns confirmation on.**
   - As the admin: `PATCH` `{ "registrationConfirmationRequired": true }`.
   - Log in as `u1` → `{ "requiresConfirmation": true, "purpose": "register", "method": "otp", ... }`
     and a code arrives in Mailpit.
   - `POST /auth/register/confirm-otp` `{ "email": "u1@test.com", "code": "..." }`
     → `{ "verified": true }`.
   - Log in again → `{ "success": true }`. Verified users are never asked again.
4. **Magic link.**
   - As the admin: `PATCH` `{ "registrationConfirmationMethod": "magic_link" }`.
   - Register `u2`, then
     `GET /auth/register/confirm-link?email=u2@test.com&token=<hex>` → `{ "verified": true }`.
5. **Login confirmation (2FA on every login).**
   - As the admin: `PATCH` `{ "loginConfirmationRequired": true }`.
   - Log in as a verified user → `purpose: "login"`.
   - `POST /auth/login/confirm-otp` → cookies are set.
   - An **unverified** user still gets only one email, with `purpose: "register"`.
6. **Reset to env.** `PATCH` `{ "loginConfirmationRequired": null }` deletes
   the stored value, and the `.env` value applies again.
7. **Validation and access.**
   - `PATCH` with `{}`, `{ "loginConfirmationRequired": "true" }` or
     `{ "loginConfirmationMethod": "sms" }` → 400.
   - Without a session → 401. As a non-admin user → 403.
8. **Email change and account deletion keep using env.**
   - `POST /users/:id/email-change` `{ "newEmail": "..." }` sends an OTP
     (`AUTH_EMAIL_CHANGE_CONFIRMATION_METHOD`).
   - `POST /users/:id/delete-request` `{}` sends an OTP
     (`DELETE_ACCOUNT_CONFIRMATION_METHOD`).
   - Neither is affected by the admin settings.

Details of the settings API and its semantics:
[`src/modules/settings/README.md`](src/modules/settings/README.md).

## API overview

| Area | Routes | Access |
|---|---|---|
| Auth | `/auth/register`, `/auth/register/{confirm-otp,confirm-link,resend}`, `/auth/login`, `/auth/login/{confirm-otp,confirm-link,resend}`, `/auth/refresh`, `/auth/logout` | public |
| Users | `/users`, `/users/:userId`, `.../email-change[/confirm,/confirm-link]`, `.../delete-request`, `.../delete/confirm[-link]` | self or `users:*` permission |
| RBAC admin | `/admin/rbac/{roles,permissions,grants}` | `rbac` permission |
| Auth settings | `GET` / `PATCH /admin/settings/auth` | `settings:read` / `settings:update` |
| Health | `/health` | public |

Every route requires a JWT unless it is marked `@Public()`, and every route is
rate-limited by default (see `src/core/throttler/README.MD`).

## Project structure

```
src/
├── common/              # dependency-free helpers (validation, db error helpers, utils)
├── core/                # cross-cutting infrastructure, no business logic
│   ├── app/             # AppModule — wires everything together
│   ├── auth/            # JWT infra: TokenService, JwtAuthGuard, @Public(), SelfOnlyGuard
│   ├── config/          # ConfigModule + Joi-validated, typed ConfigService
│   ├── database/        # TypeORM connection, typeorm-transactional wiring
│   ├── email-verification/  # OTP / magic-link codes (issue, send, confirm)
│   ├── error-handling/  # AllExceptionsFilter
│   ├── health/          # terminus checks (db, memory, disk)
│   ├── mailer/          # nodemailer wrapper (Mailpit locally)
│   └── throttler/       # global rate limiting
├── database/            # TypeORM CLI data-source + migrations (*.migration.ts)
├── modules/
│   ├── auth/            # register, login, confirmation, refresh sessions
│   ├── users/           # profiles, email change, account deletion, listing
│   ├── rbac/            # roles, permissions, grants + guards
│   └── settings/        # admin-managed runtime settings (auth confirmation)
└── main.ts
```

Dependencies point one way: feature modules → `rbac` → `core`. `core/` must
not import from `modules/`; the one exception is `AppModule`, which wires
everything together.

## Configuration

- All env vars are validated at startup by a Joi schema
  (`src/core/config/config.validation.ts`). `.env.example` lists them with
  local defaults.
- `ConfigService.get()` returns strings, so coerce booleans and numbers at the
  call site: `String(config.get('X')) === 'true'`, `Number(...)`.
- Registration/login confirmation settings in `.env` are **defaults** only. An
  admin can override them at runtime via `/admin/settings/auth`.

## Database

- Entities: any `*.entity.ts` under `src/` is auto-loaded.
- `POSTGRES_SYNCHRONIZE` is `false`. Schema changes go through migrations in
  `src/database/migrations/`.
- `POSTGRES_MIGRATIONS_RUN=true` also applies pending migrations on app start.
- Transactions: `@Transactional()` from `typeorm-transactional`.

```bash
npm run migration:generate -- src/database/migrations/<Name>   # from entity changes
npm run migration:run
npm run migration:revert
npm run migration:show
```

Always use the npm script to generate migrations. It renames the output to
the `*.migration.ts` suffix, which is the only suffix `migration:run` picks up.

## Scripts

```bash
npm run start:dev     # dev server with hot reload
npm run build
npm run lint          # eslint --fix
npm run format        # prettier --write
npm run seed:admin    # create/assign the bootstrap admin (idempotent)
npm run db:up         # start only Postgres
npm run db:down
```

## Code style

- Use the `@/` alias for imports (`@/core/config/config.service`), not deep
  relative paths.
- Conventional Commits, lowercase and imperative, scoped to the module:
  `feat(auth): ...`, `fix(users): ...`.
- A pre-commit hook runs `eslint --fix` on staged files.
