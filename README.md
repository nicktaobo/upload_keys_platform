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

## 上游配置

使用管理员账号登录 KeyHub，进入 `Upstream` 页面填写获授权的百一灵枢供应商账号和密码。凭据加密后保存，Worker 会登录并自动选择 `ModelBoxs-Claude-按量（Claude 官方）` 渠道。若上游要求验证码，连接状态会变为阻塞，自动任务不会绕过验证码。

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

## 备份

数据库备份包含加密后的完整 Key。恢复时必须同时具备原 `ENCRYPTION_KEY_BASE64`，否则无法解密历史数据。

```bash
docker compose exec -T postgres pg_dump -U keyhub keyhub > keyhub.sql
docker compose exec -T postgres psql -U keyhub keyhub < keyhub.sql
```

不要把 `.env`、真实 Key、Cookie、Session、CSRF Token 或数据库备份提交到 Git。
