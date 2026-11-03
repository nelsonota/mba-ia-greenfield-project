---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.3
target_file: test/videos-upload-init.e2e-spec.ts
---

# Endpoint Test Plan

## Application Overview

Authenticated users start a multipart video upload. The API records a private draft before returning bounded, short-lived part upload URLs; video bytes then travel directly from the browser to S3-compatible storage.

## Test Scenarios

### 1. POST /videos/uploads

**Setup:** Truncate the test database, bootstrap the Nest test module, and authenticate as a user with a channel.

#### 1.1. create-private-draft-before-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-03T12:01:00-03:00

**Steps:**
  1. POST `/videos/uploads` with a valid filename, media type, and size under or equal to 10 GB.
    - expect: HTTP 201 with `videoId`, `status: "draft"`, `partSizeBytes`, and `partCount`.
    - expect: the database contains a `draft` video for the authenticated user's channel before any storage part is uploaded.

### 2. Upload metadata validation and authentication

**Setup:** Keep the authenticated channel fixture and use a fresh database state per request.

#### 2.1. reject-invalid-size-and-metadata

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-03T12:01:00-03:00

**Steps:**
  1. POST `/videos/uploads` with zero, negative, or greater-than-10-GB `sizeBytes`, then with missing required metadata.
    - expect: HTTP 400 with `errorCode: "VALIDATION_ERROR"`; no draft is persisted.

#### 2.2. reject-upload-start-without-session

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-03T12:01:00-03:00

**Steps:**
  1. POST `/videos/uploads` without a valid access token.
    - expect: HTTP 401 with `errorCode: "UNAUTHENTICATED"`.
    - expect: no video draft is persisted.

### 3. POST /videos/:videoId/upload-parts

**Setup:** Create a draft with an active multipart upload and prepare owner and non-owner authenticated users.

#### 3.1. sign-bounded-parts-for-owner

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-03T12:01:00-03:00

**Steps:**
  1. The owner requests valid part numbers for the draft.
    - expect: HTTP 200 with a `parts` array whose entries include `partNumber`, short-lived `url`, and `expiresAt`.

#### 3.2. reject-part-urls-for-non-owner

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-03T12:01:00-03:00

**Steps:**
  1. A different authenticated user requests part URLs for the draft.
    - expect: HTTP 403 with `errorCode: "VIDEO_ACCESS_DENIED"`.
    - expect: no signed storage URL is returned.
