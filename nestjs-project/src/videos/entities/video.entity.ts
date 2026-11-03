import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum VideoVisibility {
  PUBLIC = 'public',
  UNLISTED = 'unlisted',
}

@Entity('videos')
@Index('IDX_videos_channel_id', ['channel_id'])
@Index('IDX_videos_status', ['status'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'videos_status_enum',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar' })
  original_object_key: string;

  @Column({ type: 'varchar', nullable: true })
  multipart_upload_id: string | null;

  // PostgreSQL bigint is surfaced as a string by TypeORM to preserve precision.
  @Column({ type: 'bigint' })
  original_size_bytes: string;

  @Column({ type: 'varchar' })
  original_content_type: string;

  @Column({ type: 'varchar', nullable: true })
  processed_object_key: string | null;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_object_key: string | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({
    type: 'enum',
    enum: VideoVisibility,
    enumName: 'videos_visibility_enum',
    default: VideoVisibility.PUBLIC,
  })
  visibility: VideoVisibility;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
