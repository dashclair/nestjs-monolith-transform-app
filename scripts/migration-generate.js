#!/usr/bin/env node
'use strict';

// Wraps `typeorm migration:generate` and renames the file it produces so it
// matches this project's `*.migration.ts` naming convention (required by the
// `migrations` glob in `src/database/data-source.ts` — a generated file
// TypeORM's CLI never adds that suffix on its own, so without this it would
// silently be skipped by `migration:run`).

const { execFileSync } = require('node:child_process');
const { readdirSync, renameSync } = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '..',
  'src',
  'database',
  'migrations',
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    'Usage: npm run migration:generate -- src/database/migrations/<Name>',
  );
  process.exit(1);
}

const before = new Set(readdirSync(MIGRATIONS_DIR));

let exitCode = 0;
try {
  execFileSync(
    'npm',
    [
      'run',
      'typeorm',
      '--',
      'migration:generate',
      '-d',
      'src/database/data-source.ts',
      ...args,
    ],
    { stdio: 'inherit', shell: true },
  );
} catch (err) {
  exitCode = err.status ?? 1;
}

const created = readdirSync(MIGRATIONS_DIR).filter(
  (file) =>
    !before.has(file) && file.endsWith('.ts') && !file.endsWith('.migration.ts'),
);

for (const file of created) {
  const renamed = file.replace(/\.ts$/, '.migration.ts');
  renameSync(
    path.join(MIGRATIONS_DIR, file),
    path.join(MIGRATIONS_DIR, renamed),
  );
  console.log(`Renamed ${file} -> ${renamed}`);
}

if (created.length === 0) {
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
  console.warn(
    'No new migration file was created — nothing to rename (expected if there were no schema changes).',
  );
}
