import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUsersResource1789651679589 implements MigrationInterface {
  name = 'SeedUsersResource1789651679589';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES ('users', ARRAY['read','update','delete','list'])`,
    );
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description") VALUES ('support', 'Read-only access to user profiles')`,
    );
    await queryRunner.query(
      `INSERT INTO "grants" ("roleId", "permissionId")
   SELECT r.id, p.id FROM "roles" r, "permissions" p WHERE r.name = 'admin' AND p.name = 'users'`,
    );
    await queryRunner.query(
      `INSERT INTO "grants" ("roleId", "permissionId", "actions")
   SELECT r.id, p.id, ARRAY['read'] FROM "roles" r, "permissions" p WHERE r.name = 'support' AND p.name = 'users'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "grants" WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = 'users')`,
    );
    await queryRunner.query(`DELETE FROM "roles" WHERE "name" = 'support'`);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = 'users'`);
  }
}
