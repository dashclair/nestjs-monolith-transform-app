import 'reflect-metadata';
import 'dotenv/config';

import { isReservedEmail } from '@/common/validation/is-reserved-email';
import dataSource from '@/database/data-source';
import { PasswordService } from '@/modules/auth/services/password.service';

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are not set in .env');
  }

  if (isReservedEmail(email)) {
    throw new Error('Email domain is reserved');
  }

  await dataSource.initialize();

  const adminRoleRows = await dataSource.query(`SELECT id FROM "roles" WHERE name = 'admin'`);
  if (adminRoleRows.length === 0) {
    throw new Error('Role "admin" not found — run migrations first (npm run migration:run)');
  }
  const adminRoleId = adminRoleRows[0].id;

  const existingUserRows = await dataSource.query(
    `SELECT id FROM "users" WHERE email = $1`,
    [email],
  );

  let userId: string;
  if (existingUserRows.length === 0) {
    const passwordHash = await new PasswordService().hash(password);
    const inserted = await dataSource.query(
      `INSERT INTO "users" (email, "passwordHash", "isEmailVerified") VALUES ($1, $2, true) RETURNING id`,
      [email, passwordHash],
    );
    userId = inserted[0].id;
    console.log(`Created user ${email}`);
  } else {
    userId = existingUserRows[0].id;
  }

  const existingAssignment = await dataSource.query(
    `SELECT 1 FROM "user_roles" WHERE "userId" = $1 AND "roleId" = $2`,
    [userId, adminRoleId],
  );
  if (existingAssignment.length === 0) {
    await dataSource.query(
      `INSERT INTO "user_roles" ("userId", "roleId") VALUES ($1, $2)`,
      [userId, adminRoleId],
    );
    console.log(`Assigned role "admin" to ${email}`);
  } else {
    console.log(`${email} already has role "admin" — nothing to do`);
  }

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
