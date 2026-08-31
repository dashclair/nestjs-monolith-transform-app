# Throttler Module

Rate limiting is powered by `@nestjs/throttler`. `ThrottlerModule` (this module) only registers the storage and the default limit — the actual enforcement is a global guard registered in [`AppModule`](../app/app.module.ts):

```typescript
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

Because it's a global `APP_GUARD`, **every** route is rate-limited by default, unless explicitly overridden or skipped.

## Default limit

Controlled by env vars, read in [`throttler.module.ts`](./throttler.module.ts):

```env
THROTTLE_GLOBAL_TTL=10000   # window, ms
THROTTLE_GLOBAL_LIMIT=10    # max requests per window per client
```

No `name` is set on the throttler config, so `@nestjs/throttler` uses the implicit name `'default'` — that's the key to use in `@Throttle({ default: { ... } })` overrides below.

## Stricter limits on specific routes

Use `@Throttle()` to override the default limit/ttl for a route or controller. Applied today on [`AuthController`](../../modules/auth/auth.controller.ts) as brute-force protection (the controller only has placeholder `login`/`register` handlers for now — real auth logic lands in a later ticket):

```typescript
@Throttle({ default: { limit: 5, ttl: seconds(60) } })
@Post('login')
login() { ... }

@Throttle({ default: { limit: 3, ttl: seconds(60) } })
@Post('register')
register() { ... }
```

## Excluding a route entirely

Use `@SkipThrottle()` for endpoints that are polled frequently by infrastructure and shouldn't be rate-limited — e.g. [`HealthController`](../health/health.controller.ts), hit repeatedly by liveness/readiness probes:

```typescript
@SkipThrottle()
@Controller('health')
export class HealthController { ... }
```

## Manually verified behavior

- An unannotated route (`GET /test-errors/unknown`) starts returning `429` after `THROTTLE_GLOBAL_LIMIT` (10) requests within `THROTTLE_GLOBAL_TTL` (10s).
- `POST /auth/login` returns `429` after 5 requests/60s; `POST /auth/register` after 3 requests/60s.
- `GET /health` never returns `429` regardless of request volume.
