import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTransformationsResource1791763200000 implements MigrationInterface {
  name = 'SeedTransformationsResource1791763200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES ('transformations', ARRAY['read','download'])`,
    );
    await queryRunner.query(
      `INSERT INTO "grants" ("roleId", "permissionId", "actions")
       SELECT r.id, p.id, ARRAY['read','download'] FROM "roles" r, "permissions" p
       WHERE r.name = 'admin' AND p.name = 'transformations'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name" = 'transformations'`,
    );
  }
}
