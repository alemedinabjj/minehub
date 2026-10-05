# HubMine

[![CI](https://github.com/alemedinabjj/minehub/actions/workflows/ci.yml/badge.svg)](https://github.com/alemedinabjj/minehub/actions/workflows/ci.yml)

Plataforma para criar e gerenciar servidores de Minecraft sem precisar entender de infraestrutura. Você escolhe a versão, o tipo de servidor (Vanilla, Paper, Fabric, Forge, NeoForge…) ou um modpack, e o HubMine sobe um container isolado, entrega o endereço para os amigos entrarem e oferece um painel com console, jogadores, métricas e configurações.

## Funcionalidades

- **Criação guiada de mundos**: um fluxo em etapas com prévia 3D do mundo e recomendação de memória e CPU conforme o software, o modpack e o número de jogadores.
- **Catálogo vivo**: as versões, os loaders e os modpacks (Modrinth) vêm das fontes oficiais. O cliente nunca envia combinações hardcoded e a API valida tudo na criação.
- **Ciclo de vida assíncrono**: as ações de criar, iniciar, parar, reiniciar e excluir respondem `202 Accepted` e rodam em fila, com outbox transacional, idempotência e uma única operação ativa por servidor.
- **Painel do servidor**: visão geral (RAM, CPU, jogadores), console RCON, logs, gestão de jogadores (kick, ban, op, whitelist), histórico de eventos e configurações. O painel avisa quando uma mudança só vale após reiniciar.
- **Isolamento de containers**: o worker é o único processo que fala com o Docker. Os containers rodam sem capabilities, com limites de memória, CPU e PIDs e com userns-remap.

## Arquitetura

```text
 ┌──────────────┐  HTTP   ┌──────────────┐  outbox → BullMQ  ┌──────────────┐  Docker API  ┌─────────────────────┐
 │  apps/web    │ ──────► │  apps/api    │ ────────────────► │ apps/worker  │ ───────────► │ itzg/minecraft-     │
 │  Next.js     │         │  NestJS      │ ◄──── request/    │ Node         │              │ server (1 por mundo)│
 └──────────────┘         └──────┬───────┘       reply       └──────┬───────┘              └─────────────────────┘
                                 │                                  │
                                 ▼                                  ▼
                          PostgreSQL (Prisma)  ◄──────────────  Redis (filas, locks)
```

- **`apps/api`** (NestJS): autenticação JWT com refresh em cookie, servidores, catálogo e auditoria. Ela grava estado e jobs no Postgres e nunca toca no Docker.
- **`apps/worker`** (Node): consome as filas de ciclo de vida e de comandos do painel, monta a especificação segura do container e acompanha o healthcheck até o servidor ficar online.
- **`apps/web`** (Next.js 16, React 19, Tailwind 4, React Three Fiber): landing, autenticação, criação de mundos e painel.
- **`packages/shared`**: contratos Zod compartilhados entre front e back.
- **`packages/database`**: schema Prisma, migrations e client.
- **`packages/queue`**: nomes de filas, payloads de jobs e opções de retry.
- **`packages/config`**: validação de variáveis de ambiente.

Estados de um servidor: `CREATING → STARTING → ONLINE ⇄ STOPPING → STOPPED`, além de `SUSPENDED`, `CRASHED`, `ERROR`, `DELETING` e `DELETED`.

## Stack

TypeScript, pnpm workspaces, NestJS 12, Next.js 16, Prisma 7, PostgreSQL 17, Redis 8, BullMQ, dockerode, Zod 4, Vitest e Playwright.

## Rodando localmente

### Pré-requisitos

- Node.js 24+ e pnpm 11 (`corepack enable`)
- Docker Engine com Compose. No WSL2/Ubuntu, o script abaixo instala e endurece o daemon:

  ```bash
  sudo bash scripts/setup-wsl-docker.sh
  ```

- `openssl`, usado para gerar os segredos locais

### Setup

```bash
pnpm setup
```

Esse comando:

1. gera `.env` com segredos aleatórios (`scripts/dev-env.sh`, que não sobrescreve um `.env` existente);
2. instala as dependências e compila os pacotes internos;
3. sobe Postgres e Redis via `docker compose`, expostos só em `127.0.0.1`;
4. aplica as migrations.

Para o front, copie o exemplo:

```bash
cp apps/web/.env.example apps/web/.env.local
```

### Desenvolvimento

```bash
pnpm dev
```

| Serviço | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Servidores Minecraft | `localhost:25565-25664` |

Para testar só o front, sem API nem Docker, defina `NEXT_PUBLIC_API_MODE=mock` em `apps/web/.env.local`. A criação de mundos passa a usar um backend simulado em memória.

> Se o seu daemon Docker não usa userns-remap, defina `DOCKER_REQUIRE_USERNS=false` no `.env`, **somente em desenvolvimento**.

### Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm infra:up` / `pnpm infra:down` | Sobe ou derruba Postgres e Redis |
| `pnpm db:migrate:dev` | Cria e aplica uma nova migration |
| `pnpm db:studio` | Abre o Prisma Studio |
| `pnpm lint` | Lint de todos os workspaces |
| `pnpm typecheck` | Checagem de tipos |
| `pnpm test` | Testes unitários |
| `pnpm test:integration` | Testes de integração da API e do worker (precisa do Postgres e do Redis no ar) |
| `pnpm --filter @hubmine/worker test:docker` | Testes contra um Docker real |
| `pnpm test:e2e` | Testes E2E do front com Playwright |
| `pnpm build` | Build de produção de tudo |

## Estrutura

```text
.
├── apps/
│   ├── api/        # NestJS: auth, servers, catalog, audit
│   ├── web/        # Next.js: landing, auth, world-creation, servers (painel)
│   └── worker/     # lifecycle, commands, docker, minecraft, outbox
├── packages/
│   ├── config/     # schemas de env
│   ├── database/   # Prisma schema + migrations
│   ├── queue/      # contratos de fila
│   └── shared/     # contratos de API e domínio
├── scripts/        # setup do ambiente local
└── docker-compose.yml
```

## Convenções

- Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/), por exemplo `feat(server): …` ou `fix(docker): …`.
- Os padrões de arquitetura, segurança e testes de cada área estão documentados em [`.claude/skills/`](.claude/skills).
