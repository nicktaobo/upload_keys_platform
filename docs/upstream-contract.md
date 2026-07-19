# KeyHub 上游 JSON 契约

本文档记录 `packages/upstream` 当前实现所依赖的上游 JSON 接口假设，以及上线前必须通过获授权账号抓包确认的内容。上游接口没有公开授权文档，因此这里的路径和字段不是稳定的公共 API；任何真实账号、密码、Key、Cookie、Session ID、CSRF Token 或完整响应都不得写入本文档或提交到 Git。

## 1. 配置与边界

- 上游站点根地址由环境变量 `UPSTREAM_BASE_URL` 提供。文档中统一写作 `<UPSTREAM_BASE_URL>`，不要在代码外另行硬编码真实地址。
- 适配器当前固定在根地址后追加 `/api/v1`，最终请求地址为 `<UPSTREAM_BASE_URL>/api/v1/<relative-path>`。
- 默认请求超时为 10 秒。`SupplierPortalClient` 可通过构造参数 `timeoutMs` 覆盖；该值目前没有独立环境变量。
- 上游用户名和密码可由 Worker 的 `UPSTREAM_ACCOUNT` 与 `UPSTREAM_PASSWORD` 环境变量成对提供，也可由管理员在 KeyHub 的 Upstream 页面录入并加密存入 PostgreSQL。环境变量优先；未设置时回退到数据库配置。浏览器只调用 KeyHub API，不直接访问上游。
- 第一版只使用一个共享上游账号，并自动选择名称包含 `Claude` 且 `source_type` 为 `official` 的渠道。下游用户不能选择渠道。
- `channelId` 在 URL 中进行百分号编码，列表游标通过 `URLSearchParams` 编码。

与上游地址直接相关的 `.env` 配置只使用非敏感占位符：

```dotenv
UPSTREAM_BASE_URL=<authorized-upstream-origin>
UPSTREAM_ACCOUNT=<supplier-username>
UPSTREAM_PASSWORD=<supplier-password>
```

真实凭据只放在被 Git 忽略的部署环境文件或秘密管理系统中；不要把它们放入 `.env.example`、测试 fixture 或提交到 Git。

## 2. 认证与会话

### 2.1 当前登录假设

```http
POST <UPSTREAM_BASE_URL>/api/v1/auth/login
Accept: application/json
Content-Type: application/json

{
  "username": "<supplier-username>",
  "password": "<supplier-password>"
}
```

适配器当前认为登录成功必须同时满足：

1. HTTP 响应为 `2xx`；
2. JSON 是对象，且 `success` 不等于 `false`；
3. 响应 `Set-Cookie` 中同时得到名为 `sessionid` 和 `csrftoken` 的 Cookie。

Cookie jar 仅保存在当前 `SupplierPortalClient` 实例的内存中，不写入数据库或返回浏览器。后续请求发送当前 jar 中的全部 Cookie。所有带 JSON body 的写请求还发送：

```http
X-CSRFToken: <value-of-csrftoken-cookie>
```

登录请求不发送 CSRF Header。若写请求前实例中没有 `csrftoken`，适配器会直接抛出 `UpstreamContractError("CSRF session")`，因此调用方必须先在同一个 client 实例上完成登录。

### 2.2 会话续期

- 任意业务请求返回 `401` 时，适配器重新登录一次，并只重试原请求一次。
- `403` 只有在 JSON 的 `code`、`error` 或 `detail` 字符串明确同时表达 `session/csrf/auth` 与 `expired/invalid` 时才触发一次重新登录。
- 未识别的 `403` 不会续登，直接成为带 HTTP 状态码的 `UpstreamHttpError`。
- 续登后的重试仍失败时不再循环。
- 连接任务登录失败后将上游连接标为 `BLOCKED`，只保存通用失败码和脱敏中文提示。

### 2.3 CAPTCHA

登录 JSON 出现以下任一信号时，适配器抛出 `CaptchaRequiredError`：

- `captcha_required: true`
- `requires_captcha: true`
- `code`、`error` 或 `detail` 字符串包含不区分大小写的 `captcha`

