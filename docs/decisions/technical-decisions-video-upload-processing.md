---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-10-31
scope_description: "Upload resiliente de vídeos até 10GB, armazenamento, processamento assíncrono e entrega para streaming e download."
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — controla o ciclo de vida do vídeo, coordena storage e filas, e expõe processamento e entrega.
- `next-frontend/` — envia arquivos grandes, acompanha o upload e consome streaming/download; suas decisões de protocolo estão cobertas nos TDs cross-layer.

---

## TD-01: Protocolo de upload resiliente até 10GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O navegador e a API precisam concordar sobre como transferir arquivos grandes e retomar falhas. A API não deve manter o arquivo inteiro em memória nem ocupar conexões por toda a duração do upload.

**Options:**

### Option A: Multipart direto ao object storage com URLs pré-assinadas
- A API cria um upload multipart e emite URLs temporárias para partes; o navegador transfere cada parte diretamente ao storage e a API finaliza o objeto após confirmar as partes. Partes interrompidas podem ser reenviadas sem reiniciar o arquivo.
- **Pros:** Tráfego de vídeo não passa pela API; retentativa por parte e retomada; funciona com objetos de vários GB e reduz pressão sobre o backend.
- **Cons:** Exige CORS e compatibilidade multipart no storage; protocolo de inicialização, confirmação, expiração e limpeza é mais elaborado; URLs pré-assinadas exigem controle de escopo e duração.

### Option B: Upload multipart para a API, com streaming até o storage
- O navegador envia partes para endpoints da API e o backend as transmite ao storage sem montar o arquivo completo em memória. O backend controla autenticação e progresso; a retomada fica ligada ao protocolo de sessão implementado pela aplicação.
- **Pros:** Um único domínio de autenticação e autorização; abstrai diferenças entre provedores de storage; integração operacional local pode ser mais simples.
- **Cons:** Toda a banda e conexões passam pela API; maior custo de tráfego e capacidade; a equipe precisa implementar e manter a retomada e o controle das partes.

### Option C: Protocolo tus
- O navegador usa o protocolo aberto tus com offsets persistidos para retomar transferências interrompidas. O serviço tus recebe os dados e os grava ou encaminha ao storage.
- **Pros:** Retomada padronizada independente de navegador; especificação e ecossistema próprios para upload retomável.
- **Cons:** Adiciona servidor/protocolo especializado e integração para autenticação, storage e ciclo de vida do vídeo; ainda precisa escolher onde o tráfego é terminado.

**Recommendation:** **Option A** — S3 multipart oferece retry granular e transfere os bytes diretamente, protegendo a API sob o requisito de 10GB; a documentação AWS recomenda considerar multipart para objetos grandes e permite reenviar partes falhas. O custo é manter um contrato de sessão e validar suporte no ambiente S3 compatível local.

**Decision:** A

---

## TD-02: Serviço de armazenamento de vídeos e thumbnails

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O serviço precisa armazenar originais e thumbnails com chaves estáveis, leitura por faixa de bytes e uma rota de evolução do desenvolvimento local à produção. A escolha afeta configuração, compatibilidade de API e custo operacional.

**Options:**

### Option A: API S3 com RustFS local e S3 gerenciado em produção
- A aplicação usa a API S3 tanto no desenvolvimento, com RustFS em Docker, quanto em produção, com um provedor S3 gerenciado. Buckets e chaves ficam fora do PostgreSQL; os registros do vídeo guardam referências e estado. RustFS é a implementação local escolhida após o arquivamento do repositório MinIO.
- **Pros:** Mesmo contrato de aplicação entre ambientes; suporte a operações S3 necessárias ao slice; produção gerenciada evita operar capacidade de discos; RustFS mantém o ambiente local reproduzível via Docker.
- **Cons:** Compatibilidade entre provedores não é perfeita em todos os recursos e deve ser coberta pelos testes de integração; produção exige conta, políticas e orçamento de storage/tráfego; RustFS local continua exigindo persistência e atualização da imagem.

### Option B: Object storage autogerenciado em todos os ambientes
- RustFS ou outro servidor compatível com S3 é operado pela equipe localmente e em produção. A aplicação usa o mesmo serviço e a equipe controla atualização, discos, disponibilidade e replicação.
- **Pros:** Controle sobre implantação e localização dos dados; mesmo provedor nos ambientes; pode ser adequado a uma infraestrutura já operada pela equipe.
- **Cons:** A equipe assume capacidade, redundância, recuperação, atualização e monitoramento; risco operacional maior para arquivos grandes e persistentes.

### Option C: Provedor S3 gerenciado em todos os ambientes
- Desenvolvimento e produção usam buckets de um provedor gerenciado, com contas/buckets separados e políticas de acesso específicas.
- **Pros:** Menos serviços de storage para manter; testa desde cedo o serviço real de produção; disponibilidade e escalabilidade são providas pelo fornecedor.
- **Cons:** Desenvolvimento depende de credenciais/rede e pode gerar custo; diferenças entre conta local e produção podem complicar testes; reduz a paridade offline.

