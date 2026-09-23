import { seconds } from '@nestjs/throttler';

import { Config } from '@/core/config/config.types';

type NumericConfigKey = {
  [K in keyof Config]-?: NonNullable<Config[K]> extends number ? K : never;
}[keyof Config];

/**
 * Per-route `@Throttle()` values read from config instead of hardcoded.
 *
 * Decorators are evaluated at import time, before DI exists, so the
 * `ConfigService` can't be injected here. Instead each value is a resolver
 * the `ThrottlerGuard` calls per request (`Resolvable<number>` in
 * `@nestjs/throttler`), reading `process.env` lazily. That still yields the
 * Joi-validated value *with its default*: `ConfigModule.forRoot()` writes the
 * validated config back into `process.env` for every key that wasn't already
 * set, so a missing env var resolves to the schema default, not `undefined`.
 */
export const throttleFromConfig = (
  limitKey: NumericConfigKey,
  ttlSecondsKey: NumericConfigKey,
) => ({
  default: {
    limit: () => Number(process.env[limitKey]),
    ttl: () => seconds(Number(process.env[ttlSecondsKey])),
  },
});