KeyHub 不尝试识别、绕过或自动求解 CAPTCHA。遇到该情况应暂停相关自动化，由管理员人工处理上游认证状态。

## 3. 当前相对路径

下表是代码当前实现的相对路径，不代表上游已承诺的稳定接口。上线前必须逐项抓包确认。

| 操作 | 方法与相对路径 | 当前使用情况 |
| --- | --- | --- |
| 登录 | `POST /api/v1/auth/login` | 连接与会话续期 |
| 查询渠道 | `GET /api/v1/supplier-portal/channels/` | 连接时解析固定 Claude 官方渠道 |
| 提交 Key | `POST /api/v1/supplier-portal/channels/{channelId}/items/submit/` | 提交 Worker |
| 查询 Key 列表 | `GET /api/v1/supplier-portal/channels/{channelId}/items/?cursor={cursor}` | 五分钟同步与手动同步 |
| 查询批次汇总 | `GET /api/v1/supplier-portal/channels/{channelId}/batch-summary/` | 适配器已实现，当前 Worker 未调用 |
| 查询批次备注 | `GET /api/v1/supplier-portal/channels/{channelId}/batch-notes/` | 适配器已实现，当前 Worker 未调用 |

## 4. 请求与响应契约

### 4.1 渠道列表

当前接受数组、带 `results` 的对象，或真实上游的 supplier-scoped `channels` 对象：

```json
[
  { "id": "<channel-id>", "name": "<channel-name>" }
]
```

或：

```json
{
  "results": [
    { "id": "<channel-id>", "name": "<channel-name>" }
  ]
}
```

真实上游格式：

```json
{
  "supplier_id": "<supplier-id>",
  "channels": [
    {
      "id": "<channel-id>",
      "name": "ModelBoxs-Claude-按量",
      "source_type": "official"
    }
  ],
  "empty_reason": null
}
```

`id` 可为字符串或数字，进入 KeyHub 后统一转为字符串。`name` 必须为字符串，`source_type` 映射为稳定字段 `sourceType`。Worker 选择第一个名称包含 `Claude` 且 `sourceType === "official"` 的渠道，并把其 ID 保存到主上游连接记录。

### 4.2 提交 Key

当前请求 body：

```json
{
  "rows": [
    {
      "row_id": "<generated-uuid>",
      "official_credential": {
        "api_key": "<full-key>"
      },
      "quota_unlimited": true,
      "consumption_time_follow_parent": false,
      "consumption_time_hours": 24
    }
  ]
}
```

`SupplierPortalClient` 的内部调用接口仍使用 `{ apiKey, warrantyHours }`，发送前为每行生成 UUID `row_id` 并映射为上面的真实上游字段。当前共享渠道为后付费渠道，因此 `quota_unlimited` 固定为 `true`，不发送 `quota_limit`。虽然适配器支持数组，当前提交 Worker 每个任务只发送一行。完整 Key 只在 Worker 解密后用于该请求，不应进入日志、错误消息或任务 payload。

当前接受的响应：

```json
{
  "results": [
    {
      "row_id": "<generated-uuid>",
      "status": "submitted",
      "message": "<optional-message>",
      "item": {
        "id": "<upstream-item-id>"
      }
    }
  ]
}
```

每行 `status` 只能为 `submitted` 或 `failed`；`item.id` 可为字符串或数字并统一转为字符串。适配器要求响应中的 `row_id` 与请求逐行一一对应，不接受未知、重复或缺失的行；只有全部匹配行均为 `submitted` 且存在 item ID 时才输出稳定字段 `success: true`。对于完成关联的 `failed` 行，适配器按请求顺序取第一个 failed row；其 `message` 非空时保留，在替换 Key-like 内容并限制长度后交给 Worker；空白时 Worker 使用 fallback，不继续寻找后续行。Worker 将明确拒绝标记为 `TEST_FAILED`，把该原因保存到 Key 和 JobRun。普通用户和管理员的 Key 列表都会显示已保存的失败原因。

### 4.3 Key 列表与分页

当前接受真实上游的 `items` 对象：

```json
{
  "items": [
    {
      "id": "<upstream-item-id>",
      "access_test_status": "success",
      "usage_amount": "1.250000",
      "usage_site_count": 2,
      "usage_sampled_at": "<timestamp>"
    }
  ]
}
```

