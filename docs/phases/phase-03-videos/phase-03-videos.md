---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-03T11:03:47.2186432-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-03T11:03:31.4144071-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-03T11:03:12.6118303-03:00"
  docs/project-plan.md: "2026-11-03T08:50:39.6170960-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-03T08:50:39.6145915-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-03T08:50:39.6084451-03:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-03T08:50:39.3668427-03:00"
  .agents/skills/testing-guide-next-frontend/SKILL.md: "2026-11-03T08:50:39.3773546-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver upload drafts for videos up to 10 GB, asynchronous processing and thumbnail generation, collision-free video identities, range-capable playback, and original-file download.

---

## Step Implementations

### SI-03.1 — Persistir o rascunho de vídeo

**Description:** Criar o modelo persistente de vídeo para registrar identidade, propriedade, estado do upload e saídas de processamento.

**Technical actions:**

1. Criar `videos/entities/video.entity.ts` com os campos, nulabilidade, relações e índices da especificação Data Model (per `phase-03-videos/TD-05`).
2. Criar migration PostgreSQL para a tabela `videos`, enum de status e índice por `channel_id` e `status`.
3. Declarar a relação bidirecional `Channel`-`Video`, com FK `channel_id` no lado dono `Video`.
4. Criar `VideosModule` e registrar `Video` via `TypeOrmModule.forFeature()`.
5. Incluir `Video` no helper compartilhado de datasource/limpeza de testes e na lista explícita de migrations de teste.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, relations | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Integration: database DI and repository registration | `src/videos/videos.module.integration-spec.ts` |
| Video migration | Integration: migration apply/rollback registry | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Uma linha `Video` aceita UUID, canal existente e status `draft`, `processing`, `ready` ou `failed`.
- A criação de rascunho aplica `created_at` e `updated_at` e rejeita relação com canal inexistente.
- Consultas por canal e status podem usar os índices definidos.

---

### SI-03.2 — Implementar o adaptador de armazenamento S3

**Description:** Disponibilizar operações S3 compatíveis para multipart upload, objetos e URLs assinadas sem expor URLs públicas persistentes.

**Technical actions:**

1. Criar configuração tipada e validada para endpoint interno Docker e endpoint público de URLs assinadas, região, bucket e credenciais, usando o contrato de configuração herdado da fase 01 (per `phase-03-videos/TD-02`).
2. Criar `videos/storage/video-storage.service.ts` com iniciar, assinar partes, completar, abortar, leitura com Range, gravação multipart de streams e URLs assinadas.
3. Mapear falhas do provedor para erro de domínio `STORAGE_UNAVAILABLE` conforme Error Catalog.
4. Registrar o adaptador no `VideosModule` e adicionar MinIO local, bucket `streamtube-videos` e CORS para PUT/GET expondo ETag no Compose.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoStorageService` | Integration: multipart lifecycle, signed URLs, streamed writes, range reads and provider failures | `src/videos/storage/video-storage.service.integration-spec.ts` |
| `VideosModule` | Integration: storage provider/config registration | `src/videos/videos.module.integration-spec.ts` |
| `storageConfig` | Unit: typed config values and endpoint separation | `src/config/storage.config.spec.ts` |

**Dependencies:** SI-03.1 — o serviço de vídeo referencia as chaves persistidas.

**Acceptance criteria:**

- A inicialização de multipart retorna um upload ID sem enviar bytes do arquivo pela API.
- URLs assinadas expiram, usam o endpoint acessível pelo navegador e o bucket permite PUT de origem `http://localhost:3001` expondo ETag.
- A conclusão e o abort de multipart atuam sobre a mesma chave opaca iniciada.
- A leitura do objeto permite entrega de bytes por faixa, gravações em stream usam multipart e falhas do storage retornam `503 STORAGE_UNAVAILABLE`.

---

### SI-03.3 — Criar rascunho e emitir URLs das partes

**Description:** Iniciar uploads autenticados criando o vídeo `draft` antes do envio dos bytes e autorizando partes limitadas do multipart.

**Route:** POST /videos/uploads; POST /videos/:videoId/upload-parts

**Authorization:** autenticado para início; proprietário do canal para emissão de partes, conforme Authorization Matrix.

**Test Specs:** see `nestjs-project/specs/videos-upload-init.plan.md`

**Technical actions:**

