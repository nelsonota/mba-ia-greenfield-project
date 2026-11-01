---
kind: phase
name: phase-03-video-upload-processing
sources_mtime:
  docs/project-plan.md: "2026-10-31T21:46:53Z"
  docs/decisions/technical-decisions-video-upload-processing.md: "2026-11-01T12:31:51Z"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-10-31T21:46:52Z"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-10-31T21:46:52Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-31T21:46:53Z"
  docs/phases/phase-02-auth/context.md: "2026-10-31T21:46:53Z"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-31T21:46:52Z"
  .agents/skills/testing-guide-next-frontend/SKILL.md: "2026-10-31T21:46:52Z"
---

# phase-03-video-upload-processing — Context

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

**Out of scope:** Não especificado em `docs/project-plan.md`.
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:** `nestjs-project/`, `next-frontend/` (declarados no documento de decisões da fase).
**Deferred subprojects:** Nenhum indicado.
**Sequencing notes:** Depende das Fases 01 e 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Autenticação e autorização
- **Phase 04:** Gerenciamento de Vídeos e Canal

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| video-upload-processing/TD-01 | phase | Cross-layer | Protocolo de upload resiliente até 10GB | decided | A | — |
| video-upload-processing/TD-02 | phase | Backend | Serviço de armazenamento de vídeos e thumbnails | decided | A | — |
| video-upload-processing/TD-03 | phase | Backend | Tecnologia de filas para processamento de vídeo | decided | A | — |
| video-upload-processing/TD-04 | phase | Cross-layer | Formato de entrega para streaming e download | decided | A | — |
| video-upload-processing/TD-05 | phase | Cross-layer | Criação do rascunho e consistência do início do upload | decided | C | — |

_Source files:_

