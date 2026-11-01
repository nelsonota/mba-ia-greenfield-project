---
subproject: backend
runner: jest+supertest
scope: phase-03-video-upload-processing
si: SI-03.3
target_file: test/videos-create.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

The endpoint creates the owner's video draft and starts an S3-compatible multipart session before the client uploads the file bytes directly to storage. The request is idempotent so network retries do not create duplicate drafts or multipart sessions.

## Test Scenarios

### 1. POST /videos

**Setup:** Reset the test database before each scenario, boot the real Nest application with its global pipes and exception filters, provision an authenticated owner through the real auth flow, and use the local storage adapter fixture.

#### 1.1. create-draft-and-start-multipart

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The API client sends `POST /videos` with a valid bearer token, a fresh `Idempotency-Key`, and JSON `{ "fileName": "sample.mp4", "contentType": "video/mp4", "sizeBytes": 1048576 }`.
    - expect: HTTP `201`.
    - expect: response includes `videoId`, `status: "draft"`, and multipart `upload` details.
    - expect: the database contains one draft owned by the authenticated user and the storage fixture has one active multipart session.

#### 1.2. retry-same-idempotency-key

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The API client sends the same valid request twice with the same owner, key, and body.
    - expect: both responses identify the same `videoId` and multipart session.
    - expect: only one draft and one storage session exist.

#### 1.3. reject-idempotency-key-with-different-request

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The API client creates a draft with an idempotency key, then repeats the key with a different `sizeBytes` value.
    - expect: the second request returns HTTP `409`.
    - expect: response body follows `{ "statusCode": 409, "error": "IDEMPOTENCY_CONFLICT", "message": "..." }`.
    - expect: no second draft or multipart session is created.

#### 1.4. reject-video-larger-than-10-gb

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The API client sends a validly authenticated request with `sizeBytes: 10000000001`.
    - expect: HTTP `413` with `error: "VIDEO_TOO_LARGE"` in the standard error envelope.
    - expect: no draft or multipart session is created.

#### 1.5. recover-when-storage-cannot-start-session

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. Configure the local storage test fixture to fail multipart initiation, then send a valid `POST /videos` request.
    - expect: the endpoint does not return `201` and responds with HTTP `503`, `error: "STORAGE_UNAVAILABLE"`.
    - expect: any database record left by the cross-system failure is marked recoverable and can be reconciled or cleaned without becoming a usable upload.
    - expect: retrying after storage recovers reuses the idempotency key without creating duplicate drafts.