**Recommendation:** **Option A** — Mantém o contrato S3 entre ambientes, permite desenvolvimento Docker conforme a arquitetura com RustFS mantido e deixa operação de discos para um provedor gerenciado em produção. O MinIO foi substituído porque seu repositório foi arquivado e sua distribuição oficial passou a ser somente por código-fonte; RustFS oferece imagem oficial e documenta compatibilidade com multipart e leituras Range usadas neste slice. As operações concretas continuam verificadas pelo teste de integração. A escolha do provedor e estimativas de custo ficam para configuração de implantação, sem alterar o contrato da aplicação.

**Decision:** A

---

## TD-03: Tecnologia de filas para processamento de vídeo

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O backend deve publicar trabalho quando o upload estiver completo e um worker separado deve extrair duração/metadados e produzir thumbnail. A fila precisa sobreviver a reinícios e permitir reexecução controlada; isso define um novo serviço de infraestrutura e seu modelo de operação.

**Options:**

### Option A: BullMQ com Redis
- A API publica jobs no BullMQ e um processo worker os consome usando Redis como armazenamento da fila. BullMQ oferece tentativas com backoff e processamento distribuído; jobs devem tolerar execução repetida.
- **Pros:** Integração Node/NestJS direta; retries, concorrência e estados de job disponíveis; Redis pode servir futuramente a outros usos de cache/coordenação.
- **Cons:** Introduz Redis e sua operação; semântica de entrega pode repetir jobs em falhas, exigindo idempotência; aumenta número de dependências no ambiente.

### Option B: RabbitMQ com AMQP
- A API publica mensagens duráveis em filas RabbitMQ e workers confirmam mensagens depois do processamento. Retries, dead-letter e topologia são definidos na configuração do broker e dos consumidores.
- **Pros:** Broker dedicado a mensageria; acknowledgements, filas duráveis e dead-lettering são conceitos próprios do serviço; desacopla a fila de cache.
- **Cons:** Adiciona operação e configuração de broker; mais conceitos de topologia para uma fila inicial; integração NestJS/BullMQ não se aplica.

### Option C: Fila PostgreSQL persistida pela aplicação
- Jobs são gravados em tabelas PostgreSQL e workers reivindicam linhas pendentes com bloqueios/leases. O estado da fila compartilha o banco já existente.
- **Pros:** Sem broker adicional; jobs e domínio podem participar de transações no mesmo banco; infraestrutura inicial menor.
- **Cons:** A aplicação passa a manter polling, leases, concorrência e recuperação; trabalho de processamento compete com consultas do produto; menor isolamento operacional.

**Recommendation:** **Option A** — BullMQ se encaixa no ecossistema Node e fornece retry/backoff prontos; Redis é um serviço separado que atende ao requisito de fila durável sem criar implementação de polling no PostgreSQL. O worker deve ser idempotente, pois a documentação do BullMQ descreve entrega ao menos uma vez em cenários de falha.

**Decision:** A

---

## TD-04: Formato de entrega para streaming e download

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** O browser precisa reproduzir o vídeo antes de obter o objeto inteiro. A decisão define o artefato produzido pelo worker e os endpoints/URLs consumidos pelo frontend. A capacidade de download também deve continuar disponível para o usuário.

**Options:**

### Option A: Arquivo original com entrega progressiva e suporte a Range
- O worker extrai metadados e thumbnail, preservando o vídeo original. O storage/CDN ou a API entrega bytes sob demanda e suporta requisições HTTP Range para busca no vídeo; o mesmo objeto pode ser baixado.
- **Pros:** Menor processamento e armazenamento adicional; mantém download simples; Range permite reprodução e seeking sem baixar o arquivo inteiro.
- **Cons:** Sem variantes adaptativas de qualidade; compatibilidade de codecs e posicionamento de metadados no contêiner afetam início e busca; banda de saída pode ser alta.

### Option B: HLS adaptativo gerado pelo worker
- O worker transcodifica o vídeo em segmentos e playlists HLS; o frontend toca a playlist e o download do original continua como artefato separado.
- **Pros:** Segmentos permitem começar a reprodução cedo e adaptar qualidade à conexão; facilita evoluir para múltiplas resoluções e bitrates.
- **Cons:** Transcodificação aumenta CPU/tempo de fila; segmentos e variantes elevam armazenamento e custo; download do original exige manter e expor outro objeto.

**Recommendation:** **Option A** — A fase requer reprodução e download, mas não menciona adaptação de qualidade; entrega progressiva do original atende ao escopo com menor custo de processamento e armazenamento. HLS pode ser introduzido quando houver requisito de múltiplas qualidades ou condições de rede variáveis.

