import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhotoToUsers1789651581610 implements MigrationInterface {
  name = 'AddPhotoToUsers1789651581610';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "photo" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "photo"`);
  }
}
