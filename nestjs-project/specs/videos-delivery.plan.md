---
subproject: backend
runner: jest+supertest
scope: phase-03-video-upload-processing
si: SI-03.6
target_file: test/videos-delivery.e2e-spec.ts
---

# Video Stream and Download Test Plan

## Application Overview

These endpoints deliver the processed original video progressively for playback or as a download attachment. Public requests are limited to videos that are ready and published; incomplete drafts stay private to their owner.

## Test Scenarios

### 1. GET /videos/{videoId}/stream

**Setup:** Reset the test database before each scenario, boot the real Nest application with its global pipes and exception filters, create owner/non-owner identities through the real auth flow, and prepare ready/published and draft videos backed by the local storage fixture.

#### 1.1. stream-ready-video-progressively

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. An anonymous API client requests the stream for a ready and published video without a `Range` header.
    - expect: HTTP `200`, the original content type, and `Accept-Ranges: bytes`.
    - expect: a streaming-capable client receives the first chunk before the storage fixture releases the final chunk; the response is not held until the complete object has been buffered.

#### 1.2. serve-a-valid-byte-range

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. An API client requests a ready video with `Range: bytes=0-99`.
    - expect: HTTP `206` and `Content-Range: bytes 0-99/<object-size>`.
    - expect: the response body contains only the requested bytes.

#### 1.3. keep-drafts-private

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. An anonymous user and a different authenticated user request the stream for an unpublished draft.
    - expect: both receive HTTP `404` with `error: "VIDEO_NOT_FOUND"`; the response does not reveal the draft's existence or owner.
  2. The owner requests their own ready video.
    - expect: access follows the Authorization Matrix and does not expose another user's draft.

### 2. GET /videos/{videoId}/download

#### 2.1. download-original-as-an-attachment

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. An anonymous user requests the download for a ready and published video.
    - expect: HTTP `200` and a streamed original response.
    - expect: `Content-Disposition` is `attachment` and uses a safe filename derived from video metadata.

### 3. Stream and download errors

#### 3.1. return-range-and-storage-errors

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-01T02:05:07Z

**Steps:**
  1. The API client requests a range outside the object bounds.
    - expect: HTTP `416` with `error: "RANGE_NOT_SATISFIABLE"` in `{ statusCode, error, message }`.
  2. Make the local storage fixture unavailable and request a ready video's stream.
    - expect: HTTP `503` with `error: "STORAGE_UNAVAILABLE"` in the standard error envelope.
    - expect: the body contains no provider credentials or internal storage details.