**Decision:** A

---

## TD-05: Criação do rascunho e consistência do início do upload

**Scope:** Cross-layer

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** O usuário precisa receber uma identidade de vídeo antes de enviar as partes multipart para que possa acompanhar e retomar o upload. A criação do registro no PostgreSQL e a abertura da sessão multipart no storage são operações em sistemas distintos, sem uma transação atômica comum; a ordem escolhida define como falhas e repetições deixam o rascunho e a sessão consistentes.

**Options:**

### Option A: Criar o rascunho e depois iniciar a sessão no S3
- A API persiste o vídeo como rascunho, inicia o multipart no storage e associa o upload ID ao registro antes de responder ao frontend. Se a inicialização no storage falhar, o rascunho permanece e pode ser retomado ou marcado para tratamento.
- **Pros:** O vídeo ganha uma identidade persistente imediatamente; o fluxo corresponde ao pré-cadastro antes do envio; o frontend recebe um identificador estável.
- **Cons:** Uma falha entre persistência e início do multipart deixa um rascunho sem sessão; repetir o pedido pode criar outro rascunho sem proteção contra duplicidade.

### Option B: Iniciar o multipart no S3 e depois persistir o rascunho
- A API abre primeiro a sessão no storage e só então cria o rascunho com o upload ID. Se a gravação no PostgreSQL falhar, a API tenta abortar a sessão multipart.
- **Pros:** O registro só representa um upload quando a sessão já existe; falha ao gravar o banco pode ser compensada abortando a sessão.
- **Cons:** Uma falha entre as duas operações pode deixar uma sessão órfã; o vídeo não recebe identidade persistente antes do sucesso do storage; multipart incompleto precisa ser abortado para evitar retenção de partes.

### Option C: Rascunho e sessão com chave idempotente e recuperação
- A API grava um rascunho e uma intenção de upload identificados por uma chave idempotente, inicia ou recupera a sessão multipart e atualiza o estado da intenção. Repetições do mesmo pedido retornam a mesma identidade; operações incompletas podem ser retomadas ou compensadas.
- **Pros:** Preserva a identidade antecipada do vídeo; evita duplicar rascunhos em retries; torna explícita a recuperação entre PostgreSQL e storage.
- **Cons:** Acrescenta estado e regras de recuperação ao ciclo de vida do upload; exige definir validade da chave e tratamento de intenções abandonadas.

**Recommendation:** **Option C** — Chave idempotente e estado de recuperação alinham o pré-cadastro com uploads grandes retomáveis, evitando duplicidade em retries e permitindo tratar a lacuna entre PostgreSQL e S3. O multipart deve ser concluído ou abortado; o S3 também oferece lifecycle para remover uploads incompletos.

**Decision:** C

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Cross-layer | Protocolo de upload resiliente até 10GB | **A** (multipart direto ao storage) | A |
| TD-02 | Backend | Serviço de armazenamento de vídeos e thumbnails | **A** (S3 com RustFS local e S3 gerenciado em produção) | A |
| TD-03 | Backend | Tecnologia de filas para processamento de vídeo | **A** (BullMQ com Redis) | A |
| TD-04 | Cross-layer | Formato de entrega para streaming e download | **A** (arquivo original com entrega progressiva/Range) | A |
| TD-05 | Cross-layer | Criação do rascunho e consistência do início do upload | **C** (chave idempotente e recuperação da sessão) | _[pending]_

## Fontes consultadas

- [Amazon S3 — Multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — reenvio de partes interrompidas e montagem do objeto.
- [Amazon S3 — Abort incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html) — limpeza automática de sessões multipart incompletas.
- [TypeORM 0.3.27 — Transactions](https://github.com/typeorm/typeorm/blob/0.3.27/docs/docs/advanced-topics/2-transactions.md) — transações limitadas às operações no banco e uso do manager transacional (projeto instala 0.3.28; confirmar versão durante implementação).
- [Amazon S3 — Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — acesso temporário a upload/download sem distribuir credenciais do serviço.
- [Amazon S3 — GetObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) — requisição de faixas de bytes com `Range` e resposta parcial.
- [BullMQ — Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) — tentativas e backoff.
- [BullMQ — Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) e [BullMQ — Important notes](https://docs.bullmq.io/bull/important-notes) — processamento repetível sob semântica at-least-once.
- [FFmpeg — documentação](https://ffmpeg.org/ffmpeg-all.html) — extração de thumbnails e geração HLS.
- [RustFS — Container installation](https://docs.rustfs.com/en/installation/container) — imagem oficial e implantação local em container.
- [RustFS — S3 compatibility](https://docs.rustfs.com/en/reference/s3-compatibility) — operações multipart, leituras Range e URLs assinadas documentadas.
- [MinIO — repositório oficial](https://github.com/minio/minio) — estado arquivado e distribuição source-only que motivaram a revisão.
