# KeyHub

KeyHub 是一个多用户 Claude Key 上号与用量同步平台。普通用户只能访问自己提交的 Key；管理员管理账号、上游连接、失败重试和全局脱敏记录。

## 功能

- 管理员创建、禁用和重置本地账号
- 单条或批量提交 Key
- 完整 Key 使用 AES-256-GCM 加密保存
- 全局 HMAC 去重，不泄露原提交者
- 用户点击脱敏 Key 即复制并弹窗显示完整值
- 每 5 分钟同步上游状态、用量、消费站点数和采样时间
- Session/CSRF 上游适配器与自动重新登录
- Docker Compose 一键部署

## 本地开发

要求 Node.js 22、pnpm 10、Docker 和 Docker Compose。

```bash
cp .env.example .env
corepack enable
pnpm install
docker compose up -d postgres redis
DATABASE_URL=postgresql://keyhub:keyhub@localhost:5433/keyhub pnpm --filter @keyhub/database prisma:migrate
DATABASE_URL=postgresql://keyhub:keyhub@localhost:5433/keyhub ADMIN_USERNAME=admin ADMIN_PASSWORD='replace-this-password' pnpm --filter @keyhub/database seed
pnpm dev
```

Web 默认地址为 `http://localhost:5173`，API 为 `http://localhost:3000`。Vite 会把 `/api` 转发到 API。

## 生产部署

1. 从 `.env.example` 创建 `.env`。
2. 生成三个随机值，不要复用：

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -hex 32
```

3. 分别填入 `ENCRYPTION_KEY_BASE64`、`HMAC_KEY_BASE64` 和 `SESSION_SECRET`。
4. 设置至少 12 位的 `ADMIN_PASSWORD` 和独立的 `POSTGRES_PASSWORD`。
5. 启动：

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:8080/health/ready
```

`migrate` 服务会先应用 Prisma 迁移并创建或更新管理员账号，成功后 API 和 Worker 才启动。生产环境应在 Web 服务前配置 HTTPS 反向代理，并把 `WEB_ORIGIN` 设置为实际 HTTPS 域名。

## 使用现有 PostgreSQL 和 Redis

`docker-compose.external.yml` 仅启动 `migrate`、`api`、`worker` 和 `web`，不会创建 PostgreSQL、Redis 或相关数据卷。先从专用示例文件复制一份独立环境配置：

```bash
cp .env.external.example .env.external
```

编辑 `.env.external`，替换全部 `replace-with` 和 `example` 占位值后再继续。下面会把该文件加载到当前 shell，以便健康检查使用实际的 `WEB_PORT`；请确保值符合 POSIX shell 赋值语法，并对 URL 用户名或密码中的特殊字符进行 URL 编码。

```bash
set -a
. ./.env.external
set +a
docker compose --env-file .env.external -f docker-compose.external.yml config --quiet
```

本地开发或从源码构建时执行：

```bash
docker compose --env-file .env.external -f docker-compose.external.yml up -d --build
docker compose --env-file .env.external -f docker-compose.external.yml ps
curl -fsS "http://localhost:${WEB_PORT:-8080}/health/ready"
```

生产环境使用公开镜像部署时执行：

```bash
docker compose --env-file .env.external -f docker-compose.external.yml pull
docker compose --env-file .env.external -f docker-compose.external.yml up -d --no-build
docker compose --env-file .env.external -f docker-compose.external.yml ps
curl -fsS "http://localhost:${WEB_PORT:-8080}/health/ready"
```

首次成功运行镜像发布 workflow 后，需要在 GitHub Packages 中分别把 `keyhub-api`、`keyhub-worker` 和 `keyhub-web` 的 Visibility 手动改为 Public；workflow 不会自动修改可见性。完成后拉取公开镜像无需 `docker login`。`latest` 始终跟随 `main`；生产环境需要固定版本或回滚时，可在 `.env.external` 中将 `KEYHUB_API_IMAGE`、`KEYHUB_WORKER_IMAGE` 和 `KEYHUB_WEB_IMAGE` 同时设为同一提交对应的 `sha-<commit>` 标签。

`config --quiet` 只校验配置；不要把完整的 `docker compose config` 输出粘贴到日志或工单，因为展开后的配置包含秘密。

