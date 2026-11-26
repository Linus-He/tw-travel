# 外部平台评分接入调研

核对日期：2026-11-26。当前网站使用 Leaflet + OpenStreetMap，部署在 GitHub Pages；尚未配置外部平台账号或密钥，尚未导入任何外部评分。

## 建议

产品目标是：访客在地图上点一家餐馆，即可在本站查看其他平台网友对该店的评价，同时浏览旅友原创笔记。访客不需要自行粘贴帖子链接。后台需要先完成店家与外部地点、Page、账号或帖子 ID 的准确关联，并取得允许公开展示的数据访问权限。

当前不依赖 Meta 企业验证的优先方案是 **Google Places UI Kit 官方评分与评论组件**：保留彩色 OSM 地图，在用户打开地点详情时加载官方组件。先核对 10–20 个地点，再扩大覆盖。社交平台官方嵌入可以补充后台已经关联的公开帖子，但不能单凭嵌入解决自动发现帖子、收齐评论或复制讨论树的需求。

这是工程建议，不代表已接入或已验证台湾地点覆盖率。没有实际账号和请求，无法保证现有 200 个地点都有匹配结果、评分或评论。

## 平台对比

| 来源 | 已核实的能力 | 条件及限制 | 对本站的适合程度 |
| --- | --- | --- | --- |
| Google Places UI Kit | 官方地点组件可显示评分，完整详情可显示评论；可定制颜色、字体和显示字段 | 需要 Cloud 结算、启用服务和网站受限 Key；保留 Google Maps 署名；产品当前仍有 Experimental/pre-GA 标记 | 优先试点，可与 OSM 一起使用 |
| 普通 Google Places API | `rating`、`userRatingCount`；`reviews` 最多 5 条 | 服务条款禁止与非 Google 地图结合；不能直接把 JSON 评分放入当前 OSM 侧栏 | 若要自绘评分界面，需另行调整地图方案与使用方式 |
| Tripadvisor Content API / Terra | 酒店、餐厅、景点的评分、评论、排名等内容 | 新 Terra 平台按套餐授权；品牌、缓存及竞争产品用途有限制；台湾具体命中率待实测 | 需官方确认本项目用途及适用套餐，不列为可立即接入的方案 |
| Threads 官方嵌入 | 已知公开帖子 URL 可转换为官方嵌入，展示原帖 | 2026-06-15 官方更新取消基础 oEmbed 的 token 与 App Review 要求；需要保留官方展示方式，不可把内容提取为独立数据库 | 优先用于公开讨论卡片；帖子链接由人工精选或用户提交 |
| Threads 关键词搜索 | 正式 API 可以检索公开帖子 | `threads_keyword_search` 官方允许用途限定为企业社媒管理，并明确禁止用于 consumer app；需要 OAuth 及审核不代表旅游聚合用途可获批 | 不适合直接作为本公众旅行站的自动聚合数据源，特殊用途需另行确认授权 |
| Facebook 主页公开帖子及留言 | Page Public Content Access 可读取未管理主页的公开帖文及评论，并允许展示帖文与互动 | 需要 App Review 和企业验证，按真实使用方式申报；不等于全网个人帖子搜索 | 有正式申请路径，但不作为无需企业验证的首版依赖 |
| Facebook 推荐／评价正文 | Page ratings 专用接口提供推荐内容 | 需要有该 Page 管理任务的人员授权的 Page token 和 `pages_read_user_content`；PPCA 不自动授予该专用接口全部权限 | 需商家授权，不能任意读取所有餐厅评价 |
| Instagram 公开讨论发现 | Hashtag Search 可找特定标签的公开媒体；Business Discovery 可读取其他专业账号的部分资料及媒体指标 | 需要专业账号、权限／功能审核；标签搜索每账号滚动 7 天最多 30 个不同标签，许可用途有限制；评论接口主要针对授权用户自己的媒体 | 不能作为任意店名全网检索及网友评论全文的通用来源 |
| Dcard | 本轮未找到可自助申请的通用门店评分接口 | 官方协议限制自动化收集；商业用途需事前书面同意 | 保留原文/搜索入口，批量内容先取得授权 |
| 小红书 | 登录平台当前仅开放 `basic_info`；`read_notes` 仍规划中；电商平台主要是商品、订单等能力 | 本轮未找到通用门店评分或任意公开笔记搜索的正式开放接口 | 保留搜索、人工精选原文链接，合作接口需另行洽谈 |

