---
kind: phase
name: phase-03-video-upload-processing
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-video-upload-processing/context.md: "2026-11-01T12:34:23Z"
  docs/project-plan.md: "2026-10-31T21:46:53Z"
  docs/decisions/technical-decisions-video-upload-processing.md: "2026-11-01T12:31:51Z"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-10-31T21:46:52Z"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-10-31T21:46:52Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-31T21:46:53Z"
  docs/phases/phase-02-auth/context.md: "2026-10-31T21:46:53Z"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-31T21:46:52Z"
  .agents/skills/testing-guide-next-frontend/SKILL.md: "2026-10-31T21:46:52Z"
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Entregar no backend e no worker o armazenamento e upload resiliente de vídeos de até 10GB, pré-cadastro automático como rascunho, processamento e geração de thumbnail, URL única, streaming e download.

---

## Step Implementations

### SI-03.1 — Configurar armazenamento S3 compatível

**Description:** Disponibilizar storage S3 compatível para originais e thumbnails, mantendo o mesmo contrato em desenvolvimento e produção.

**Technical actions:**

1. Adicionar configuração namespaced de storage com validação Joi e variáveis de endpoint, bucket e credenciais (per `video-upload-processing/TD-02` e convenções herdadas da Fase 01).
2. Configurar o serviço RustFS no Docker Compose com hostname `rustfs` e bucket de desenvolvimento (per `video-upload-processing/TD-02`).
3. Criar módulo e adapter de object storage para upload multipart, conclusão, aborto e leitura como stream (per `video-upload-processing/TD-01` e `TD-02`).
4. Registrar o módulo de storage no módulo raiz da API.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| StorageModule | Unit: module compilation | `src/storage/storage.module.spec.ts` |
| S3StorageAdapter | Integration: local S3-compatible operations | `src/storage/s3-storage.adapter.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A API valida a configuração de storage ao iniciar e usa o hostname Compose `rustfs` no ambiente local.
- O adapter inicia, conclui e aborta sessões multipart no storage S3 compatível.
- O adapter fornece leitura do objeto como stream sem carregar o arquivo completo em memória.

---
### SI-03.2 — Configurar fila de processamento

**Description:** Configurar Redis e BullMQ para enfileirar e executar jobs de processamento com retry e encerramento seguro.

**Technical actions:**

1. Adicionar configuração namespaced de Redis com validação Joi e hostname Compose `redis`.
2. Instalar o cliente ioredis compatível com BullMQ 6 e configurar `BullModule` com fila `video-processing`, tentativas e backoff (per `video-upload-processing/TD-03`).
3. Registrar a configuração e a fila no módulo da API e preparar o módulo do worker para consumo.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| QueueModule | Unit: module compilation | `src/queue/queue.module.spec.ts` |
| QueueConfig | Unit: configuration validation | `src/config/queue.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- API e worker conectam ao serviço Redis pelo nome Compose `redis`.
- A fila aceita jobs `process-video` com retry e backoff configurados.
- Encerramento do worker fecha a conexão de fila graciosamente.

---

### SI-03.3 — Pré-cadastrar vídeo e iniciar upload

**Description:** Criar o rascunho idempotente e iniciar uma sessão multipart no começo do upload, sem trafegar os bytes do vídeo pela API.

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated user; video owned by caller
**Technical actions:**

1. Criar entidade `Video`, migration e constraints para identidade, estado, proprietário e chave de idempotência (per `### Data Model` e `video-upload-processing/TD-05`).
2. Criar DTO e validação para `fileName`, `contentType` e `sizeBytes` com limite de 10000000000 bytes.
3. Implementar serviço para criar ou recuperar o rascunho por `(owner_id, idempotency_key)` e iniciar multipart no adapter S3 (per `video-upload-processing/TD-01`, `TD-02`, `TD-05`).
4. Mapear conflitos de chave e falhas S3 para os erros definidos em `### Error Catalog`.
5. Expor `POST /videos` e registrar `VideosModule` na API.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video | Integration: constraints and defaults | `src/videos/entities/video.entity.integration-spec.ts` |
| VideosService | Unit: idempotency and branch logic | `src/videos/videos.service.spec.ts` |
| VideosService | Integration: persistence and storage adapter | `src/videos/videos.service.integration-spec.ts` |
| VideosController | E2E: authenticated HTTP contract and error responses | `test/videos-create.e2e-spec.ts` |


**Dependencies:** SI-03.1 — draft creation starts a multipart session through storage

**Acceptance criteria:**

