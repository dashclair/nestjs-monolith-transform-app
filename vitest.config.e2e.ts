import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
    // Vitest sets NODE_ENV=test by default, but the app's Joi config schema
    // only allows 'development'/'production' (see config.validation.ts) —
    // without this, any e2e test that boots the full AppModule (which loads
    // ConfigModule) fails before it even reaches the test body.
    env: {
      NODE_ENV: 'development',
      // Migrations are loaded from disk via TypeORM's own dynamic
      // require()/import() (data-source's `migrations: [glob]`), which
      // bypasses Vitest's module transform and fails trying to parse raw
      // .migration.ts source. e2e tests assume the schema is already
      // migrated (run `npm run migration:run` beforehand), so skip the
      // auto-run entirely here instead of loading migration files at all.
      POSTGRES_MIGRATIONS_RUN: 'false',
    },
  },
});
