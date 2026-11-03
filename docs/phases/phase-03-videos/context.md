---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-11-03T08:50:39.6170960-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-03T11:03:12.6118303-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-03T08:50:39.6145915-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-03T08:50:39.6084451-03:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-03T08:50:39.3668427-03:00"
  .agents/skills/testing-guide-next-frontend/SKILL.md: "2026-11-03T08:50:39.3773546-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** não especificado.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`, `next-frontend/`.

**Deferred subprojects:** nenhum especificado.

**Sequencing notes:** depende das fases 01 e 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Autenticação — fluxo de cadastro, login e recuperação de senha; inclui telas de autenticação.
- **Phase 04:** Gerenciamento de Vídeos e Canal — gerenciamento/publicação de vídeos, painel do canal e página pública.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|---|---|---|---|---|---|---|
| phase-03-videos/TD-01 | phase | Cross-layer | Upload protocol and control-plane contract for 10 GB videos | decided | A | — |
| phase-03-videos/TD-02 | phase | Backend | Video and thumbnail object storage | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Background video processing queue and worker runtime | decided | A | @nestjs/bullmq, bullmq |
| phase-03-videos/TD-04 | phase | Cross-layer | Video processing outputs and delivery contract | decided | B | — |
| phase-03-videos/TD-05 | phase | Cross-layer | Video URL identity and public delivery policy | decided | A | — |

_Source files:_

- `phase-03-videos` — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|---|---|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-03 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-01 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-01 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-02, phase-03-videos/TD-04 |
| Download do vídeo pelo usuário | phase-03-videos/TD-04 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** S3 multipart presigned upload provides independent retries and keeps 10 GB video traffic off both application servers; the Next BFF can remain the only path for control-plane requests while the browser sends bytes directly to storage.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** The project needs direct multipart upload and streaming/range delivery while preserving a provider-neutral development contract; store object keys rather than public URLs so delivery policy can change independently.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** BullMQ aligns with NestJS and supplies the retry/concurrency primitives this processing workload needs, while Redis is a bounded additional service that can run locally and independently of API workers.
**Libraries:** @nestjs/bullmq, bullmq

### phase-03-videos/TD-04

**Recommendation:** A single normalized MP4 plus metadata/thumbnail offers a practical playback guarantee for the initial platform while keeping delivery simpler than HLS; retain the original object for user download and future reprocessing, accepting the additional storage and compute cost.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** The project already uses PostgreSQL and needs a durable identity independent of storage; UUID routing avoids collision handling while leaving any later human-readable alias as a separate product decision.
**Libraries:** —
## Inherited Decisions Detail

### phase-02-auth/TD-01

**Recommendation:** Argon2id is OWASP-recommended for a greenfield project; the native build dependency is a one-time Docker setup cost, with no legacy bcrypt constraint.
**Libraries:** argon2@^0.41.x

### phase-02-auth/TD-02

**Recommendation:** @nestjs/passport follows official NestJS patterns and leaves room for future social login.
**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-03

**Recommendation:** Refresh token rotation provides strong theft detection; PostgreSQL supports it without new infrastructure, and a short grace period can mitigate races.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Random opaque reset tokens stored in the database are revocable and decoupled from JWT authentication.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** @nestjs-modules/mailer integrates with NestJS and SMTP, works with local Mailpit, and avoids provider lock-in.
**Libraries:** @nestjs-modules/mailer@^2.x, handlebars@^4.x

### phase-02-auth/TD-06

**Recommendation:** class-validator and class-transformer match the backend-only NestJS project and avoid extra integration surprises.
**Libraries:** class-validator@^0.14.x, class-transformer@^0.5.x

### phase-02-auth/TD-07

**Recommendation:** A custom domain exception filter provides machine-readable codes in a simple response format for the first-party frontend.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler scopes in-memory rate limiting to AuthModule using NestJS guards; distributed storage is not needed for the single-instance setup.
**Libraries:** @nestjs/throttler@^6.x

### phase-02-auth/TD-09

**Recommendation:** Opaque refresh tokens avoid redundant JWT signatures when database lookup is already required.
**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-10

**Recommendation:** A strict `[a-z0-9_]` handle allowlist is portable and simple; a `user_<random>` fallback covers unusual email prefixes.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** A small cookie-session helper fits the strict BFF model, is easy to test, and uses Next.js's built-in cookies primitive.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** An encrypted single session cookie adds defense in depth, simplifies logout, and carries minimal user metadata for RSC rendering.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** Server-side single-flight refresh belongs in the helper; client-driven refresh does not replace the RSC requirement, and timers add avoidable failure modes.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** React Hook Form with Zod aligns with shadcn form primitives and the frontend's existing schemas-as-source-of-truth pattern.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Route Handlers keep all mutations within the established BFF surface and reuse the existing MSW integration test pattern.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Delivering session state from RSC avoids first-render flicker and an extra BFF endpoint; the provider broadcasts that state.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** RSC owns confirmation/reset tokens while the client owns reset input, giving correct first paint and a shared flow pattern.
**Libraries:** —

### phase-01-configuracao-base/TD-01

**Recommendation:** @nestjs/config is maintained by the NestJS core team, supports NestJS 11, and shares a `registerAs()` factory with TypeORM CLI.
**Libraries:** @nestjs/config@^4.x

### phase-01-configuracao-base/TD-02

**Recommendation:** Joi integrates with `@nestjs/config` validationSchema and handles environment string-to-number coercion without custom wiring.
**Libraries:** joi@^17.x

### phase-01-configuracao-base/TD-03

**Recommendation:** Namespaced `registerAs` configuration gives clear domain boundaries and typed injection while keeping factories importable.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** A shared `registerAs` factory avoids duplicated configuration between NestJS and `data-source.ts`.
**Libraries:** dotenv (transitive via @nestjs/config)

## Inherited Conventions

- Use NestJS configuration with `@nestjs/config`, namespaced `registerAs` factories, Joi environment validation, typed injection, and shared `databaseConfig`. _(from phase 01)_
- Preserve the strict BFF boundary and the existing API contract and testing patterns in the frontend. _(from phase 02)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit (mock repository) + Integration (DB contract) |
| Service with DB only | Integration (DB contract) |
| Service with configured library (JWT, cache) | Unit with real library + test config |
| Service with side-effect dependency (email, storage) | Integration with real capture service or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only |
| DTO | E2E validation wiring per endpoint |
| Guard | E2E; Unit too when complex internal logic |
| Strategy | E2E via guard |
| Pipe | Unit |
| Interceptor | Unit and/or E2E |
| Exception filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

| Artifact type | Required layers |
|---|---|
| Async page (RSC) | E2E only |
| Client component with state/handlers | Vitest + RTL (`*.test.tsx`, jsdom), mock navigation, MSW for fetch |
| Feature component (server, no logic) | Covered by page E2E |
| Route handler with branching/proxying | Integration (Vitest + MSW), Unit for extracted pure logic |
| Utility/boundary module with branching or shape assumptions | Vitest unit |
| Custom hook | Vitest unit with `renderHook` |
| Static page/layout without logic | No component-level test; critical flow via E2E |
| Deferred subprojects | — |





