import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransformations1790985600000 implements MigrationInterface {
  name = 'CreateTransformations1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transformations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "sourceFormat" character varying(16),
        "targetFormat" character varying(16),
        "status" character varying(16) NOT NULL,
        "errorCode" character varying(64),
        "fileSize" bigint NOT NULL,
        "durationMs" integer NOT NULL,
        "options" jsonb,
        "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transformations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transformations_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_transformations_user_created_id" ON "transformations" ("userId", "createdAt", "id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "transformations"');
  }
}
