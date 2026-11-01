import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('videos')
@Check(
  'CHK_videos_size_bytes',
  '"size_bytes" >= 1 AND "size_bytes" <= 10000000000',
)
@Index('UQ_videos_owner_idempotency_key', ['owner_id', 'idempotency_key'], {
  unique: true,
})
@Index('UQ_videos_source_object_key', ['source_object_key'], { unique: true })
@Index('IDX_videos_owner_status', ['owner_id', 'status'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  owner_id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id', foreignKeyConstraintName: 'FK_videos_owner' })
  owner: User;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'videos_status_enum',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  idempotency_key: string;

  @Column({ type: 'varchar', length: 512 })
  source_object_key: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  multipart_upload_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 127 })
  content_type: string;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'bigint' })
  size_bytes: string;

  @Column({ type: 'numeric', nullable: true })
  duration_seconds: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_object_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
