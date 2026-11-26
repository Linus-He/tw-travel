# 岛屿漫游：公共社区后端

这是 Cloudflare Worker + D1 API，供现有 GitHub Pages 前端使用。没有第三方登录、邮箱或付费依赖，不需要把地图迁走。未部署、未绑定 D1 或未迁移数据库时，`/health` 返回 503，不能把这种状态显示成“已启用公共社区”。

## 身份与内容边界

- 访客设置昵称后，服务返回 256 位随机投稿令牌；D1 仅保存 SHA-256 摘要。昵称不代表实名或到店认证。
- 已发表的评价和笔记公开可读，其他设备能看到。修改、删除和恢复内容需要原投稿令牌；没有跨设备账号找回功能。
- 前端应把令牌单独保存在当前浏览器中，不加入可公开分享的笔记备份，不放在 URL、日志或 GitHub 源码中。
- 原来保存在本机的收藏、评价和笔记不会自动发布。公开发表必须由用户主动提交。
- 每个投稿身份对每个地点只有一条公开评价；再次提交会更新原评价。隐藏内容经作者编辑仍保持隐藏。
- 删除为可恢复的软删除。公共查询排除 `deleted_at` 或 `hidden_at` 不为空的内容；本人内容查询会带回这两个状态。

## 配置与部署

`src/index.js` 是自包含 Worker ES Module，可直接用于 Cloudflare 控制台编辑器。它只包含公开地点 ID / 城市允许列表，不包含地点授权密钥或用户内容。

1. 在 Cloudflare 创建 D1 数据库 `tw-travel-community`。
2. 使用控制台 SQL 导入 `migrations/0001_init.sql`，或使用 Wrangler 应用迁移。不要在已有同名表的数据库上重复运行初始化 SQL。
3. 创建 Worker `tw-travel-community`，部署 `src/index.js`。
4. 为 Worker 添加 D1 binding，变量名必须为 **`DB`**，绑定上一步的数据库。
5. 设置普通变量 **`ALLOWED_ORIGIN=https://linus-he.github.io`**，值为 origin，不包含 `/tw-travel/` 路径和尾斜杠。
6. 建议设置随机私有 secret **`RATE_LIMIT_SALT`**，用于每日 IP 散列。没有该 secret 时仍可运行，但固定后备盐的隐私保护较弱。它不应进入浏览器配置。
7. 发布后检查 `https://实际Worker域名/health` 应返回 `{"ok":true,"storage":"ready"}`；再将实际 Worker URL 填入前端社区 API 配置。

也可在已有 Cloudflare 登录的开发环境执行：

```sh
cd community-worker
npx wrangler@4 d1 create tw-travel-community
```

将返回的数据库 ID 填入 `wrangler.jsonc` 后：

```sh
npx wrangler@4 d1 migrations apply tw-travel-community --remote
npx wrangler@4 secret put RATE_LIMIT_SALT
npx wrangler@4 deploy
```

`wrangler.jsonc` 的数据库 ID 目前是明确占位符，不能原样部署。数据库 ID 不是访问令牌；Worker 的公开 URL 也不是 secret。

## API 约定

所有返回均为 JSON。时间为 UTC ISO 8601。受限写入返回 `429` 及 `Retry-After`；参数错误 `400`，身份缺失或失效 `401`，来源不允许 `403`，内容不存在或不属于当前身份 `404`，服务未就绪 `503`。失败响应形如 `{"error":{"code":"invalid_request","message":"…"}}`。

写请求必须带允许的 `Origin`。创建/更新请求还需 `Content-Type: application/json`，正文最多 32 KiB。`DELETE` 可不带正文；若带正文只允许空 JSON 对象。恢复请求为 `POST`，正文为空对象 `{}`。