- `POST /videos` with valid metadata and an `Idempotency-Key` returns 201 with a unique `videoId`, `draft` status, and multipart session descriptor.
- Repeating the same owner/key and request returns the existing draft without creating a duplicate video or multipart session.
- Reusing the same owner/key with different metadata returns 409 with `error: IDEMPOTENCY_CONFLICT`.
- A request larger than 10000000000 bytes returns 413 with `error: VIDEO_TOO_LARGE`.
- The persisted draft is private to its owner and a recoverable storage failure does not create a duplicate on retry.

---

### SI-03.4 — Concluir e recuperar sessões multipart

**Description:** Permitir obter URLs de partes, concluir ou abortar o multipart com validação de propriedade e enfileiramento idempotente.

**Route:** POST /videos/{videoId}/upload-parts, POST /videos/{videoId}/complete-upload, DELETE /videos/{videoId}/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-session.plan.md`
**Authorization:** Owner only
**Technical actions:**

1. Implementar emissão de URLs assinadas para as partes solicitadas de um upload ativo.
2. Validar partes e ETags e concluir a sessão multipart no storage (per `video-upload-processing/TD-01`).
3. Atualizar estado para `processing` e publicar job `process-video` com chave estável após a conclusão (per `video-upload-processing/TD-03`, `TD-05`).
4. Implementar aborto idempotente do multipart e preservar estado recuperável do rascunho (per `video-upload-processing/TD-05`).
5. Expor as três rotas e mapear erros de propriedade, sessão e storage conforme `### Authorization Matrix` e `### Error Catalog`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| UploadSessionService | Unit: ownership, validation, and idempotency | `src/videos/upload-session.service.spec.ts` |
| UploadSessionService | Integration: multipart storage and job publication | `src/videos/upload-session.service.integration-spec.ts` |
| Video multipart routes | E2E: owner authorization, completion recovery, abort, error contract | `test/videos-upload-parts.e2e-spec.ts` |


**Dependencies:** SI-03.1 — storage adapter; SI-03.2 — processing queue; SI-03.3 — persisted draft and owner

**Acceptance criteria:**

- Owner request to `POST /videos/{videoId}/upload-parts` returns signed URLs only for requested parts of an active session.
- Non-owner multipart requests return 403 with `error: VIDEO_NOT_OWNED`.
- `POST /videos/{videoId}/complete-upload` validates parts, completes storage, returns 202, and changes the video to `processing`.
- Repeated completion does not enqueue duplicate effective processing or corrupt the video state.
- `DELETE /videos/{videoId}/upload` aborts the multipart session and returns 204; repeating the abort remains safe.

---

### SI-03.5 — Processar vídeos e gerar thumbnails

**Description:** Consumir jobs de upload concluído, extrair dados técnicos e gerar thumbnail de forma idempotente.

**Technical actions:**

1. Criar processo worker NestJS separado que consome a fila `video-processing` no Redis (per `video-upload-processing/TD-03`).
2. Implementar processor idempotente para carregar o vídeo do storage, extrair duração e metadados com FFmpeg e tratar retry/backoff.
3. Gerar thumbnail de um frame, armazenar no bucket e persistir `thumbnail_object_key` (per `video-upload-processing/TD-02`, `TD-03`).
4. Persistir metadados e transições para `ready` ou `failed` com registro seguro de falha.
5. Configurar encerramento gracioso do worker e garantir builds incluam os artefatos runtime necessários.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideoProcessor | Unit: idempotency and processing outcomes | `src/video-worker/video.processor.spec.ts` |
| VideoProcessor | Integration: FFmpeg and local S3-compatible storage | `src/video-worker/video.processor.integration-spec.ts` |
| VideoWorkerModule | Unit: module compilation | `src/video-worker/video-worker.module.spec.ts` |

**Dependencies:** SI-03.1 — object storage; SI-03.2 — BullMQ queue; SI-03.4 — completed upload publishes processing job

**Acceptance criteria:**

- A `process-video` job with an existing completed source extracts duration and metadata and stores a thumbnail derived from a frame.
- Re-delivery of the same job does not duplicate the thumbnail or repeat completed state transitions.
- Successful processing persists metadata and changes the video status to `ready`.
- Unrecoverable processing failure changes the video status to `failed` and records a safe failure outcome.

---

### SI-03.6 — Entregar streaming e download do original

**Description:** Entregar vídeos prontos por streaming progressivo com suporte a byte ranges e como download, sem buffering integral na API.

**Route:** GET /videos/{videoId}/stream, GET /videos/{videoId}/download
**Test Specs:** see `nestjs-project/specs/videos-delivery.plan.md`
**Authorization:** Anonymous/authenticated for published ready videos; owner for own ready video
**Technical actions:**

