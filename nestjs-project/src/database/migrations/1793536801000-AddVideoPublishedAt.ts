import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoPublishedAt1793536801000 implements MigrationInterface {
  name = 'AddVideoPublishedAt1793536801000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "published_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "published_at"`);
  }
}
