import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLoginFieldsAndVerificationPurpose1788981276699 implements MigrationInterface {
    name = 'AddLoginFieldsAndVerificationPurpose1788981276699'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_4e63a91e0a684b31496bd50733"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "failedLoginAttempts" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "lockedUntil" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "tokenVersion" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE TYPE "public"."email_verifications_purpose_enum" AS ENUM('register', 'login')`);
        await queryRunner.query(`ALTER TABLE "email_verifications" ADD "purpose" "public"."email_verifications_purpose_enum" NOT NULL DEFAULT 'register'`);
        await queryRunner.query(`CREATE INDEX "IDX_c9e2186f4821e754700c286969" ON "email_verifications" ("userId", "purpose") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c9e2186f4821e754700c286969"`);
        await queryRunner.query(`ALTER TABLE "email_verifications" DROP COLUMN "purpose"`);
        await queryRunner.query(`DROP TYPE "public"."email_verifications_purpose_enum"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tokenVersion"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lockedUntil"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "failedLoginAttempts"`);
        await queryRunner.query(`CREATE INDEX "IDX_4e63a91e0a684b31496bd50733" ON "email_verifications" ("userId") `);
    }

}
