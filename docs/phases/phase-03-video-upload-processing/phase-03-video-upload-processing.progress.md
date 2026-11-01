# Phase 03 — Upload e Processamento de Vídeos — Progress

**Status:** completed
**SIs:** 6/6 completed

## SI task list

| SI | Summary | Status |
|----|---------|--------|
| SI-03.1 — Configurar armazenamento S3 compatível | S3-compatible storage config, RustFS service, adapter | completed |
| SI-03.2 — Configurar fila de processamento | Redis and BullMQ queue configuration | completed |
| SI-03.3 — Pré-cadastrar vídeo e iniciar upload | Idempotent draft creation and upload initialization | completed |
| SI-03.4 — Concluir e recuperar sessões multipart | Sign parts, complete/abort multipart, enqueue job | completed |
| SI-03.5 — Processar vídeos e gerar thumbnails | Worker processing, metadata, thumbnail and status | completed |
| SI-03.6 — Entregar streaming e download do original | Authorized streaming, range requests and download | completed |

### SI-03.1 — Configurar armazenamento S3 compatível
- **Status:** completed
- **Tests:** `storage/storage.module.spec.ts` passed (1 test); `storage/s3-storage.adapter.integration-spec.ts` passed against RustFS 1.0.4 (2 tests: multipart completion/abort and full/range streaming reads).
- **Observations:** TD-02 uses RustFS locally and managed S3 in production. The AWS SDK client uses `requestChecksumCalculation: 'WHEN_REQUIRED'` so presigned UploadPart requests do not include an empty CRC32 checksum rejected by RustFS. Host ports 9002/9003 were used because 9000/9001 were occupied. `npm ci` reported 80 dependency audit findings (3 critical); remediation is outside this SI.

### SI-03.2 — Configurar fila de processamento
- **Status:** completed
- **Tests:** `config/queue.config.spec.ts` passed (3 tests); `queue/queue.module.spec.ts` passed (1 test) against Redis 7.4.12. `tsc --noEmit` and scoped ESLint passed.
- **Observations:** Installed ioredis 5.11.1, required by BullMQ’s default connection backend. `QueueModule` exports BullMQ providers for reuse by the worker module in SI-03.5; Nest shutdown hooks and queue shutdown handling are enabled. Local host port 6380 was used because the container port maps to 6379.

### SI-03.3 — Pré-cadastrar vídeo e iniciar upload
- **Status:** completed
- **Tests:** Entity integration, VideosService unit and integration tests passed (11 tests); `test/videos-create.e2e-spec.ts` passed (6 tests) against the migrated PostgreSQL database, RustFS, and Redis. `tsc --noEmit` and scoped ESLint passed. The Video migration applied, reverted, and reapplied successfully.
- **Observations:** Concurrent requests with the same owner/key are serialized with a PostgreSQL row lock and create one multipart session. Storage startup failures leave one recoverable draft for a later retry. The API returns the stable error envelope for idempotency conflict, oversized files, and storage outage.

### SI-03.4 — Concluir e recuperar sessões multipart
- **Status:** completed
- **Tests:** `upload-session.service.spec.ts` passed (6 tests); `upload-session.service.integration-spec.ts` passed against PostgreSQL, RustFS, and Redis (1 test); `test/videos-upload-parts.e2e-spec.ts` passed (3 tests) covering owner authorization, invalid parts, queue recovery with stable job ID, and idempotent abort. `tsc --noEmit` and scoped ESLint passed.
- **Observations:** Completion persists `processing` and clears the multipart ID before publishing. A queue outage returns `PROCESSING_QUEUE_UNAVAILABLE`; retry republishes with `videoId` as BullMQ job ID. Part/ETag validation and the HTTP error contract are documented in the phase plan and OpenAPI responses.

### SI-03.5 — Processar vídeos e gerar thumbnails
- **Status:** completed
- **Tests:** `video.processor.spec.ts` passed (4 tests); `video.processor.integration-spec.ts` passed with real FFmpeg and RustFS (1 test); `video-worker.module.spec.ts` passed with a real BullMQ enqueue/consume cycle (1 test). `tsc --noEmit`, scoped ESLint, `npm run build`, and the production worker Docker image build passed.
- **Observations:** The worker runs as a separate Nest application context with graceful shutdown hooks, concurrency 1, and FFmpeg/ffprobe in its runtime image. It downloads the source to a temporary file, stores a stable JPEG thumbnail key, and updates a locked video row to `ready`; exhausted retries store only `VIDEO_PROCESSING_FAILED` as the failure outcome. Compose worker remained running against the named local services after startup verification.

### SI-03.6 — Entregar streaming e download do original
- **Status:** completed
- **Tests:** `video-delivery.service.spec.ts`, `video-delivery.service.integration-spec.ts`, and `jwt-auth.guard.spec.ts` passed (18 tests); `test/videos-delivery.e2e-spec.ts` passed (4 tests); all E2E suites passed (6 suites, 65 tests). Full backend unit/integration suite passed after final fixes (37 suites, 188 tests). `npx tsc --noEmit`, full-project `npm run lint`, migration up/down/up, and `npm run build` passed.
- **Observations:** Added nullable `published_at` for the Phase 04 publication flow, plus streaming/download routes with optional JWT, byte-range support, safe attachment names, and stable 416/503 errors. Updated shared test cleanup to account for the new videos table and foreign key relationships; fixed the migration integration fixture to drop its enum type before recreating it. Final full-project ESLint passes with no warnings.
