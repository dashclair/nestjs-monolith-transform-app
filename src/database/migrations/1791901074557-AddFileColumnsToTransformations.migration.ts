import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileColumnsToTransformations1791901074557 implements MigrationInterface {
  name = 'AddFileColumnsToTransformations1791901074557';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transformations" ADD "storageKey" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" ADD "fileStatus" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" ADD "resultFileName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" ADD "resultMimeType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" ADD "resultSize" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transformations" DROP COLUMN "resultSize"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" DROP COLUMN "resultMimeType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" DROP COLUMN "resultFileName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" DROP COLUMN "fileStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformations" DROP COLUMN "storageKey"`,
    );
  }
}
