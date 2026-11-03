---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-03
scope_description: "Backend and cross-layer technical choices for large video upload, object storage, background processing, streaming, and download."
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — owns video draft/upload lifecycle, storage coordination, processing queue, metadata extraction, thumbnail generation, and delivery authorization.
- `next-frontend/` — provides the upload client and player/download experience; its runtime remains server-side through the established strict BFF, while large file bytes should avoid proxying through Next.

---

## TD-01: Upload protocol and control-plane contract for 10 GB videos

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** A 10 GB request streamed through Nest or the Next BFF consumes network bandwidth and connection capacity on application servers, and retries require restarting the transfer. The browser and backend need a contract that supports resumable parts while retaining backend authorization, draft creation, and upload completion validation.

**Options:**

### Option A: Direct multipart upload to S3-compatible storage
- The backend creates a draft and multipart upload, then returns short-lived presigned URLs for bounded parts. The browser uploads parts directly to object storage and calls the backend to complete or abort the upload.
- **Pros:** App servers do not carry video bytes; failed parts can be retried independently; multipart limits accommodate 10 GB; backend retains ownership of authorization and state transitions.
- **Cons:** Requires CORS and client-side part orchestration; completion must reconcile part numbers/ETags with storage; presigned URLs are bearer credentials until expiry.

### Option B: Resumable upload through the backend using tus
- The browser uploads chunks to a tus endpoint hosted by the backend or a dedicated tus service. The server tracks offsets and forwards data to durable storage.
- **Pros:** Standardized resumability and offset recovery; storage details stay behind the API; consistent upload semantics across object stores.
- **Cons:** The data plane still consumes backend bandwidth unless a separate upload service is deployed; extra protocol service and persistent upload-offset coordination are needed.

### Option C: Single streamed multipart request to the API
- The browser sends one streaming request to Nest, which streams the file to object storage without buffering it wholly in memory.
- **Pros:** Simple client contract and centralized authorization; no per-part URL orchestration.
- **Cons:** A broken connection restarts large transfers; long-lived application connections and bandwidth are still consumed; proxy limits and backpressure become operational constraints.

**Recommendation:** Option A — S3 multipart presigned upload provides independent retries and keeps 10 GB video traffic off both application servers; the Next BFF can remain the only path for control-plane requests while the browser sends bytes directly to storage.

**Decision:** A

---

## TD-02: Video and thumbnail object storage

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Video bytes and generated thumbnails need durable storage, multipart operations, partial reads for playback, and a local development path. The storage interface will affect upload finalization, worker reads/writes, retention, and delivery URLs.

**Options:**

### Option A: S3-compatible object storage abstraction
- Use an S3 API implementation in production and an S3-compatible local service for development. Persist opaque object keys in PostgreSQL and keep bucket credentials in backend/worker configuration.
- **Pros:** Mature multipart upload, object lifecycle and range-read support; supports direct presigned uploads; local and production workflows can share an API contract.
- **Cons:** S3-compatible services can differ in edge behavior; requires storage credentials, bucket policy, CORS, and a local service in Compose.

### Option B: Managed cloud object storage SDK as the application contract
- Integrate directly with one cloud provider's object-storage SDK and provider-specific URL and lifecycle features.
- **Pros:** Access to provider-native operational tooling and features; fewer compatibility assumptions for production.
- **Cons:** Couples the backend and local setup to one provider; local development may not faithfully reproduce provider behavior; migration to another provider costs more.

### Option C: Shared filesystem or Docker volume
- Store uploaded videos and thumbnails on a mounted filesystem exposed to the API and worker.
- **Pros:** Minimal service setup for a single-node prototype; ordinary filesystem tooling works locally.
- **Cons:** Does not provide scalable multi-instance storage or easy direct browser uploads; backup, capacity, and shared-mount operations become application concerns.

**Recommendation:** Option A — The project needs direct multipart upload and streaming/range delivery while preserving a provider-neutral development contract; store object keys rather than public URLs so delivery policy can change independently.

**Decision:** A

---

## TD-03: Background video processing queue and worker runtime

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Metadata extraction and thumbnail generation should not block upload requests. Processing needs retries, concurrency limits, failure visibility, and a durable job reference tied to a draft/video record.

**Options:**

### Option A: BullMQ with Redis
- Enqueue a serializable video ID/object-key job after upload completion. A worker processes it with FFmpeg/ffprobe and updates the video record; job attempts and exponential backoff handle transient failures.
- **Pros:** NestJS has a first-party integration; supports retries, backoff, concurrency and independent worker processes; job payloads can stay small and use durable object keys.
- **Cons:** Adds Redis as an infrastructure dependency; queue state and PostgreSQL video state need idempotent transitions; FFmpeg CPU/memory must be isolated from request handling.

### Option B: PostgreSQL-backed job table with worker polling
- Insert processing jobs in PostgreSQL and let a worker claim them using transactional row locking and polling.
- **Pros:** No additional queue service; job creation can share a database transaction with upload state; operational stack remains PostgreSQL-centered.
- **Cons:** Polling and lock management become project-owned; retry scheduling, visibility, and throughput require more custom code; database contention grows as job volume increases.

