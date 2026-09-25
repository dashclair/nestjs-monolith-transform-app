import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedSettingsResource1790254937084 implements MigrationInterface {
  name = 'SeedSettingsResource1790254937084';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES ('settings', ARRAY['read','update'])`,
    );
    await queryRunner.query(
      `INSERT INTO "grants" ("roleId", "permissionId", "actions")
       SELECT r.id, p.id, ARRAY['read','update'] FROM "roles" r, "permissions" p
       WHERE r.name = 'admin' AND p.name = 'settings'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name" = 'settings'`,
    );
  }
}