为兼容旧契约，也接受裸数组：

```json
[
  {
    "id": "<upstream-item-id>",
    "status": "<upstream-status>",
    "usage_usd": 1.25,
    "usage_site_count": 2,
    "sampled_at": "<timestamp>"
  }
]
```

也接受分页对象：

```json
{
  "results": [],
  "next": "<next-cursor-or-null>",
  "next_cursor": "<next-cursor-or-null>"
}
```

字段映射如下：

| 上游字段 | 兼容别名 | KeyHub 字段 | 约束 |
| --- | --- | --- | --- |
| `id` | 无 | `id` | 必填；字符串或数字，统一为字符串 |
| `access_test_status` | `status` | `status` | 可选字符串；`success`、`failed`、`testing`、`untested` 分别规范化为现有本地状态文本 |
| `usage_amount` | `usage_usd`、`usageUsd` | `usageUsd` | 可选非负数字或十进制数字字符串 |
| `usage_site_count` | `usageSiteCount` | `usageSiteCount` | 可选非负整数 |
| `usage_sampled_at` | `sampled_at`、`sampledAt` | `sampledAt` | 可选字符串；Worker 只保存可解析日期 |
| `next_cursor` | `next` | `nextCursor` | 可选字符串或 `null` |

真实 `items` 对象和裸数组视为没有下一页。兼容的 `results` 分页对象同时提供 `next_cursor` 和 `next` 时，当前优先使用 `next_cursor`。同步最多读取 100 页，之后不再继续。同步只按已保存的 `upstreamItemId` 匹配本地记录；未映射的上游记录会被忽略，按用户手动同步时还会额外限制 `ownerId`。

### 4.4 批次汇总

当前响应必须至少包含以下一个已识别字段：`total`、`healthy`、`usage_usd` 或 `usageUsd`。`total`、`healthy` 必须为非负整数；用量必须为非负数字。额外字段会被保留在校验阶段但不会进入稳定输出。

```json
{
  "total": 10,
  "healthy": 8,
  "usage_usd": 12.5
}
```

当前 Worker 不使用该接口计算用户汇总；用户汇总来自已同步到 PostgreSQL 的本地记录。

### 4.5 批次备注

当前接受裸数组或 `{ "results": [...] }`。每项必须有字符串/数字 `id`，并至少提供 `message` 或 `note` 字符串；稳定输出统一为 `{ id, message }`。

```json
{
  "results": [
    { "id": "<note-id>", "message": "<sanitized-note>" }
  ]
}
```

当前 Worker 未消费或持久化批次备注。

## 5. 超时、重试与契约错误

- 请求被 `AbortController` 超时中止时抛出 `UpstreamHttpError`，错误码为 `TIMEOUT`。
- DNS、连接和其他 fetch 异常映射为 `NETWORK_ERROR`。
- 非 `2xx` 响应只保留 HTTP 状态码，映射为 `HTTP_ERROR`；响应 body 不进入 Error。
- `2xx` 但 JSON 无法解析或不符合对应 Zod schema 时抛出 `UpstreamContractError`。错误只包含契约名称，不包含原始 payload 或校验详情。
- 提交队列目前配置最多 3 次尝试，指数退避起始值为 1 秒；管理员手动重试使用相同配置。
- Worker 启动连接任务最多尝试 3 次，指数退避起始值为 1 秒；管理员手动连接仍只尝试 1 次。同步队列没有显式业务重试配置。
- 适配器自身除一次会话续登外不重试网络错误、超时、`5xx` 或普通 `4xx`；这些重试由队列层决定。

契约错误代表上游行为已经变化，不能通过猜测字段继续处理。应保留最后一次有效的本地数据，并由管理员检查抓包与适配器版本。

## 6. 日志与脱敏

以下内容禁止写入应用日志、错误消息、JobRun、管理员失败详情或测试快照：