### Option C: Managed cloud queue
- Publish processing messages to a provider-managed queue and run one or more independent workers that acknowledge or retry messages.
- **Pros:** Queue durability and scaling are operated by the provider; API and worker deployment can scale independently.
- **Cons:** Adds provider-specific IAM, configuration, and local emulation concerns; less consistent with the currently local Docker-first development environment.

**Recommendation:** Option A — BullMQ aligns with NestJS and supplies the retry/concurrency primitives this processing workload needs, while Redis is a bounded additional service that can run locally and independently of API workers.

**Decision:** A
**Libraries:** @nestjs/bullmq, bullmq

---

## TD-04: Video processing outputs and delivery contract

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The worker produces metadata and a thumbnail, while the viewer needs a stable video URL that begins playback without downloading the full object and supports download. The chosen output format and delivery path shape worker CPU/storage cost, browser support, caching, and access control.

**Options:**

### Option A: Preserve source file; deliver it with HTTP byte-range support
- The worker extracts metadata and a thumbnail but does not transcode the video. Playback and download use the stored original through a range-capable storage/CDN URL or an API streaming route that forwards Range requests.
- **Pros:** Lowest processing latency and compute/storage cost; no quality loss; byte ranges allow progressive seeking and download resumption when the delivery layer supports them.
- **Cons:** Browser playback depends on source codec/container; large or unusual files may not play consistently; no adaptive bitrate renditions.

### Option B: Normalize to one browser-oriented MP4 rendition
- The worker uses FFmpeg to create an H.264/AAC MP4 output plus metadata and thumbnail, and the platform serves that normalized object with byte ranges.
- **Pros:** More predictable browser playback; one output format simplifies the player and delivery path; range delivery still supports early playback and seeking.
- **Cons:** Increases processing time, CPU use, and stored bytes; transcoding can reduce quality or fail on resource constraints; still lacks adaptive bitrate for variable networks.

### Option C: Generate adaptive HLS renditions
- The worker creates a multi-bitrate HLS playlist and segments, and the viewer requests the playlist and segments from object storage/CDN.
- **Pros:** Adapts playback quality to network conditions; supports smoother playback across bandwidth ranges; segment delivery fits CDN caching.
- **Cons:** Significantly more FFmpeg work and storage; more complex manifests, authorization, and cleanup; downloadable original must remain a separate object and user-facing choice.

**Recommendation:** Option B — A single normalized MP4 plus metadata/thumbnail offers a practical playback guarantee for the initial platform while keeping delivery simpler than HLS; retain the original object for user download and future reprocessing, accepting the additional storage and compute cost.

**Decision:** B

---

## TD-05: Video URL identity and public delivery policy

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** The platform requires a stable, collision-free video URL, while storage objects should not be exposed as the identity of a video. The identity contract affects database uniqueness, user-facing links, and whether a link can be reused if delivery infrastructure changes.

**Options:**

### Option A: Database UUID as the public video identifier
- Assign each video a UUID and expose it as the route identifier; keep object keys private and resolve the video record before granting delivery access.
- **Pros:** Collision-resistant without central coordination; straightforward uniqueness constraint; decouples URLs from filenames and storage providers.
- **Cons:** URLs are longer and reveal identifier format; UUIDs alone do not grant access, so visibility policy must still be enforced.

### Option B: Random short code stored with a unique constraint
- Generate an opaque short identifier and insert it under a database unique constraint, retrying on the extremely rare collision.
- **Pros:** Compact, readable links; hides sequential database IDs; independent of the storage key.
- **Cons:** Requires custom generation and collision-retry policy; shorter codes have a larger collision probability and can be enumerated without authorization controls.

### Option C: Human-readable slug derived from title
- Create a normalized title slug and append a uniqueness suffix when needed; resolve the slug to the video record.
- **Pros:** Readable and descriptive links; useful for search-engine snippets.
- **Cons:** Title changes and collisions require alias/redirect behavior; slug leakage exposes content names; more lifecycle rules than the current phase requires.

**Recommendation:** Option A — The project already uses PostgreSQL and needs a durable identity independent of storage; UUID routing avoids collision handling while leaving any later human-readable alias as a separate product decision.

**Decision:** A

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Cross-layer | Upload protocol and control-plane contract for 10 GB videos | Direct S3-compatible multipart upload with presigned part URLs | A |
| TD-02 | Backend | Video and thumbnail object storage | S3-compatible object storage abstraction | A |
| TD-03 | Backend | Background video processing queue and worker runtime | BullMQ with Redis and independent worker runtime | A |
| TD-04 | Cross-layer | Video processing outputs and delivery contract | Normalize to MP4; preserve original for download | B |
| TD-05 | Cross-layer | Video URL identity and public delivery policy | PostgreSQL-backed UUID identity | A |