1. Criar DTOs de início e solicitação de partes; validar `originalFilename`, `contentType`, `sizeBytes` até 10 GB e números de parte (per `phase-03-videos/TD-01`).
2. Criar `VideoUploadService.startUpload()` persistindo rascunho, chave opaca e multipart ID antes de retornar o contrato `201` (per `phase-03-videos/TD-02`, `TD-05`).
3. Implementar emissão de URLs curtas por parte e verificação de propriedade do canal.
4. Criar controller para os dois endpoints e registrar rotas no `VideosModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadService` | Unit: persistence, part bounds and ownership branches | `src/videos/video-upload.service.spec.ts` |

**Dependencies:** SI-03.1 + SI-03.2 — requer entidade e adaptador de multipart.

**Acceptance criteria:**

- `POST /videos/uploads` cria primeiro um vídeo `draft` e retorna `201` com `videoId`, `status`, `partSizeBytes` e `partCount`.
- Metadados inválidos ou arquivo acima de 10 GB retornam `400` com `VALIDATION_ERROR`.
- `POST /videos/:videoId/upload-parts` do proprietário retorna URLs de partes com expiração.
- Usuário sem sessão retorna `401 UNAUTHENTICATED`; outro proprietário recebe `403 VIDEO_ACCESS_DENIED`.

---

### SI-03.4 — Finalizar ou abortar o upload

**Description:** Fechar o multipart com reconciliação de ETags, transicionar o vídeo para processamento e permitir abortar uploads abertos.

**Route:** POST /videos/:videoId/complete; DELETE /videos/:videoId/upload

**Authorization:** proprietário do vídeo, conforme Authorization Matrix.

**Test Specs:** see `nestjs-project/specs/videos-upload-finalize.plan.md`

**Technical actions:**

1. Implementar conclusão idempotente e validação dos pares `partNumber`/`eTag` antes de completar o objeto (per `phase-03-videos/TD-01`, `TD-02`).
2. Transicionar o vídeo de `draft` para `processing` somente após confirmação do objeto original.
3. Implementar abort do multipart e limpeza do estado de upload.
4. Criar endpoints de conclusão e abort com os códigos do Error Catalog.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadService.completeUpload()` | Unit: multipart reconciliation, idempotency and state transition | `src/videos/video-upload.service.spec.ts` |

**Dependencies:** SI-03.3 — somente uploads iniciados podem ser concluídos ou abortados.

**Acceptance criteria:**

- `POST /videos/:videoId/complete` válido retorna `202` com status `processing` após o objeto ficar disponível.
- Partes/ETags rejeitados retornam `400 INVALID_UPLOAD_PARTS`; upload fechado retorna `409 UPLOAD_NOT_IN_PROGRESS`.
- `DELETE /videos/:videoId/upload` do proprietário retorna `204`.
- Conclusão e abort de vídeo de outro canal retornam `403 VIDEO_ACCESS_DENIED`.

---

### SI-03.5 — Configurar fila de processamento

**Description:** Publicar jobs duráveis de processamento e executar consumidores em runtime worker separado com retry e concorrência limitada.

**Technical actions:**

1. Configurar Redis e BullMQ no Nest, com conexão pelo nome de serviço Docker, tentativas e backoff (per `phase-03-videos/TD-03`).
2. Criar producer `process-video` com payload `{ videoId, objectKey }` após a conclusão do upload.
3. Criar entrypoint de worker separado da API e registrar consumidor com concorrência configurável.
4. Atualizar Compose e configuração para incluir Redis e worker independente.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoQueue` | Unit: job payload, stable job identity and retry defaults | `src/videos/queue/video-queue.service.spec.ts` |
| `VideoUploadService.completeUpload()` | Unit: queue handoff after storage/database completion and retry-safe enqueue | `src/videos/video-upload.service.spec.ts` |
| `VideoWorkerModule` | Unit: worker module compilation | `src/video-worker/video-worker.module.spec.ts` |

**Dependencies:** SI-03.4 — o job só é emitido após multipart concluído.

**Acceptance criteria:**

- Upload completo publica job `process-video` com `videoId` e `objectKey` apenas.
- O job é tentado novamente com backoff quando o processamento falha.
- API e worker iniciam como serviços separados e conectam ao Redis pelo hostname do Compose.

---

### SI-03.6 — Processar vídeo e gerar saídas

**Description:** Extrair metadados, gerar thumbnail e MP4 normalizado, preservando o original para download.

**Technical actions:**

