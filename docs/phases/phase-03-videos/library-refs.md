---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-11-03T14:03:15Z"
  "bullmq":
    version: "^5.81.5"
    context7_id: "/taskforcesh/bullmq/v5.81.5"
    fetched_at: "2026-11-03T14:03:15Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-03T11:03:12.6118303-03:00"
---

### @nestjs/bullmq

For this NestJS 11 project, use the Nest integration major 11 (`@nestjs/bullmq` ^11.0.5). The integration registers queues with `BullModule.registerQueue(...)` and exposes processors through `@Processor(...)` / `WorkerHost`; configure Redis through the Nest module. Context7 docs: `/nestjs/bull` (NestJS Bull/BullMQ integration).

### bullmq

BullMQ v5.81.5 supports worker concurrency and retries/backoff. Keep the job payload limited to the video ID and object key as the phase TD recommends; run processing in the independent worker runtime. Context7 docs: `/taskforcesh/bullmq/v5.81.5`.
