# 关联公开原帖

`social-posts.json` 是站点编辑维护的公开链接清单。它不保存原帖正文、照片、点赞数或评论内容。每条记录关联一个已有地点，由平台官方嵌入展示；不会自动搜索所有平台，也不等于收录完整评论区。

## 当前收录

核对日：2026-11-26。当前 **1 条 Facebook 官方动态，0 条旅友原帖**。Threads、Instagram 暂无通过核对的相关原帖；不使用虚构内容填充。

| 地点 | 原帖 | 类型与依据 |
| --- | --- | --- |
| 國立臺灣博物館（`Attraction_379000000A_000022`） | [NTMuseum 公开帖](https://www.facebook.com/NTMuseum/posts/10158042481711193/) | `official`。文化部[臺博精靈帽活动页](https://event.culture.tw/NTM/portal/Registration/C0103MAction?actId=12246)直接链接该馆粉专开箱帖，说明活动已结束；页面标注为官方历史分享。核对日 Meta 官方公开 oEmbed 请求返回 HTTP 200、非空嵌入 HTML、provider=Facebook；只检查可嵌入状态，未保存返回内容。浏览器呈现仍可能受到登录、地区、平台可用性或后续删除影响。 |

本轮对台南餐馆的公开 Threads、Instagram、Facebook 原帖检索未得到足以核对地点与当前可展示性的结果，未将旅游资料页、搜索摘要、登录页或店家主页冒充具体原帖收录。

## 新增记录

每条记录需要：

- `placeId`：`places.json` 中已有稳定地点 ID。
- `url`：具体公开帖永久链接；不收资料主页、私密群、Stories、跳转分享短链或任意 HTML。
- `curatedAt`：核对日期，`YYYY-MM-DD`。
- `kind`：`official`（场馆/店家官方动态）或 `traveler`（旅友原帖）。类型仅区分来源，不认证体验真实性或商业合作情况。
- `label`：可选、最多 120 字，本站编辑填写的简短关联说明，不能复制帖子正文或编造评分。

先核对名称、分店、行政区和来源，再验证公开链接；只有搜索命中、链接格式正确或同名店，均不足以关联。历史活动应标明已结束，不当作近期营业/活动信息。无法确认就不收录。

## 展示机制

`SocialEmbeds.renderPlace(container, {placeId, posts})` 生成只读原帖列表和全部 / Threads / Facebook / Instagram 筛选。官方动态、旅友原帖分别标注。每张卡片保留原文链接；用户点击“显示原帖”才加载外部官方嵌入，避免地点页打开时批量请求各平台。

Facebook 使用官方 `facebook.com/plugins/post.php` 或 `video.php`；Instagram / Threads 使用经过精确链接校验的官方 blockquote 标记与固定 `embed.js`。不接收或执行使用者提供的 HTML，不提取或重新发布平台内容，不持久保存 SDK 返回数据。脚本每平台加载一次；切换地点后重新处理新挂载的原帖。

`normalizePostUrl(value)` 返回 `{platform, url}` 或 `null`；`validEntries(rows, optionalPlaceIds)` 校验并去重；`mount(container, entry)` 返回可等待的清理函数；`renderPlace(...)` 返回 `{count, destroy}`。原帖删除或无法加载时，仍保留外链，不把 SDK 加载完成宣称为原帖必然可见。

官方参考：[Meta 公开嵌入更新](https://developers.facebook.com/docs/graph-api/reference/oembed-post)、[Facebook Embedded Posts](https://developers.facebook.com/documentation/plugins/embedded-posts)、[Threads 嵌入](https://developers.facebook.com/docs/threads/tools-and-resources/embed-a-threads-post)、[Meta 官方跨平台嵌入项目](https://github.com/meta/meta-embeds-for-wordpress)。旧版文档中的 token / App Review 要求应结合 2026-06-15 公布的新规则判断。嵌入许可不等于关键词搜索、导出、分析或建立评论数据库的许可。