1. Criar processor idempotente que baixe o original para área temporária usando `VideoStorageService` (per `phase-03-videos/TD-02`, `TD-03`).
2. Integrar FFmpeg/ffprobe para duração e metadados, gerar thumbnail de frame e transcodificar MP4 H.264/AAC (per `phase-03-videos/TD-04`).
3. Gravar MP4 e thumbnail em chaves opacas e atualizar `processed_object_key`, `thumbnail_object_key`, `duration_seconds` e status.
4. Limpar arquivos temporários e registrar `failed` em falha terminal, preservando dados para retry.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: idempotency, metadata and failure transitions | `src/video-worker/video-processing.service.spec.ts` |
| `VideoProcessingConsumer` | Unit: retry handling and terminal failure transition | `src/video-worker/video-processing.consumer.spec.ts` |
| `VideoTranscoderService` | Integration: FFmpeg/ffprobe generate normalized MP4 and thumbnail | `src/video-worker/video-transcoder.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — o consumidor e a mensagem process-video precisam estar configurados.

**Acceptance criteria:**

- Job válido produz MP4 normalizado, thumbnail e duração persistidos no registro do vídeo.
- Repetir um job concluído não cria saídas duplicadas nem corrompe o status `ready`.
- Falha terminal mantém o original e marca o vídeo como `failed`.

---

### SI-03.7 — Autorizar playback e download

**Description:** Resolver UUIDs públicos para objetos prontos e redirecionar para URLs autorizadas de playback e download.

**Route:** GET /videos/:videoId/playback; GET /videos/:videoId/download

**Authorization:** playback público somente para vídeos publicados e públicos; download somente pelo proprietário.

**Test Specs:** see `nestjs-project/specs/videos-delivery.plan.md`

**Technical actions:**

1. Add publication state to `Video` (`visibility`: public/unlisted, default public; nullable `published_at`) so processing-ready and published are distinct; publication control remains in Phase 04.
2. Criar serviço de entrega que resolva UUID e verifique readiness, publication, visibility and ownership before signing (per `phase-03-videos/TD-02`, `TD-04`, `TD-05`).
3. Retornar redirect de playback para MP4 com suporte a Range no storage e download para original com disposição attachment.
4. Implementar controller e mapear ausência para `VIDEO_NOT_FOUND`, saída indisponível para `VIDEO_NOT_READY` e acesso negado conforme matriz.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoDeliveryService` | Unit: visibility, ownership and ready-state branches | `src/videos/video-delivery.service.spec.ts` |

**Dependencies:** SI-03.6 — playback requer saída normalizada pronta.

**Acceptance criteria:**

- `GET /videos/:videoId/playback` de vídeo público pronto retorna `302` para MP4 assinado que atende Range.
- Playback de UUID inexistente retorna `404 VIDEO_NOT_FOUND`; vídeo sem MP4 retorna `409 VIDEO_NOT_READY`.
- Download do proprietário retorna `302` para o original com disposição attachment; usuário não proprietário não recebe URL assinada.

---

### SI-03.8 — Orquestrar upload multipart no frontend

**Description:** Implementar cliente de upload que cria o rascunho pelo BFF, transfere partes diretamente ao storage e finaliza o upload.

**Technical actions:**

1. Criar helper de upload multipart com divisão em partes, paralelismo limitado, coleta de ETags, retry por parte e progresso.
2. Integrar o helper aos Route Handlers BFF de início, assinatura de partes, conclusão e abort, mantendo os bytes fora do Next (per `phase-03-videos/TD-01`).
3. Implementar cancelamento/erro com chamada de abort quando possível e estados de progresso para consumo pela interface da fase 04.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `multipart-upload` | Unit: chunking, bounded parallelism, retries, progress and abort | `next-frontend/features/videos/multipart-upload.test.ts` |
| Video upload BFF handlers | Integration: MSW proxy contract and errors | `next-frontend/app/api/videos/uploads/__tests__/route.integration.test.ts` |

**Dependencies:** SI-03.4 — consome o contrato de início, partes e conclusão publicado pelo backend.

**Acceptance criteria:**

- O início do fluxo cria um rascunho antes do envio da primeira parte.
- Bytes de partes são enviados pelo navegador diretamente às URLs assinadas, sem atravessar o BFF.
- Falha em uma parte permite retry independente sem reiniciar partes concluídas.
- Cancelamento chama abort e a conclusão só é enviada com ETags de todas as partes.