- 上游用户名和密码；
- 完整 Key、加密后的 Key、IV 和认证标签；
- `Cookie`、`Set-Cookie`、`sessionid`、`csrftoken` 和 `X-CSRFToken`；
- 上游原始错误响应及可能含敏感信息的响应字段；完成行关联并经过 Key-like 脱敏和长度限制的提交拒绝 `message` 除外；
- 带 query/body/header 的完整请求转储。

当前适配器错误类型只暴露通用文本、错误分类和可选 HTTP 状态码，并有测试保证超时及 HTTP 错误不会串入凭据、Cookie、CSRF 或 Key-like 值。明确的逐行业务拒绝可保存上游英文原因，但必须先替换 Key-like 内容并限制长度；网络、登录和契约错误仍使用固定脱敏文本。API 当前关闭 Fastify logger；未来启用结构化日志时，必须先对上述字段名和 Key-like 值配置递归脱敏，并添加回归测试。

调试真实接口时，只记录方法、经过模板化的相对路径、HTTP 状态码、耗时、契约名称和关联 ID。抓包文件必须存放在仓库之外；用于测试的 fixture 应手工合成或彻底脱敏。

## 7. 上线前抓包确认清单

以下内容尚不能仅凭当前代码视为已确认。联调应在账号所有者明确授权、仅访问其自身数据的前提下完成：

- 登录、渠道、提交、列表、汇总和备注的真实方法及相对路径，包括末尾斜杠和 API 前缀；
- 登录请求字段名、是否需要额外 Header、Origin/Referer，以及成功/失败 JSON；
- Session 与 CSRF Cookie 的真实名称、作用域、生命周期、刷新方式，以及 CSRF Header 的真实名称；
- CAPTCHA 的触发状态码和 JSON 信号，是否还有设备验证或二次认证；
- 渠道的稳定识别字段。不要长期依赖展示名称模糊匹配；若有稳定代码字段，应改用稳定字段；
- 提交 body 的容器字段、Key 字段、保修时长单位/范围、单批上限、重复提交语义和逐行错误格式；
- 提交成功后 item ID 的字段名、顺序是否与 rows 对应，以及部分成功时的返回结构；
- 列表项中 status、测试结果、访问状态、用量、站点数、采样时间和 Key 标识的准确字段与枚举；
- 分页采用游标、页码还是绝对 `next` URL，游标是否允许直接回传，是否存在总页数/终止标记；
- 金额单位及精度，时间戳时区和格式，空值与缺失字段的区别；
- 限流状态码与响应头、请求超时建议、`429`/`5xx` 的退避要求；
- Session 过期和 CSRF 失效的实际状态码/错误码，续登后原写请求是否允许安全重放；
- 批次汇总和备注是否确实需要；若不需要，应从生产调用面与适配器中移除；
- 上游是否提供可靠的幂等键或客户端请求 ID。未确认前，超时后的提交不能假设“未成功”。

## 8. 当前实现注意事项

- `SupplierPortalClient` 的 Cookie jar 只属于单个实例。连接任务创建的实例结束后，其会话不会自动共享给后续提交或同步任务。
- Worker 每次启动都会为环境变量或数据库凭据安排一次连接任务。使用环境变量凭据时，会在启动 submission Worker 前清空数据库中的旧渠道 ID；重新识别成功后才恢复待处理记录。
- Worker 为每个提交或同步任务创建独立 client，并在业务请求前显式调用一次 `login()`。之后若收到可识别的 `401/403`，client 仍只自动续登并重试原请求一次；不会无限续登。
- 当前同步只依赖响应中的 `id` 与本地 `upstreamItemId`。设计稿提到的 HMAC/尾号二次匹配和“提交结果不明确时先查询再重试”尚未在 Worker 中实现，不能把它们当作现有保障。
- 当前连接处理把 CAPTCHA、契约不兼容、网络错误和渠道未找到统一保存为 `UPSTREAM_LOGIN_FAILED`。若运维需要准确区分阻塞原因，应在保持脱敏的前提下增加分类映射。
- 当前定时同步每 5 分钟执行一次，最多抓取 100 页；上游分页规模或限流策略确认后需要重新评估该上限。

每次真实抓包确认后，应先更新本文件和合成 fixture，再修改契约 schema 与 Worker，并运行适配器、Worker 和端到端回归测试。
