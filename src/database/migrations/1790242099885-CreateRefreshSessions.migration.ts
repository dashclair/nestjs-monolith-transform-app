import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshSessions1790242099885 implements MigrationInterface {
  name = 'CreateRefreshSessions1790242099885';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_sessions" ("id" uuid NOT NULL, "userId" uuid NOT NULL, "tokenHash" character(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "replacedById" uuid, "userAgent" character varying, "ip" character varying(45), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9190032f6967b7971dca07d69f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78744bff965517952df6c02da7" ON "refresh_sessions" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c796760dda3a0b63caf2fdad0" ON "refresh_sessions" ("expiresAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_sessions" ADD CONSTRAINT "FK_78744bff965517952df6c02da76" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_sessions" ADD CONSTRAINT "FK_bb2903d7b94c49d27cb678f368f" FOREIGN KEY ("replacedById") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_sessions" DROP CONSTRAINT "FK_bb2903d7b94c49d27cb678f368f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_sessions" DROP CONSTRAINT "FK_78744bff965517952df6c02da76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c796760dda3a0b63caf2fdad0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78744bff965517952df6c02da7"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_sessions"`);
  }
}
