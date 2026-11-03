# phase-03-videos — Progress

**Status:** completed
**SIs:** 8/8 completed

### SI-03.1 — Persistir o rascunho de vídeo
- **Status:** completed
- **Tests:** 7 passing (3 suites; exit code 0)
- **Observations:**
  - Jest reported non-failing PostgreSQL `client.query()` concurrency and Node `--localstorage-file` path warnings.

### SI-03.2 — Implementar o adaptador de armazenamento S3
- **Status:** completed
- **Tests:** 6 passing (3 suites; exit code 0); `npx tsc --noEmit` passed
- **Observations:**
  - Compose uses the Chainguard MinIO server/client images because the official MinIO image registries denied pulls; host port 9002 avoids the existing SonarQube service on 9000, while container traffic uses `minio:9000`.
  - MinIO community does not implement per-bucket CORS; the Compose service applies its supported global CORS origin, and the integration test verifies browser PUT/GET responses allow `http://localhost:3001` and expose ETag.
  - Jest emitted non-failing PostgreSQL `client.query()` concurrency and Node `--localstorage-file` path warnings.

### SI-03.3 — Criar rascunho e emitir URLs das partes
- **Status:** completed
- **Tests:** 13 passing (1 unit suite + 1 E2E suite; exit code 0); `npx tsc --noEmit` passed
- **Observations:**
  - The JWT guard returns the phase Error Catalog code `UNAUTHENTICATED` in its 401 response so the upload route meets the specified contract.
  - E2E teardown aborts open multipart uploads before truncating the database, avoiding leftover test uploads in MinIO.
  - Jest emitted a non-failing Node warning that `--localstorage-file` had no valid path.

### SI-03.4 — Finalizar ou abortar o upload
- **Status:** completed
- **Tests:** 13 unit + 4 E2E passing; `npx tsc --noEmit` passed
- **Observations:**
  - Multipart completion and abort serialize on the video row; the channel owner is loaded separately so PostgreSQL can apply the lock without locking the nullable side of a relation join.
  - Repeated completion returns the existing `processing` result without calling storage again; completion after abort returns `UPLOAD_NOT_IN_PROGRESS`.
  - Queue handoff is reserved for SI-03.5 per the plan decision.
  - Jest emitted the existing non-failing Node `--localstorage-file` path warning.

### SI-03.5 — Configurar fila de processamento
- **Status:** completed
- **Tests:** 17 unit + 4 E2E passing; `npx tsc --noEmit` passed
- **Observations:**
  - Added BullMQ 5.81.5 and `@nestjs/bullmq` 11.0.5 per TD-03; Redis is configured with the Compose hostname `redis` and persistent AOF storage.
  - Successful completion enqueues a stable `process-video` job containing only `videoId` and the opaque original object key. Repeated completion retries the handoff if the earlier Redis operation failed; stable job IDs deduplicate it.
  - Queue defaults use three attempts with exponential backoff and retain recent completed/failed jobs; worker concurrency is configurable with a validated environment setting.
  - The independent worker runtime and consumer are registered. Actual media processing is delivered by SI-03.6; until then the consumer keeps failures retryable and visible in the queue.
  - Jest emitted the existing non-failing Node `--localstorage-file` path warning.

### SI-03.6 — Processar vídeo e gerar saídas
- **Status:** completed
- **Tests:** 7 unit + 1 FFmpeg integration passing; `npx tsc --noEmit` passed
- **Observations:**
  - The worker streams the original object to a per-job temp directory, probes duration, creates a thumbnail, transcodes to H.264/AAC MP4, uploads both outputs, and always removes temporary files.
  - Opaque output keys are reserved in the video row before processing so retries reuse them; ready videos short-circuit duplicate jobs, and only the terminal BullMQ attempt changes processing to failed.
  - The worker image now includes Debian FFmpeg/ffprobe 5.1.9. The integration test generated a sample video and verified duration extraction, thumbnail creation, and MP4 output.
  - Context7’s available Node reference is v25.9.0 while the image uses Node v25.6.0; the implementation uses the stable `spawn` and stream APIs.
  - Jest emitted the existing non-failing Node `--localstorage-file` path warning.

### SI-03.7 — Autorizar playback e download
- **Status:** completed
- **Tests:** 19 unit/integration + 4 E2E passing; `npx tsc --noEmit` passed
- **Observations:**
  - Added `visibility` and nullable `published_at` as publication foundation; publication controls remain assigned to Phase 04.
  - Playback signs the normalized MP4 only when ready and published/public, with owner access to their own unpublished ready video; download signs the original as an attachment for the owner only.
  - The public playback route accepts a valid optional bearer token so owners can preview unpublished videos; invalid optional tokens do not block anonymous public playback.
  - MinIO integration confirmed Range reads; Jest emitted the existing non-failing Node `--localstorage-file` warning.

### SI-03.8 — Orquestrar upload multipart no frontend
- **Status:** completed
- **Tests:** 5 unit + 4 BFF integration passing; full Vitest suite 76/76; `npx tsc --noEmit`, frontend lint and production build passed
- **Observations:**
  - The browser creates the draft through the authenticated BFF, uploads each file slice directly to its presigned URL with bounded concurrency and independent retry, then sends collected ETags for completion.
  - The helper reports successful byte progress and calls the abort BFF endpoint after cancellation or another failure once a draft exists.
  - The local frontend has no `openapi.json` or generated video paths; isolated wire types follow the NestJS DTOs and responses until the OpenAPI contract includes these endpoints.
  - Frontend Playwright E2E passed (9/9) with MSW active. The runner used the container's internal port because the sandbox could not reach Docker's host-mapped port.
  - The Tailwind source scan excludes both project instruction files to prevent their example utility classes from entering generated CSS; the final frontend production build passed after this fix.
  - AuthService integration tests now share one compiled module/DataSource instead of repeatedly synchronizing the same PostgreSQL schema. The shared initialization hook allows 60 seconds; the isolated suite passes 25/25.
  - Final backend verification passed: Jest 34/34 suites and 187/187 tests; E2E 6/6 suites and 65/65 tests; typecheck and production build; repository-wide lint with 0 errors and 0 warnings. Auth E2E startup uses a 60-second setup timeout and guards teardown; the final E2E suite passed.
  - Final frontend verification passed: Vitest 76/76; Playwright 9/9 with MSW; typecheck and production build. Lint exits successfully with one React Compiler warning in `components/auth/signup-form.tsx:71`.
