---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: test/videos-upload-finalize.e2e-spec.ts
---

# Endpoint Test Plan

## Application Overview

The upload owner completes a multipart upload by reconciling part numbers and ETags, causing the video to enter processing, or aborts the open upload and receives an empty success response.

## Test Scenarios

### 1. POST /videos/:videoId/complete

**Setup:** Truncate the test database, bootstrap the Nest test module, authenticate an upload owner, and provide a storage test adapter that captures multipart completion.

#### 1.1. complete-upload-and-transition-to-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-03T12:41:35-03:00

**Steps:**
  1. POST `/videos/:videoId/complete` with all uploaded part numbers and their storage ETags.
    - expect: storage confirms the original object is complete before the response.
    - expect: HTTP 202 with the same `videoId` and `status: "processing"`.

#### 1.2. reject-invalid-parts-and-closed-upload

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-03T12:41:35-03:00

**Steps:**
  1. Complete an upload using rejected or inconsistent ETags/part numbers.
    - expect: HTTP 400 with `errorCode: "INVALID_UPLOAD_PARTS"`.
  2. Abort an upload, then attempt completion after it is closed.
    - expect: HTTP 409 with `errorCode: "UPLOAD_NOT_IN_PROGRESS"`.

#### 1.3. deny-completion-by-another-channel

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-03T12:41:35-03:00

**Steps:**
  1. POST completion for the draft as a user from another channel.
    - expect: HTTP 403 with `errorCode: "VIDEO_ACCESS_DENIED"`.

### 2. DELETE /videos/:videoId/upload

**Setup:** Create a second draft with an active multipart upload and authenticate as its owner.

#### 2.1. abort-owner-upload

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-03T12:41:35-03:00

**Steps:**
  1. DELETE `/videos/:videoId/upload` as the owner.
    - expect: HTTP 204 with no response body.
    - expect: storage records an abort for the draft's multipart upload.
