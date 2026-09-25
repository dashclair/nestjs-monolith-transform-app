import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersCursorPaginationSupport1790161735551 implements MigrationInterface {
  name = 'AddUsersCursorPaginationSupport1790161735551';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP(3) WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_603379383366b71239acc25e26" ON "users" ("createdAt", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_603379383366b71239acc25e26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP(6) WITH TIME ZONE`,
    );
  }
}