1. Implementar acesso a stream de objetos e metadados de range pelo adapter de storage.
2. Servir resposta `200` ou `206` com `Content-Range` e headers de conteúdo adequados sem buffer integral.
3. Servir download original com `Content-Disposition` sem expor objetos de drafts ou vídeos não prontos.
4. Expor as rotas e traduzir falhas de range/storage para `### Error Catalog`.
5. Adicionar `published_at` nullable à entidade `Video` por migration para distinguir vídeos prontos publicados; o fluxo de publicação permanece na Fase 04.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideoDeliveryService | Unit: range and access rules | `src/videos/video-delivery.service.spec.ts` |
| VideoDeliveryService | Integration: storage stream and range contract | `src/videos/video-delivery.service.integration-spec.ts` |
| Video delivery routes | E2E: streaming, ranges, visibility, download and errors | `test/videos-delivery.e2e-spec.ts` |

**Dependencies:** SI-03.1 — storage streaming adapter; SI-03.3 — persisted video identity; SI-03.5 — ready state and original processing status

**Acceptance criteria:**

- `GET /videos/{videoId}/stream` returns 200 and streams a ready published original when no `Range` is sent.
- A valid `Range` returns 206 with matching `Content-Range` and only the requested bytes.
- An invalid range returns 416 with `error: RANGE_NOT_SATISFIABLE`.
- Anonymous callers cannot access drafts, processing videos, failed videos, or unpublished ready videos.
- `GET /videos/{videoId}/download` returns an attachment stream for an authorized ready video without buffering the complete object in the API.


## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated; stable unique public identity |
| owner_id | uuid | FK to User; not null |
| status | enum | draft, uploading, processing, ready, failed |
| idempotency_key | varchar | scoped to owner; unique for request deduplication |
| source_object_key | varchar | unique storage key for original upload |
| multipart_upload_id | varchar | nullable while no active S3 multipart session exists |
| file_name | varchar | not null |
| content_type | varchar | validated video media type |
| published_at | timestamptz | nullable; set by the publication flow in Phase 04 |
| size_bytes | bigint | positive; maximum 10000000000 |
| duration_seconds | numeric | nullable until processing succeeds |
| metadata | jsonb | nullable extracted technical metadata |
| thumbnail_object_key | varchar | nullable until thumbnail generation succeeds |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | updated on state transitions |

**Relations:** `Video` belongs to `User` (many-to-one).
**Indexes:** unique on `id`; unique on `source_object_key`; unique on `(owner_id, idempotency_key)`; index on `(owner_id, status)`.

Physical naming and exact enum representation are resolved in implementation while preserving these constraints and states. Schema changes use TypeORM migrations; `synchronize` remains disabled.
### API Contracts

#### POST /videos (SI-03.3)

**Request headers:**
- Authorization: Bearer token
- Idempotency-Key: required opaque key
- Content-Type: application/json

**Request body:**
- fileName: string, required
- contentType: string, required, supported video media type
- sizeBytes: integer, required, 1 to 10000000000 inclusive

**Response 201:**
- videoId: string (uuid)
- status: draft
- upload: multipart session descriptor

**Error responses:**
- 400 INVALID_UPLOAD_REQUEST: invalid metadata or missing idempotency key
- 401 UNAUTHORIZED: missing or invalid credentials
- 409 IDEMPOTENCY_CONFLICT: same key reused with different request data
- 413 VIDEO_TOO_LARGE: sizeBytes exceeds 10000000000
- 503 STORAGE_UNAVAILABLE: storage session could not be created

---

#### POST /videos/{videoId}/upload-parts (SI-03.4)

**Request headers:**
- Authorization: Bearer token

**Request body:**
- partNumbers: integer[], required, valid multipart part numbers

**Response 200:** signed upload URLs keyed by part number.

**Error responses:**
- 401 UNAUTHORIZED
- 403 VIDEO_NOT_OWNED
- 404 VIDEO_NOT_FOUND
- 409 UPLOAD_NOT_ACTIVE
- 503 STORAGE_UNAVAILABLE

---

#### POST /videos/{videoId}/complete-upload (SI-03.4)

**Request headers:**
- Authorization: Bearer token

**Request body:**
- parts: array of partNumber and ETag pairs, required

**Response 202:** video status `processing`.

**Error responses:**
- 401 UNAUTHORIZED
- 403 VIDEO_NOT_OWNED
- 404 VIDEO_NOT_FOUND
- 409 UPLOAD_NOT_ACTIVE
- 400 INVALID_UPLOAD_PARTS
- 503 STORAGE_UNAVAILABLE

---

#### DELETE /videos/{videoId}/upload (SI-03.4)

**Request headers:**
- Authorization: Bearer token

**Response 204:** no content; multipart session is aborted and draft remains recoverable.

**Error responses:**
- 401 UNAUTHORIZED
- 403 VIDEO_NOT_OWNED
- 404 VIDEO_NOT_FOUND

