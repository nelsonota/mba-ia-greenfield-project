---
subproject: backend
runner: jest+supertest
scope: phase-03-video-upload-processing
si: SI-03.4
target_file: test/videos-upload-parts.e2e-spec.ts
---

# Video Multipart Session Test Plan

## Application Overview

These endpoints authorize multipart part uploads to object storage, complete or abort the upload, and enqueue confirmed videos for asynchronous processing. Only the owner of the draft can operate its session; completion retries must remain recoverable and idempotent.

## Test Scenarios

### 1. POST /videos/{videoId}/upload-parts

**Setup:** Reset the test database before each scenario, boot the real Nest application with its global pipes and exception filters, create two authenticated users through the real auth flow, and use the local storage and queue fixtures.

#### 1.1. issue-part-urls-only-to-the-owner

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The owner requests URLs for valid part numbers of an active multipart session.
    - expect: HTTP `200` with one short-lived URL per requested part number.
    - expect: each URL is scoped to the session object and its requested part.
  2. A different authenticated user requests URLs for the same `videoId`.
    - expect: HTTP `403` with `error: "VIDEO_NOT_OWNED"` in the standard error envelope.
    - expect: no URL is issued to the non-owner.

#### 1.2. reject-invalid-part-number

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The owner requests a part URL with an invalid part number or a part outside the active upload's allowed range.
    - expect: HTTP `400` with `error: "INVALID_UPLOAD_REQUEST"` in `{ statusCode, error, message }`.
    - expect: storage receives no presign request for the invalid part.

### 2. POST /videos/{videoId}/complete-upload

#### 2.1. complete-parts-and-enqueue-processing

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The owner submits the complete ordered part-number/ETag list for an active session.
    - expect: HTTP `202` with the same `videoId` and `status: "processing"`.
    - expect: storage confirms multipart completion and one `process-video` job is queued.

#### 2.2. recover-queue-publication-without-duplicate-job

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. Configure the queue fixture to fail the first publish after multipart completion, then retry the same completion request after the queue recovers.
    - expect: retry reconciles the persisted processing state and publishes a job for the video.
    - expect: the queue contains at most one effective job for the `videoId`, including after a further identical retry.

### 3. DELETE /videos/{videoId}/upload

#### 3.1. abort-session-and-preserve-recoverable-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The owner aborts an active multipart session.
    - expect: HTTP `204` with no response body.
    - expect: the remote multipart session is aborted and the draft remains recoverable for a retry or later cleanup.

### 4. Multipart error contract

#### 4.1. reject-operations-on-an-inactive-session

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The owner requests part URLs or completion for a session that is already aborted or completed.
    - expect: HTTP `409` with `error: "UPLOAD_NOT_ACTIVE"` in `{ statusCode, error, message }`.
    - expect: the response contains no storage credentials or internal provider details.
