# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS monolith for a file-transformation service ("Prism platform"): user
accounts/auth now, file upload + text/image transformation later. It started
as `nest new` boilerplate; `docs/PLAN.md` is the sequenced ticket backlog
(epics: infra → users/auth → file transformation) and **is written in
Russian**. Read it (and `docs/IMPLEMENTATION-LOG.md`) before starting new
ticket work to see what's already decided and why.

**`docs/` is local-only — gitignored, not part of the repository.** It exists
in the maintainer's working copy but not in a fresh clone. If it's missing,
don't recreate it or treat references to it (here or in code comments) as
broken — just work from the code. Never `git add -f` anything under `docs/`.

- `docs/PLAN.md` — the plan/backlog, one checkbox section per ticket (`T-0xx`).
  Keep it updated as tickets complete, but only when the user asks — it's not
  auto-maintained by every commit.
- `docs/IMPLEMENTATION-LOG.md` — append-only journal of *how/why* each ticket
  was implemented: alternatives considered, bugs found during manual
  verification, rationale. Much more detail than the plan's one-line summary.
- `docs/tickets/T-xxx-*.md` — full contract for specific tickets (acceptance
  criteria, error tables, architectural decisions) when a ticket is big enough
  to need one.

Both docs are large and living — don't rewrite them wholesale; append/edit the
relevant section.

## Commands

```bash
npm run start:dev        # dev server with hot reload
npm run build             # nest build
npm run lint               # eslint --fix over src/apps/libs/test
npm run format              # prettier --write src/test

npm run test                 # vitest run (unit, **/*.spec.ts)
npm run test:watch
npm run test:cov
npm run test:e2e             # vitest run --config vitest.config.e2e.ts (**/*.e2e-spec.ts)
vitest run path/to.spec.ts   # single file
vitest run -t "test name"    # single test by name

npm run db:up                 # docker compose up -d postgres
npm run db:down

npm run migration:generate -- src/database/migrations/<Name>   # from entity diff
npm run migration:run
npm run migration:revert
npm run migration:show
```

`docker compose up -d` also starts **Mailpit** (SMTP dev server, UI on
`:8025`) used by the mailer in dev/tests.

`migration:generate` is a wrapper (`scripts/migration-generate.js`) around
`typeorm migration:generate` that renames the output to this project's
`*.migration.ts` suffix — required because `src/database/data-source.ts`'s
migrations glob only picks up that suffix; the raw TypeORM CLI output would
silently be skipped by `migration:run` otherwise. Always use the npm script,
never `typeorm migration:generate` directly.

## Architecture

- **HTTP kernel is Fastify**, not Express (`@nestjs/platform-fastify`). Use
  `NestFastifyApplication` / `app.register(...)` and Fastify-native plugins
  (`@fastify/compress`, `@fastify/cookie`, and `@fastify/multipart` for future
  file uploads) — not Express middleware or `multer`.
- **Path alias** `@/*` → `src/*` (`tsconfig.json`), configured for tests via
  `vite-tsconfig-paths` in both vitest configs. Use `@/...` imports, not deep
  relative paths.
- **Layout**:
  ```
  src/
  ├── common/          # dependency-free helpers shared by any layer (e.g. validation decorators)
  ├── core/            # cross-cutting infra, not business logic
  │   ├── app/         # AppModule — wires everything together
  │   ├── auth/        # JWT infra: TokenService, JwtAuthGuard, extractors, @Public(), SelfOnlyGuard
  │   ├── config/      # ConfigModule + Joi-validated, typed ConfigService
  │   ├── database/    # TypeORM + PostgreSQL connection, typeorm-transactional wiring
  │   ├── email-verification/  # OTP/magic-link codes: issue, send, confirm, resend throttle
  │   ├── error-handling/  # AllExceptionsFilter + diagnostic TestErrorsController
  │   ├── health/      # @nestjs/terminus checks (db/memory/disk)
  │   ├── mailer/       # nodemailer wrapper (Mailpit in dev)
  │   └── throttler/    # @nestjs/throttler global guard config
  ├── database/         # TypeORM CLI data-source + migrations (*.migration.ts)
  ├── modules/           # feature modules: auth, users, rbac, settings
  └── main.ts
  ```
- **Config**: env vars are a flat list on the `Config` interface
  (`core/config/config.types.ts`) with prefixes (`POSTGRES_*`, `JWT_*`,
  `AUTH_*`, `MAIL_*`, `STORAGE_*`) — deliberately not split into
  `registerAs()` namespaces (decided not worth it at this scale). Validated by
  a Joi schema (`config.validation.ts`); `ConfigService.get()` always returns
  the raw string from `@nestjs/config` typed as `string`, so **boolean/number
  config values must be explicitly coerced at the call site**
  (`String(configService.get('X')) === 'true'`, `Number(...)`) — comparing
  directly against a boolean literal is a bug that has bitten this repo once
  already.
