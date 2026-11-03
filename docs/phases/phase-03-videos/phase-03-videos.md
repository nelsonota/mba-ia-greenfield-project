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

<!-- SIs will be written in Phase B -->

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

<!-- Dep Map will be written in Phase B -->

---

## Deliverables

<!-- Deliverables will be written in Phase B -->
