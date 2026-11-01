import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1793536800000 implements MigrationInterface {
  name = 'CreateVideos1793536800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'uploading', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_id" uuid NOT NULL,
        "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft',
        "idempotency_key" character varying(255) NOT NULL,
        "source_object_key" character varying(512) NOT NULL,
        "multipart_upload_id" character varying(255),
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(127) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "duration_seconds" numeric,
        "metadata" jsonb,
        "thumbnail_object_key" character varying(512),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_videos" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_videos_size_bytes" CHECK ("size_bytes" >= 1 AND "size_bytes" <= 10000000000),
        CONSTRAINT "FK_videos_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_videos_owner_idempotency_key" ON "videos" ("owner_id", "idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_videos_source_object_key" ON "videos" ("source_object_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_owner_status" ON "videos" ("owner_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_owner_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_videos_source_object_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_videos_owner_idempotency_key"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