“未找到公开接口”不表示平台永远不提供商务授权。社交帖子里的点赞、收藏和讨论数量也不能换算成门店星级。

## Google：必须区分 UI Kit 与普通 API

[服务专用条款](https://cloud.google.com/maps-platform/terms/maps-service-terms)第 15.2 条限制普通 Places API 与非 Google 地图结合；第 16.1 条明确允许 Places UI Kit 与包括非 Google 地图在内的任何地图一起使用。第 16.3、16.4 条要求明确区分内容来源，遵守缓存/导出限制，不移除或遮挡 Google 署名、链接及通知。

因此，本项目建议嵌入官方 UI Kit 组件；不从组件内部提取评分 JSON 再自行绘制，不把评分批量写入 `places.json` 长期发布。

现有 200 条资料没有 Google Place ID。标准详情组件不接收自由文本店名；首批可使用官方 [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id#find-id) 逐个核对并保存 ID。扩展时可用 [UI Kit Place Search](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-search) 按店名、地区和位置偏好显示候选，由用户确认后交给详情组件；搜索与详情分别请求，按两次预算，不把普通 REST Text Search 的评分数据拿来配合 OSM 展示。坐标接近或搜索第一条并不足以证明是同一家店。

[官方精简组件示例](https://developers.google.com/maps/documentation/javascript/places-ui-kit/custom-styling)展示了仅包含名称、评分和署名的组合，能配合本站黑白界面。[接入步骤](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started)仍要求启用结算并设置 API Key。[产品概述](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview)当前包含 Experimental/pre-GA 说明，试点时应保留失败回退和外链入口。

## 免费额度不等于免结算

以下为核对日 Google 全球按量价格，美元/1,000 次；具体 SKU 由实际请求与组件功能决定，同一结算账户下的额度需按官方规则合并计算。

| SKU | 每月免费事件数 | 超额首档单价 |
| --- | ---: | ---: |
| Places UI Kit Query | 10,000 | US$1 |
| Places UI Kit Pro | 5,000 | US$5 |
| Place Details Enterprise（普通 API，含评分字段） | 1,000 | US$20 |
| Place Details Enterprise + Atmosphere（普通 API，含评论） | 1,000 | US$25 |

来源：[Google 官方价格表](https://developers.google.com/maps/billing-and-pricing/pricing)、[Place Details 字段与评论说明](https://developers.google.com/maps/documentation/places/web-service/place-details)。预算提醒不能替代请求配额和用量控制；列表不应一次为 200 个地点创建评分组件。

[Tripadvisor Content API 官方介绍](https://www.tripadvisor.com/business/solutions/hotels/content-api)仍列明每月前 5,000 次免费，但需要信用卡、超量计费及每日预算。其文档同时提示迁往 [Terra 新平台](https://docs.terra.tripadvisor.com/docs/overview)，后者按套餐提供内容和使用权；本轮没有确认新套餐价格，不能把旧额度直接当作新账号的确定报价。

[Terra 地点详情](https://docs.terra.tripadvisor.com/reference/locationget)明确包含旅行者评分。但[合作条款](https://developer-tripadvisor.com/partner/master-partnerships-terms-and-conditions/index.html)第 3.4.4(e) 限制竞争产品用途，并提到收集用户评价需书面许可。本项目计划提供用户评价，因此应先让 Tripadvisor 确认授权用途；这属于项目适用性判断，不能仅凭接口有评分就视为获准接入。展示、品牌、缓存和私有凭证保护也需落实。

## 社交平台证据

- [Facebook PPCA](https://developers.facebook.com/documentation/development/features-reference/page-public-content-access)明确包括其他主页的公开帖子、评论，要求审核与企业验证；[Page ratings 专用接口](https://developers.facebook.com/docs/graph-api/reference/page/ratings/)另要求 Page 管理任务与相关 token／权限。帖文留言、餐厅推荐正文、平均评分是三种不同能力，不能混为一种许可。
- [Instagram API 范围](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login)、[标签搜索](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search)、[公共内容功能用途](https://developers.facebook.com/documentation/development/features-reference/instagram-public-content-access)：技术上可读取标签媒体不代表获准作为面向游客的全网餐厅评论聚合。[Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery)也不能推导出任意网友评论全文的访问权。
- [Threads 权限说明](https://developers.facebook.com/documentation/development/permissions#threads_keyword_search)：搜索权限面向企业社媒管理，并明确禁止 consumer app 使用。仅阅读搜索接口文档和技术配额不足以判断本项目获准使用。上一轮将该权限直接列作旅行网站后续可申请来源，现更正。
- [Meta oEmbed 新规则](https://developers.facebook.com/docs/graph-api/reference/oembed-post)：2026-06-15 起，包括 Threads 在内的 oEmbed 基础调用取消 token 要求，不再要求 App Review；每 endpoint 每小时上限 1,000 次。已有审核权限者仍可使用 token 获取更高配额。部分旧版 Threads oEmbed 文档仍显示旧审核要求，应以这次更新为准。
- [Threads 官方嵌入说明](https://developers.facebook.com/docs/threads/tools-and-resources/embed-a-threads-post)：用于公开原帖的前端展示，可从帖子分享菜单复制嵌入代码；私密、失效、年龄限制及地域限制内容不支持。该接口不提供按地点检索，亦不允许把返回内容、元数据或其衍生数据用于分析或持久化成自有内容库。
- [Threads 关键词搜索](https://developers.facebook.com/documentation/threads/keyword-search)：每用户滚动 24 小时 2,200 次查询，未获批时仅能搜索本人帖子；这属于技术能力说明，不覆盖前述用途限制。若未来独立提供符合范围的企业运营工具，仍需按真实用途完成权限审核、验证及授权流程，token 不得提交到公开 GitHub 仓库。
- [Dcard 用户协议](https://www.dcard.tw/terms)：第六部分涉及自动化收集和商业使用限制；需要合作时使用[官方商务入口](https://about.dcard.tw/business)。网页内部接口可访问不代表获准公开再分发。
- [小红书登录权限范围](https://openaccount.xiaohongshu.com/docs/scope)：当前仅开放基本资料，读取笔记仍规划中；[电商应用权限](https://open.xiaohongshu.com/document/developer/file/33)不能当作通用旅行地点评分接口。

## 实施验收要求

1. 每个地点核对外部 ID、官方名称、行政区和坐标；分店歧义不自动认领，未匹配不显示评分。
2. 评分分别显示来源、分制与官方组件提供的评分人数；不把多个平台直接平均，也不混入当前仅存浏览器的个人体验评分。
3. 只在打开详情时请求；加载失败继续显示官方地点资料和导航链接，且不展示过期或虚构分数。
4. 浏览器 Key 限制来源和可用 API；含私有凭证的服务使用后端，不能靠 GitHub Secret 把前端运行时 Key 变成不可见。
5. 开通账号、结算和接受平台条款属于后续步骤；本次没有创建账户、填写支付资料或产生平台请求费用。

## Reddit（2026-11-26 复核）

[官方嵌入说明](https://support.reddithelp.com/hc/en-us/articles/360043033532-How-do-I-embed-a-Reddit-post-or-comment-in-an-article-or-other-publication)支持帖子及单条评论的 Share → Embed，也提供 oEmbed。适合后台将明确相关的原帖或评论链接关联到餐馆后，通过官方组件显示；不等于自动关键词搜索或导入整棵讨论。投票分数不能当餐厅星级。

[2026-10-08 官方变更日志](https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026)明确：2026-10-31 起停止接受新的 public API 访问请求；2027-01-12 开始移除未完成登记等要求的访问；2027-03 结束剩余 public API 访问。RSS 已于 2026-11-13 停止，不应推荐 RSS 作为替代。旧文档中的 OAuth 免费额度不能视为新项目当前可申请的许可。

本轮仅调研 Reddit，尚未接入或申请权限。若未来需要自动数据检索，应按[Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)如实提交站外、非商业旅行网站的用途咨询，等待官方确认，不能将 Devvit 或既有应用迁移登记当作站外聚合授权。
