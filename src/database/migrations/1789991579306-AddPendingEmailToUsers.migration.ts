import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingEmailToUsers1789991579306 implements MigrationInterface {
  name = 'AddPendingEmailToUsers1789991579306';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "pendingEmail" character varying`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9e2186f4821e754700c286969"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."email_verifications_purpose_enum" RENAME TO "email_verifications_purpose_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."email_verifications_purpose_enum" AS ENUM('register', 'login', 'email_change')`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" TYPE "public"."email_verifications_purpose_enum" USING "purpose"::"text"::"public"."email_verifications_purpose_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" SET DEFAULT 'register'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."email_verifications_purpose_enum_old"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9e2186f4821e754700c286969" ON "email_verifications" ("userId", "purpose") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9e2186f4821e754700c286969"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."email_verifications_purpose_enum_old" AS ENUM('register', 'login')`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" TYPE "public"."email_verifications_purpose_enum_old" USING "purpose"::"text"::"public"."email_verifications_purpose_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ALTER COLUMN "purpose" SET DEFAULT 'register'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."email_verifications_purpose_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."email_verifications_purpose_enum_old" RENAME TO "email_verifications_purpose_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9e2186f4821e754700c286969" ON "email_verifications" ("purpose", "userId") `,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pendingEmail"`);
  }
}
