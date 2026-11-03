import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1793718300000 implements MigrationInterface {
  name = 'CreateVideos1793718300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channel_id" uuid NOT NULL,
        "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft',
        "original_object_key" character varying NOT NULL,
        "multipart_upload_id" character varying,
        "original_size_bytes" bigint NOT NULL,
        "original_content_type" character varying NOT NULL,
        "processed_object_key" character varying,
        "thumbnail_object_key" character varying,
        "duration_seconds" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_videos_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_videos_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