- **Global request pipeline** (registered via `APP_FILTER`/`APP_GUARD`/
  `APP_INTERCEPTOR` in `AppModule`, not imperatively in `main.ts`, so they also
  apply inside `TestingModule`-based tests): `ValidationPipe`
  (whitelist + forbidNonWhitelisted + transform), `ClassSerializerInterceptor`
  (so `@Exclude()` on entities like `User.passwordHash` is enforced),
  `AllExceptionsFilter` (uniform `{statusCode, message, path, timestamp}`, no
  leaked stack traces), `ThrottlerGuard` (rate limiting on **every** route by
  default — opt out per-route with `@SkipThrottle()`, override with
  `@Throttle({ default: { limit, ttl } })`; see `src/core/throttler/README.MD`).
- **Transactions**: `@Transactional()` from `typeorm-transactional`; context is
  initialized once in `main.ts` (`initializeTransactionalContext`) and the
  transactional data source is wired in `DatabaseModule`.
- **Entities**: any `*.entity.ts` under `src/` auto-loads into TypeORM.
  `POSTGRES_SYNCHRONIZE` is `false` by default — schema changes go through
  migrations, not auto-sync.
- **Health checks** (`core/health`) probe DB, heap/RSS memory, and disk space
  (`HEALTH_DISK_PATH` — no cross-platform default; falls back to `C:\` on
  Windows vs `/` on POSIX because `check-disk-space` rejects the wrong style
  of path for the host OS).
- **Auth module** (`src/modules/auth`): registration and login (argon2
  password hashing; optional OTP/magic-link email confirmation for each,
  gated by the runtime auth settings — see **Settings** below), `refresh`,
  `logout`. `isEmailVerified` records only an actual consumed registration
  code: registration always stores `false`, and login checks the *current*
  `registrationConfirmationRequired` — off: unverified users log in; on: login
  issues a REGISTER code and returns `{ requiresConfirmation, purpose:
  'register', method, email }` instead of tokens (never a 403). Login
  confirmation (`purpose: 'login'`) is a separate per-login second factor.
  `AuthService` reads the settings and passes the method to
  `EmailVerificationService`; `core/email-verification` falls back to env
  only for callers that pass none (email change, account deletion). JWTs travel
  in httpOnly cookies (`access_token`, `refresh_token`), with an
  `Authorization: Bearer` fallback (`core/auth/jwt-extractors.ts`);
  `JwtAuthGuard` (`core/auth`) is a global `APP_GUARD` (opt out with
  `@Public()`). The `'jwt'` passport strategy it uses, `JwtStrategy`, is
  registered by `AuthModule` (`modules/auth/strategies/`) because it checks
  the user's current state. `core/auth` itself must not import from
  `modules/` (`TokenService` takes a structural `TokenSubject`, not `User`).
- **RBAC** (`src/modules/rbac`): roles/permissions/grants stored in the DB,
  managed via `/admin/rbac/*`; routes are protected with `PermissionsGuard` +
  `@RequirePermission(resource, action)`, or `SelfOrPermissionGuard` +
  `@SelfOrPermission(...)` for `/users/:id`-style routes. These live in
  `modules/rbac/access/`; other modules import them from the `@/modules/rbac`
  barrel (`index.ts`), not deep paths. `SelfOnlyGuard` has no RBAC dependency
  and lives in `core/auth/`. Dependencies point one way — feature modules →
  `rbac` → `core` — so don't put RBAC-dependent code in `core/`.
- **Settings** (`src/modules/settings`): admin-managed runtime settings in a
  key/value `settings` table (`jsonb` value), exposed at
  `GET`/`PATCH /admin/settings/auth` (`settings:read`/`settings:update`,
  granted to `admin` by migration). Currently the four registration/login
  confirmation settings, defined in `auth-settings.registry.ts` with their env
  fallbacks. Effective value = DB row if present, else env, else registry
  default; a row overrides env even when `false`, and `PATCH` with `null`
  deletes the row to fall back to env. Invalid stored values throw rather than
  silently falling back. Other modules call `AuthSettingsService`; `core/`
  must not (pass the resolved value down instead).
- **Swagger**: served at `SWAGGER_PATH` (`APP_NAME`/`API_VERSION` from
  config), bearer auth scheme already declared even though no route enforces
  it yet.

## Testing

- Vitest, not Jest (migrated off Jest early on). `**/*.spec.ts` = unit
  (`vitest.config.ts`), `**/*.e2e-spec.ts` = e2e (`vitest.config.e2e.ts`).
  `globals: true`, so `describe`/`it`/`expect` need no import.
- `test/app.e2e-spec.ts` is inherited `nest new` boilerplate for an Express
  `GET /` route that doesn't exist on this Fastify app — known-broken, not a
  regression if it fails.
- e2e tests run against the **same database as the dev server**
  (`POSTGRES_DB`), so leftover `settings` rows from manual testing (e.g.
  `loginConfirmationRequired = true`) change login behaviour and make auth/rbac
  e2e fail — check the `settings` table before treating that as a regression.
- Target coverage is ≥80% (`npm run test:cov`), not yet enforced in CI.

## Commit style

Conventional Commits, lowercase, imperative, no trailing period, scoped to
the touched module/area under `src/modules/*` or `src/core/*` (e.g.
`feat(auth): ...`, `fix(config): ...`); omit the scope for cross-cutting or
pure setup/infra changes. Use the `commit` skill/slash command rather than
improvising — it captures the full convention. Never add a `Co-Authored-By`
trailer to commits in this repo.
