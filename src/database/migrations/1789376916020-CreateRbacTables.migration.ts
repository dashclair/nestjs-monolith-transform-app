import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbacTables1789376916020 implements MigrationInterface {
  name = 'CreateRbacTables1789376916020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "actions" character varying array NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_48ce552495d14eae9b187bb6716" UNIQUE ("name"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "grants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "roleId" uuid NOT NULL, "permissionId" uuid NOT NULL, "actions" character varying array, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a25f5f89eff8b3277f7969b7094" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f3c72eb82c0df496fe860380c3" ON "grants" ("roleId", "permissionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_97768f55378cee5140b026d8140" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_3a08b3fe17aa7245eaafca4007d" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description") VALUES ('admin', 'Full access'), ('user', 'Default role')`,
    );
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions") VALUES ('rbac', ARRAY['create','read','update','delete'])`,
    );
    await queryRunner.query(
      `INSERT INTO "grants" ("roleId", "permissionId")
   SELECT r.id, p.id FROM "roles" r, "permissions" p WHERE r.name = 'admin' AND p.name = 'rbac'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_3a08b3fe17aa7245eaafca4007d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_97768f55378cee5140b026d8140"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3c72eb82c0df496fe860380c3"`,
    );
    await queryRunner.query(`DROP TABLE "grants"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
  }
}