`DATABASE_URL` 和 `REDIS_URL` 必须指向容器内可访问的地址，其主机部分可填写对应服务的服务器私网地址或可解析的内部 DNS 名；容器内的 `localhost` 指向容器自身，并非宿主机。`host.docker.internal` 仅在平台支持时可用；对于同一台服务器上的 Docker Engine，只有显式添加 `host-gateway` 映射后才能使用相应别名，当前 `docker-compose.external.yml` 未自动配置该映射。宿主机上的 PostgreSQL 和 Redis 必须监听容器可达的私网或 bridge 接口，不能只监听 `127.0.0.1`；同时应通过数据库访问控制和防火墙把来源限制到所需容器网络，绝不能为了连通性将服务暴露到公网。

外部数据库必须预先创建，且连接账号需要具备执行 Prisma 迁移的权限；Redis 的认证信息和 TLS 配置应写入完整的 `REDIS_URL`。

迁移或恢复已有数据时，必须同时保留并继续使用原来的 `ENCRYPTION_KEY_BASE64` 和 `HMAC_KEY_BASE64`：前者用于解密历史 Key，后者用于保持 Key 去重指纹稳定。

## 上游配置

上游账号有两种配置方式：在 `.env.external` 中同时设置 `UPSTREAM_ACCOUNT` 和 `UPSTREAM_PASSWORD`，或者使用管理员账号登录 KeyHub 后在 `Upstream` 页面填写。环境变量存在时优先使用；否则使用 PostgreSQL 中加密保存的后台配置。不要只设置其中一个变量。

Worker 启动时会自动连接当前配置的上游账号，并根据 `Claude` 渠道的官方来源标识选择渠道。使用环境变量账号时，启动阶段会先清除上一次账号留下的渠道 ID，避免跨账号复用。连接成功后会重新入队此前仍为 `PENDING`，以及因渠道不可用而失败的 Key。若上游要求验证码，连接状态会变为阻塞，自动任务不会绕过验证码。

上游没有公开接口文档，当前适配器契约需要在上线前使用获授权账号做一次受控抓包校准。路径、字段、Cookie/CSRF 假设和确认清单见 `docs/upstream-contract.md`；抓包文件、真实 Cookie 和完整 Key 不得提交到仓库。

## 验证

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://keyhub:keyhub@localhost:5433/keyhub \
REDIS_URL=redis://localhost:6380 \
SESSION_SECRET=0123456789abcdef0123456789abcdef \
ENCRYPTION_KEY_BASE64=AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM= \
HMAC_KEY_BASE64=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= \
pnpm test
pnpm build
docker compose config
```

端到端测试使用 Playwright 自带的 Chromium，并要求完整 Compose 栈已经在 `http://localhost:8080` 运行。测试进程还会从宿主机直接访问 PostgreSQL；同时必须加载与 Compose 相同的加密配置，否则无法解密测试创建的 Key：

```bash
docker compose up -d --build
docker compose ps
set -a
. ./.env
set +a
export DATABASE_URL="postgresql://keyhub:${POSTGRES_PASSWORD:-keyhub}@localhost:${POSTGRES_PORT:-5433}/keyhub"
export REDIS_URL="redis://localhost:${REDIS_PORT:-6380}"
export E2E_BASE_URL="http://localhost:${WEB_PORT:-8080}"
pnpm exec playwright install chromium
pnpm test:e2e
```

当前 E2E 覆盖普通用户之间的 Key 列表与 reveal 隔离，以及所有者点击脱敏 Key 查看完整值。真实上游提交、状态和用量同步仍需使用获授权账号联调，不在本地 E2E 覆盖范围内。

## 备份

数据库备份包含加密后的完整 Key。恢复时必须同时具备原 `ENCRYPTION_KEY_BASE64` 和 `HMAC_KEY_BASE64`：前者用于解密历史数据，后者用于保持历史 Key 的去重一致性。

```bash
docker compose exec -T postgres pg_dump -U keyhub keyhub > keyhub.sql
docker compose exec -T postgres psql -U keyhub keyhub < keyhub.sql
```

不要把 `.env`、真实 Key、Cookie、Session、CSRF Token 或数据库备份提交到 Git。

本地启动:

```bash
docker compose --env-file .env.external -f docker-compose.external.yml build
docker compose --env-file .env.external -f docker-compose.external.yml up
```
服务器启动:
先push 代码github action build
服务器执行 shell 脚本