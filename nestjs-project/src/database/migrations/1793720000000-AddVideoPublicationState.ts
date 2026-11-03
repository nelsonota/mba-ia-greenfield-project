import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoPublicationState1793720000000 implements MigrationInterface {
  name = 'AddVideoPublicationState1793720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_visibility_enum" AS ENUM('public', 'unlisted')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "visibility" "public"."videos_visibility_enum" NOT NULL DEFAULT 'public'`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "published_at" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "published_at"`);
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "visibility"`);
    await queryRunner.query(`DROP TYPE "public"."videos_visibility_enum"`);
  }
}