---

#### GET /videos/{videoId}/stream (SI-03.6)

**Request headers:**
- Range: optional byte range

**Response 200:** original video stream when no range is requested.
**Response 206:** partial content stream with `Content-Range` when a valid range is requested.

**Error responses:**
- 404 VIDEO_NOT_FOUND: video is not available to caller
- 416 RANGE_NOT_SATISFIABLE: requested range is invalid
- 503 STORAGE_UNAVAILABLE

---

#### GET /videos/{videoId}/download (SI-03.6)

**Response 200:** original video stream as attachment with `Content-Disposition`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: video is not available to caller
- 503 STORAGE_UNAVAILABLE


### Authorization Matrix

| Endpoint / resource | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ | ✓ |
| POST /videos/{videoId}/upload-parts | ✗ | ✗ | ✓ |
| POST /videos/{videoId}/complete-upload | ✗ | ✗ | ✓ |
| DELETE /videos/{videoId}/upload | ✗ | ✗ | ✓ |
| GET /videos/{videoId}/stream | Published ready video | Published ready video | Own ready video |
| GET /videos/{videoId}/download | Published ready video | Published ready video | Own ready video |

Draft, uploading, processing, and failed videos remain private to their owner. Publication controls remain in Phase 04.


### Error Catalog

| error | HTTP | Trigger |
|-------|------|---------|
| INVALID_UPLOAD_REQUEST | 400 | Request metadata or idempotency key is invalid |
| INVALID_UPLOAD_PARTS | 400 | Multipart completion parts are malformed or incomplete |
| UNAUTHORIZED | 401 | Credentials are absent or invalid |
| VIDEO_NOT_OWNED | 403 | Caller attempts to operate another owner's upload |
| VIDEO_NOT_FOUND | 404 | Video is absent or unavailable to caller |
| VIDEO_TOO_LARGE | 413 | Requested video exceeds 10000000000 bytes |
| RANGE_NOT_SATISFIABLE | 416 | Requested byte range cannot be served |
| IDEMPOTENCY_CONFLICT | 409 | An idempotency key is reused with different request data |
| UPLOAD_NOT_ACTIVE | 409 | Multipart operation is requested outside an active upload |
| STORAGE_UNAVAILABLE | 503 | Object storage operation cannot be completed |
| PROCESSING_QUEUE_UNAVAILABLE | 503 | Completed video could not be published to the processing queue; retry completion |

HTTP error bodies use the inherited shape `{ statusCode, error, message }`; `error` carries the stable code above.


### Events/Messages

#### process-video

**Payload:**

```json
{ "videoId": "uuid", "sourceObjectKey": "string" }
```

**Producer:** `UploadSessionService` (per `video-upload-processing/TD-03`, after upload completion)
**Consumer:** `VideoProcessingWorker` (per `video-upload-processing/TD-03`)
**Trigger:** multipart upload completes and the source object is committed.
**Delivery semantics:** at-least-once; processing is idempotent and retries use backoff.

The worker extracts duration and technical metadata, generates a thumbnail from a video frame, stores it, and updates the video to `ready`; unrecoverable processing errors move it to `failed`.

---

## Dependency Map

SI-03.1 (root — S3-compatible storage)
├── SI-03.3 — depends on SI-03.1 (draft creation starts a multipart session)
├── SI-03.4 — depends on SI-03.1 + SI-03.2 + SI-03.3 (complete upload and enqueue processing)
├── SI-03.5 — depends on SI-03.1 + SI-03.2 + SI-03.4 (worker consumes completed upload)
└── SI-03.6 — depends on SI-03.1 + SI-03.3 + SI-03.5 (deliver original after processing)

SI-03.2 (root — Redis/BullMQ; prerequisite for SI-03.4 and SI-03.5)

---

## Deliverables

- [x] SI-03.1 — Configurar armazenamento S3 compatível
- [x] SI-03.2 — Configurar fila de processamento
- [x] SI-03.3 — Pré-cadastrar vídeo e iniciar upload
- [x] SI-03.4 — Concluir e recuperar sessões multipart
- [x] SI-03.5 — Processar vídeos e gerar thumbnails
- [x] SI-03.6 — Entregar streaming e download do original

**Full test suites:**

- [x] Backend tests pass (37 suites, 188 tests)
- [x] E2E tests pass (6 suites, 65 tests)
- [x] Type/compilation checks pass (`npx tsc --noEmit`)
- [x] Lint passes (`npm run lint`)
- [x] Project builds successfully (`npm run build`)

Este plano cobre a API NestJS e o worker. O cliente de upload e a UI serão planejados após a inicialização de `next-frontend` e do inventário de telas.