| 操作 | 路径及正文 | 返回 |
| --- | --- | --- |
| 服务检查 | `GET /health` | `{ok,storage}`，核对全部 5 个业务表 |
| 创建投稿身份 | `POST /v1/session`，`{nickname}` | `{token,author:{id,nickname,createdAt}}` |
| 读取当前身份 | `GET /v1/me` | `{author}` |
| 所有地点评分 | `GET /v1/ratings` | `{ratings:{[placeId]:{average,count}}}` |
| 地点评价、笔记 | `GET /v1/places/{placeId}/community` | `{rating,reviews,guides}`，各最新 20 条 |
| 社区笔记列表 | `GET /v1/guides?city=台南` | `{guides}`，最新 30 条；city 可省略 |
| 本人内容 | `GET /v1/me/content` | `{reviews,guides}`，含软删除及隐藏状态，各最新 100 条 |
| 发表/更新地点评价 | `POST /v1/reviews`，`{placeId,stars,text}` | `{review}` |
| 编辑评价 | `PATCH /v1/reviews/{id}`，`{stars?,text?}` | `{review}` |
| 发表笔记 | `POST /v1/guides`，`{placeId?,city,title,body}` | `{guide}` |
| 编辑笔记 | `PATCH /v1/guides/{id}`，上述字段的非空子集 | `{guide}` |
| 删除本人内容 | `DELETE /v1/reviews/{id}` 或 `/v1/guides/{id}` | `{review}` / `{guide}` |
| 恢复本人内容 | `POST /v1/reviews/{id}/restore` 或 `/v1/guides/{id}/restore`，`{}` | `{review}` / `{guide}` |
| 举报 | `POST /v1/reports`，`{type:"review"或"guide",id,reason}` | `{ok,message}`，不公开举报人信息 |

除公开读取、服务检查和创建身份外，以上操作均需 `Authorization: Bearer 令牌`。公共内容字段包括 `id,placeId,authorId,nickname,createdAt,updatedAt`；评价另有 `stars,text`，笔记另有 `city,title,body`。只有本人查询和本人写操作响应附带 `deletedAt,hiddenAt`。

字段限制：昵称 2–24 字；评分整数 1–5；评价 10–2000 字；笔记标题 4–100 字、正文 40–10000 字；举报原因 5–500 字。笔记可不关联地点，但须填写城市；已关联地点的城市必须一致。地点 ID 必须来自当前 200 条公开地点允许列表。字段为纯文本，前端必须用 `textContent` 或转义后展示，不解析用户 HTML。

## 用量与运营

- 每 IP 每 UTC 日最多新建 10 个投稿身份。
- 每 IP 每日最多 30 次内容写入，每身份每日最多 20 次；不同昵称或不同 IP 不会绕过另一侧的限制。
- 每 IP 与身份每日最多 10 次举报；同一身份对同一内容仅记录一条举报，不因举报数量自动下架。
- 依赖 Cloudflare 边缘提供的 `CF-Connecting-IP`；数据库仅保存每日散列计数，不保存原始 IP。新建身份时清理超过三天的限流计数。localhost 开发可使用本机后备标识，公网缺少可信边缘标识的写入返回 503。
- 本地开发可暂将 `ALLOWED_ORIGIN` 设为 `http://127.0.0.1:8000`；线上不要设任意来源或通配符。
- 这是一版轻量投稿系统，不等于完整防机器人系统。上线后应在 Cloudflare 控制台观察用量、处理举报；访问量上升时再增加 Turnstile 等措施。

运营者在 Cloudflare D1 控制台查看待处理举报：

```sql
SELECT id,target_type,target_id,reason,created_at
FROM reports WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 50;
```

核实后隐藏指定评价（笔记使用 `guides` 表）：

```sql
UPDATE reviews
SET hidden_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='已核实需要隐藏的内容ID';
```

恢复展示和标记举报已处理：

```sql
UPDATE reviews SET hidden_at=NULL WHERE id='已核实可恢复的内容ID';
UPDATE reports SET resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='已处理的举报ID';
```

这些操作只在已登录的 Cloudflare 管理控制台完成。没有公开的管理写接口，没有前端管理员密钥。实际内容删除/恢复仍以用户自己的删除状态为准，运营者清除 `hidden_at` 不会恢复作者已删除的内容。

## 本地验证

需要 Node 24（使用内置 SQLite，无需依赖安装）：

```sh
node --test community-worker/tests/*.test.mjs
```

测试使用真实内存 SQLite、真实迁移和 Worker 路由，验证跨客户端可见、归属校验、评分聚合、删除恢复、隐藏、举报去重、来源控制、大小限制及双重限流。Node 自带 SQLite 目前会打印实验性功能提示，与测试失败无关。测试不会连接 Cloudflare 或写入生产数据。

修改官方地点数据后，需同步 Worker 顶部的 `PLACE_CITIES` 允许列表，再重新发布。数据库迁移一经上线保持不变，后续结构变更新增迁移文件。