- video-upload-processing — `docs/decisions/technical-decisions-video-upload-processing.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | video-upload-processing/TD-02 |
| Serviço de processamento em segundo plano (filas) | video-upload-processing/TD-03 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | video-upload-processing/TD-01 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | video-upload-processing/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | video-upload-processing/TD-03 |
| Geração automática de thumbnail a partir de um frame do vídeo | video-upload-processing/TD-03 |
| URL única por vídeo, sem conflito com outros vídeos | video-upload-processing/TD-02 |
| Reprodução via streaming (sem necessidade de download completo) | video-upload-processing/TD-04 |
| Download do vídeo pelo usuário | video-upload-processing/TD-04 |

## Decisions Detail

### video-upload-processing/TD-01

**Recommendation:** S3 multipart oferece retry granular e transfere os bytes diretamente, protegendo a API sob o requisito de 10GB; a documentação AWS recomenda considerar multipart para objetos grandes e permite reenviar partes falhas. O custo é manter um contrato de sessão e validar suporte no ambiente S3 compatível local.
**Libraries:** —

### video-upload-processing/TD-02

**Recommendation:** Mantém o contrato S3 entre ambientes, usa RustFS em Docker para desenvolvimento local e deixa operação de discos para um provedor gerenciado em produção. RustFS substitui o MinIO arquivado; suas operações multipart e Range documentadas serão verificadas pelo teste de integração. A escolha do provedor e estimativas de custo ficam para configuração de implantação, sem alterar o contrato da aplicação.
**Libraries:** —

### video-upload-processing/TD-03

**Recommendation:** BullMQ se encaixa no ecossistema Node e fornece retry/backoff prontos; Redis é um serviço separado que atende ao requisito de fila durável sem criar implementação de polling no PostgreSQL. O worker deve ser idempotente, pois a documentação do BullMQ descreve entrega ao menos uma vez em cenários de falha.
**Libraries:** —

### video-upload-processing/TD-04

**Recommendation:** A fase requer reprodução e download, mas não menciona adaptação de qualidade; entrega progressiva do original atende ao escopo com menor custo de processamento e armazenamento. HLS pode ser introduzido quando houver requisito de múltiplas qualidades ou condições de rede variáveis.
**Libraries:** —

### video-upload-processing/TD-05

**Recommendation:** Chave idempotente e estado de recuperação alinham o pré-cadastro com uploads grandes retomáveis, evitando duplicidade em retries e permitindo tratar a lacuna entre PostgreSQL e S3. O multipart deve ser concluído ou abortado; o S3 também oferece lifecycle para remover uploads incompletos.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** `@nestjs/config` com factories `registerAs` namespaced.
**Libraries:** @nestjs/config@^4.x

### phase-01-configuracao-base/TD-02

**Recommendation:** Joi valida variáveis de ambiente através de `validationSchema`.
**Libraries:** joi@^17.x

### phase-01-configuracao-base/TD-03

**Recommendation:** Configuração agrupada e namespaced com injeção tipada.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** A mesma factory `registerAs` serve ao NestJS DI e ao TypeORM CLI.
**Libraries:** dotenv (transitive)

### phase-02-auth/TD-07

**Recommendation:** Option A, Custom Domain Exception Filter, define o formato `{ statusCode, error, message }` com códigos de erro de domínio legíveis por máquina para consumo do frontend.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** **Option A (`openapi-typescript` + `openapi-fetch`)**. O BFF estrito mantém as chamadas upstream nos Route Handlers e reduz o valor de um SDK no cliente; os tipos `paths` estendem a abordagem TypeScript sem runtime, e a dupla `paths` + `openapi-fetch` elimina boilerplate de fetch nos Route Handlers. O mesmo símbolo `paths` permite tipar handlers MSW. Reavaliar se houver fetching no cliente ou se a API ultrapassar cerca de 20 operações.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** **Option B (cópia local versionada + script de sincronização no root)** preserva a independência dos stacks Docker. Com a verificação de freshness CI do TD-03, o drift é eliminado estruturalmente e diffs do OpenAPI ficam visíveis para revisão; o script repo-root evita dependência cruzada de bind mount entre compose files.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** **Option C (artefatos versionados + verificação de freshness no CI)** torna o drift visível em diffs e impede merge acidental com um passo de CI. O custo adicional é um passo de CI; aplicar o mesmo padrão a futuros artefatos gerados.
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** **Option A (um `lib/api/contracts.ts` com aliases explícitos)** usa o mesmo mecanismo para pass-through e reshape, centraliza a leitura dos shapes expostos pelo BFF e evita imports de componentes a partir de caminhos internos de Route Handlers.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** **Option A (handlers manuais tipados via `paths`)** mantém fixtures determinísticas, ancora contrato, handler e assertions no mesmo tipo e tem baixo custo para o número atual de endpoints. Se o volume crescer, um gerador de handlers pode ser avaliado sem alterar os imports `paths`.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** **Option B (módulos por domínio + barrel)** alinha os handlers à organização por domínio e permite expansão append-only com poucos conflitos, mantendo arquivos estáveis conforme as fases evoluem.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** **Option A (somente testes, apenas `setupServer`)** evita adicionar worker de browser sem consumidor atual, mantém a fundação mínima e pode ser estendida sem quebra quando surgir necessidade.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** **Option D (defaults escritos à mão + faker com seed opt-in para coleções)** mantém determinismo e legibilidade como padrão e reserva geração de dados para coleções grandes; seeds locais evitam cursor global frágil.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** **Option A (handlers universais + overrides `server.use(...)` + `onUnhandledRequest: "error"`)** segue o modelo MSW v2; handlers por domínio mantêm autoria modular, e requisições não declaradas falham claramente nos testes.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories, one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the factory remains importable as a plain function for non-DI contexts. _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'`, then imports and calls `databaseConfig`. _(from phase 01)_
- Database connection parameters come from one `databaseConfig` factory and are not duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` uses `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `autoLoadEntities: true`, and `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity | Integration: constraints, defaults, and `select: false` behavior |
| Service with branching and database access | Unit for branch logic + integration for database contract |
| Service with database access only | Integration for database contract |
| Service with configured library | Unit with real library and test configuration |
| Service with side-effect dependency (storage) | Integration with real capture service or local adapter |
| Module with configured imports | Unit module-compilation test |
| Controller | E2E only |
| DTO | E2E validation-wiring test per endpoint |

### next-frontend

| Artifact type | Required layers |
|---------------|-----------------|
| Async page | E2E |
| Client component with state/handlers | Unit (`*.test.tsx`) |
| Feature component | E2E via consuming page |
| `lib/` utility with branching/shape assumptions | Unit (`*.test.ts`) |
| Custom hook | Unit (`*.test.ts(x)`) |
| Route handler with branching/proxy behavior | Integration (+ unit for extracted pure logic) |