---

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated; stable public identifier per `phase-03-videos/TD-05` |
| channel_id | uuid | FK to `Channel`; upload owner from authenticated session |
| status | enum | `draft`, `processing`, `ready`, `failed`; a `draft` row is created when upload starts |
| original_object_key | varchar | opaque storage key; assigned at upload start per `phase-03-videos/TD-02` |
| multipart_upload_id | varchar | storage multipart identifier; nullable after completion or abort |
| original_size_bytes | bigint | required; validated against the 10 GB upload limit |
| original_content_type | varchar | required; source media type recorded at upload start |
| processed_object_key | varchar | nullable; normalized MP4 key per `phase-03-videos/TD-04` |
| thumbnail_object_key | varchar | nullable until processing produces a thumbnail |
| duration_seconds | integer | nullable until metadata extraction completes |
| visibility | enum | `public`, `unlisted`; defaults to `public`; unlisted direct-link delivery is a later policy |
| published_at | timestamptz | nullable until the Phase 04 publication flow publishes the video |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | maintained on update |

**Relations:** `Channel` has many `Video` (one-to-many); each video is owned through its channel.
**Indexes:** unique on `id`; index on `channel_id`; index on `status` for worker eligibility and owner listings.

---

### API Contracts

NestJS owns the upload control plane and delivery authorization. The Next.js BFF proxies control-plane requests; browser file bytes go directly to object storage using short-lived presigned URLs (`phase-03-videos/TD-01`).

#### POST /videos/uploads (SI-03.2)

**Request headers:**
- Authorization: authenticated user's access token
- Content-Type: application/json

**Request body:**
- originalFilename: string, required
- contentType: string, required
- sizeBytes: integer, required — positive and no greater than the 10 GB upload limit

**Response 201:**
- videoId: string (uuid)
- status: `draft`
- partSizeBytes: integer
- partCount: integer

**Error responses:**
- 400 VALIDATION_ERROR: invalid metadata or size outside the upload limit
- 401 UNAUTHENTICATED: no valid user session

---

#### POST /videos/:videoId/upload-parts (SI-03.2)

**Request headers:**
- Authorization: authenticated user's access token
- Content-Type: application/json

**Request body:**
- partNumbers: integer[], required — requested part numbers within the multipart upload's bounds

**Response 200:**
- parts: array of `{ partNumber, url, expiresAt }` short-lived presigned upload URLs

**Error responses:**
- 403 VIDEO_ACCESS_DENIED: video is not owned by the authenticated user's channel
- 404 VIDEO_NOT_FOUND: UUID does not resolve to a video
- 409 UPLOAD_NOT_IN_PROGRESS: upload is already completed or aborted
- 400 INVALID_PART_NUMBERS: one or more requested part numbers are out of bounds

---

#### POST /videos/:videoId/complete (SI-03.3)

**Request headers:**
- Authorization: authenticated user's access token
- Content-Type: application/json

**Request body:**
- parts: array of `{ partNumber, eTag }`, required — uploaded part identifiers and storage ETags

**Response 202:**
- videoId: string (uuid)
- status: `processing`

**Error responses:**
- 403 VIDEO_ACCESS_DENIED: video is not owned by the authenticated user's channel
- 404 VIDEO_NOT_FOUND: UUID does not resolve to a video
- 409 UPLOAD_NOT_IN_PROGRESS: upload is already completed or aborted
- 400 INVALID_UPLOAD_PARTS: storage rejects the supplied part numbers or ETags
- 503 STORAGE_UNAVAILABLE: object storage cannot complete the multipart upload

---

#### DELETE /videos/:videoId/upload (SI-03.3)

**Request headers:**
- Authorization: authenticated user's access token

**Response 204:** No content.

**Error responses:**
- 403 VIDEO_ACCESS_DENIED: video is not owned by the authenticated user's channel
- 404 VIDEO_NOT_FOUND: UUID does not resolve to a video
- 503 STORAGE_UNAVAILABLE: object storage cannot abort the multipart upload

---

#### GET /videos/:videoId/playback (SI-03.5)

**Request headers:**
- Range: optional byte range for playback and seeking

**Response 302:** Redirect to a short-lived, authorized object-storage URL for the normalized MP4. The object-storage request supports byte ranges (`phase-03-videos/TD-02`, `TD-04`).

**Error responses:**
- 404 VIDEO_NOT_FOUND: UUID does not resolve to a video
- 409 VIDEO_NOT_READY: no normalized playback object is available

---

#### GET /videos/:videoId/download (SI-03.5)

**Response 302:** Redirect to a short-lived download URL for the original object, with attachment disposition (`phase-03-videos/TD-04`).

**Error responses:**
- 404 VIDEO_NOT_FOUND: UUID does not resolve to a video
- 409 VIDEO_NOT_READY: original object is unavailable

---

### Authorization Matrix

