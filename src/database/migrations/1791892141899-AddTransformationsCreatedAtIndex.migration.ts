import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransformationsCreatedAtIndex1791892141899 implements MigrationInterface {
  name = 'AddTransformationsCreatedAtIndex1791892141899';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_transformations_created_at" ON "transformations" ("createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_transformations_created_at"`,
    );
  }
}
