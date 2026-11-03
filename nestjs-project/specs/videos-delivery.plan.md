---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-delivery.e2e-spec.ts
---

# Endpoint Test Plan

## Application Overview

Delivery endpoints resolve the public UUID to the ready video record, then issue a short-lived redirect to the normalized MP4 for authorized playback or to the original object as an owner-only attachment download.

## Test Scenarios

### 1. GET /videos/:videoId/playback

**Setup:** Truncate the test database, bootstrap the Nest test module, and seed public published-ready, owner-only unpublished-ready, draft, and missing-video cases with a storage adapter that captures signed URLs.

#### 1.1. redirect-public-ready-video-to-range-capable-mp4

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-03T13:05:43-03:00

**Steps:**
  1. GET `/videos/:videoId/playback` for a published, public, ready video.
    - expect: HTTP 302 with a short-lived URL for the normalized MP4.
    - expect: the redirect target supports byte-range requests for playback and seeking.
  2. GET playback for the owner of an unpublished ready video.
    - expect: HTTP 302 to that video's normalized MP4.

#### 1.2. reject-missing-or-not-ready-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-03T13:05:43-03:00

**Steps:**
  1. Request playback for an unknown UUID and for a known video without a normalized output.
    - expect: HTTP 404 with `errorCode: "VIDEO_NOT_FOUND"` for the unknown UUID.
    - expect: HTTP 409 with `errorCode: "VIDEO_NOT_READY"` when the output is unavailable.
  2. Request playback for another user's unpublished ready video.
    - expect: HTTP 403 with `errorCode: "VIDEO_ACCESS_DENIED"`.

### 2. GET /videos/:videoId/download

**Setup:** Use the same seeded video records and authenticate as the owner and as a different user.

#### 2.1. redirect-owner-to-original-as-attachment

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-03T13:05:43-03:00

**Steps:**
  1. GET `/videos/:videoId/download` as the owner of a ready video.
    - expect: HTTP 302 to a short-lived URL for the original object with attachment disposition.
  2. Repeat as a user who does not own the video.
    - expect: no signed URL is returned and access is denied.