| Operation | Anonymous | Authenticated | Owner |
|-----------|-----------|---------------|-------|
| POST /videos/uploads | ✗ | ✓ | ✓ |
| POST /videos/:videoId/upload-parts | ✗ | ✗ | ✓ |
| POST /videos/:videoId/complete | ✗ | ✗ | ✓ |
| DELETE /videos/:videoId/upload | ✗ | ✗ | ✓ |
| GET /videos/:videoId/playback | ✓ for published, public videos | ✓ for published, public videos | ✓ for own ready videos |
| GET /videos/:videoId/download | ✗ | ✗ | ✓ for own ready videos |

Drafts and processing outputs remain private to the owning channel. Public playback depends on the visibility/publication lifecycle delivered by Phase 04.

---

### Error Catalog

Phase 02's domain error response shape is retained: `{ statusCode, error, message }`.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VALIDATION_ERROR | 400 | Upload metadata or multipart part list fails validation |
| UNAUTHENTICATED | 401 | Upload control request has no valid session |
| VIDEO_ACCESS_DENIED | 403 | User attempts an upload operation on another channel's draft |
| VIDEO_NOT_FOUND | 404 | UUID does not resolve to a video |
| INVALID_PART_NUMBERS | 400 | Presign request includes part numbers outside the active upload range |
| INVALID_UPLOAD_PARTS | 400 | Completion ETags/part numbers fail storage reconciliation |
| UPLOAD_NOT_IN_PROGRESS | 409 | Completion or part-URL request targets a closed upload |
| VIDEO_NOT_READY | 409 | Playback/download requested before required output is available |
| STORAGE_UNAVAILABLE | 503 | Object storage operation fails before completion or abort |

---

### Events/Messages

#### `process-video` (BullMQ job; per `phase-03-videos/TD-03`)

**Payload:**

```json
{ "videoId": "uuid", "objectKey": "opaque-original-object-key" }
```

**Producer:** `VideoUploadService` after successful multipart completion (`phase-03-videos/TD-01`, `TD-03`)
**Consumer:** independent `VideoProcessingWorker` (`phase-03-videos/TD-03`)
**Trigger:** the upload completes and storage confirms the original object is available.
**Delivery semantics:** at-least-once with configured attempts/backoff (`phase-03-videos/TD-03`); processing must tolerate retries and update the video record idempotently.

---

<!-- phase-a-complete -->

## Dependency Map

SI-03.1 (root)
├── SI-03.2 — depende de SI-03.1 (storage adapter persiste chaves associadas ao vídeo)
│   └── SI-03.3 — depende de SI-03.1 + SI-03.2 (cria rascunho e inicia multipart)
│       └── SI-03.4 — depende de SI-03.3 (fecha ou aborta upload existente)
│           └── SI-03.5 — depende de SI-03.4 (publica job após conclusão)
│               └── SI-03.6 — depende de SI-03.5 (worker processa job)
│                   └── SI-03.7 — depende de SI-03.6 (entrega saídas prontas)
└── SI-03.8 — depende de SI-03.4 (cliente usa contratos de upload completos)

---

## Deliverables

- [x] SI-03.1 — Persistir o rascunho de vídeo
- [x] SI-03.2 — Implementar o adaptador de armazenamento S3
- [x] SI-03.3 — Criar rascunho e emitir URLs das partes
- [x] SI-03.4 — Finalizar ou abortar o upload
- [x] SI-03.5 — Configurar fila de processamento
- [x] SI-03.6 — Processar vídeo e gerar saídas
- [x] SI-03.7 — Autorizar playback e download
- [x] SI-03.8 — Orquestrar upload multipart no frontend

**Full test suites:**

- [x] Backend tests pass (`cd nestjs-project && npm test -- --runInBand`) — 34/34 suites, 187/187 tests.
- [x] Backend integration tests pass (included in `npm test -- --runInBand`).
- [x] Backend E2E tests pass (`cd nestjs-project && npm run test:e2e`)
- [x] Backend type/compilation checks pass (`cd nestjs-project && npx tsc --noEmit`)
- [x] Backend builds successfully (`cd nestjs-project && npm run build`)
- [x] Frontend tests pass (`cd next-frontend && npm test`)
- [x] Frontend E2E tests pass (`cd next-frontend && npm run test:e2e` — 9/9 passing)
- [x] Frontend lint passes (`cd next-frontend && npm run lint`)
- [x] Frontend type/compilation checks pass (`cd next-frontend && npx tsc --noEmit`)
- [x] Frontend builds successfully (`cd next-frontend && npm run build`)
