# 岛屿漫游
台湾地图旅行攻略网站：[打开网站](https://linus-he.github.io/tw-travel/)。默认使用 OpenStreetMap + Leaflet，不需要地图密钥或 Google 结算。

## 界面与操作
- 黑白界面、原色地图与精简地点列表；地址、营业时间优先，出处和讨论入口可展开查看。
- 玻璃质感导航提供探索、收藏与笔记入口，手机端固定在底部，支持地图与列表切换。
- 使用系统字体与随站发布的 Lucide 图标，支持键盘操作、减少动态效果和减少透明度偏好。

## 真实地点与范围探索
当前 **6,710 个地点**：餐饮 6,570 个（台北 5,466、台南 1,104），并保留原有 140 个景点。台北餐饮来自 OpenStreetMap 市界范围内的具名餐馆、咖啡馆、快餐与美食街，仅收录有具体街道地址和坐标的点；台南采用官方美食资料，排除纯租车等非餐饮类别。此资料不是全部商家或推荐排名。

共 6,630 个地点有详细地址，2,407 个有来源营业时间，3,584 个有电话，933 个有网站。缺失字段保留空值；原始更新时间与快照取得时间分开记录，不提供实时营业判断、推测价格、虚构照片或第三方评分。

原有 200 个地点 ID 保留，台南仅按官方 ID 和精确店名补充字段。OSM 使用对象类型与对象 ID，分店不会按相似店名合并；近距离同名重复点按五位以下精度筛除，规则见脚本。公开评价与私人收藏继续对应原 ID。

© OpenStreetMap contributors。整合资料库 `places.json` 按 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) 公开提供；政府来源保留政府资料开放授权条款及署名。逐条出处和下载快照 SHA-256 见 `sources.json`。地图和资料库由社区及官方资料维护，不代表逐店已现场核实。

公共评价、共享笔记、作者编辑/撤回与举报功能保留，私人笔记不会上传。相关帖子功能目前仅有 1 条官方历史帖，尚无外部旅友评论库。

## 运行与验证
运行 `python3 -m http.server 8000`，访问 http://localhost:8000。

```sh
node --check app.js
node --check map.js
node --check ui.js
node --test tests/*.test.cjs community-worker/tests/*.test.mjs
python3 build-site.py
```

页面需联网加载 Leaflet、OSM 底图。地点数据来自随站发布的 JSON，不会在每次移动地图时调用第三方数据接口。OSM 保留可见版权署名，禁用批量预取；其公共瓦片服务无可用性保证，大流量需更换合适的服务。Lucide 使用 ISC 授权，详见 `LUCIDE-LICENSE`。

## 公共社区部署与运营
前端继续使用 GitHub Pages，`config.js` 中 `communityApiUrl` 指向 Cloudflare Worker。构建时可用 `COMMUNITY_API_URL` 覆盖。后端源码、数据库迁移和运营审核 SQL 见 `community-worker/README.md`。

公共社区支持每个投稿身份每店一条评价、聚合评分、旅行笔记、本人编辑、软删除与恢复，以及举报。服务端限制来源、内容长度和投稿频率，拒绝跨身份修改；公开接口不返回身份令牌、IP或举报人信息。运营者应定期查看 D1 的未处理举报并核实隐藏内容。

`island-notes` 备份只含私人记录，不包含公开投稿的编辑凭据。没有配置或无法连接服务时，界面会提示失败，不把本机保存显示成公开发表成功。

## 更新开放资料
先用 `import-places.py` 重建基础官方资料，再用 `enrich-places.py` 加入餐饮；两者均无需 API Key。不要只运行第一步后覆盖线上资料。此版本没有定时任务。

离线可复现：
```sh
python3 import-places.py --attractions-zip /tmp/taiwan-attractions.zip --restaurants-zip /tmp/taiwan-restaurants.zip --tainan-json /tmp/tainan-attractions.json --retrieved-at 2026-11-25
```

数据整理只在完整读取、校验后写出；取得时间和源数据更新时间独立。台南补充资料仅做本地 ID + 名称完全相符的合并。

## GitHub Pages
main 通过 `.github/workflows/deploy.yml` 自动测试、打包到 public/ 后发布。Pages Source 设为 GitHub Actions。`build-site.py` 只打包站点资产，脚本和测试不会成为网站文件。可在 Actions 手动 Run workflow 重试。

## 可选 Google 地图
暂时无需配置，默认免费 OSM。若以后切换，在 Google Cloud 关联结算、启用 Maps JavaScript API，创建仅允许 `https://linus-he.github.io/*` 和 Maps JavaScript API 的网站 Key。填入 GitHub Actions Repository Secret `GOOGLE_MAPS_API_KEY`，可选 Variable `GOOGLE_MAPS_MAP_ID`（未填时用 DEMO_MAP_ID 测试），再重新发布。浏览器 Key 对访客可见，Secret 仅避免源码提交，保护来自来源/API 限制。

餐饮扩充可复现命令：
```sh
python3 enrich-places.py --taipei-osm /tmp/tw-travel-enrichment/taipei-osm.json --tainan-dining /tmp/tw-travel-enrichment/tainan-dining.json --retrieved-at 2026-11-26
```
台南输入为 `https://www.twtainan.net/data/shops_zh-tw.json`。OSM 使用 Overpass 一次性查询：
```
[out:json][timeout:120];area["ISO3166-2"="TW-TPE"]["boundary"="administrative"]->.a;nwr["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]["name"](area.a);out center tags;
```
仅在更新快照时请求，不在用户移动地图时批量查询。每次扩充同时重生成 Worker 的允许地点表，再发布后端与前端。

## 高德独立验证页
`amap-lab.html` 是独立验证页面，直接加载高德 JS API 2.0 的底图热点、附近餐饮搜索与详情。它不读取本站 `places.json`，不写入社区数据库，也不保存输入的 Key、店家结果或安全密钥。未输入本人申请的 Key 时不会请求高德。

**台湾地区计费限制（2026-11-26 核实）**：高德官方公告 https://lbs.amap.com/news/yunyingcelue20261008 于2026-11-25更新，明确自2026-10-30起台湾用量和计费与大陆独立。月度累进方案起充¥12,000，月赠量仅对已购买有效技术服务许可的开发者开放；另有年度流量包。不可套用大陆基础搜索的个人免费月配额，也不能将独立验证页已上线称为已验证台湾接口可用。应先咨询商务确认权限、试用和价格，再决定是否开通。

若高德确认有适用的测试权限，开通步骤：在高德开放平台注册并完成个人开发者认证；应用管理 → 我的应用 → 创建应用 → 添加 Key，平台选 **Web端（JS API）**。将页面所在域名 `linus-he.github.io` 加入网站白名单，取得该 Key 对应的 securityJsCode，在验证页本地填写。若普通台湾图面不可用，再向高德确认是否需世界地图权限，不要仅凭底图可显示就认定搜索、详情和评分均可用。

此页直接使用安全密钥仅供本人临时调试，正式部署接入必须按高德官方指南使用安全代理并限制来源、频率与调用额度。当前没有账号 Key，尚未完成台湾地区实际接口验证；页面中的自动化检查使用模拟返回，不代表实际覆盖或评分可用。连接及每次搜索/详情会消耗高德账号配额，自动搜索默认关闭。

## Geoapify 动态地图验证
独立页面 `geoapify-lab.html`：Geoapify 彩色底图 + MapLibre，移动地图后按当前视野查询餐馆、咖啡馆或快餐，点击橙色标记读取详情。不会加载 `places.json`；每次最多 20 家，非全量店家展示。地图街区过大时提示放大，查询暂停一秒后触发，旧请求取消并隔离过期响应。每页店家请求（含详情）上限 60 次；底图消耗另计，不将请求数冒充免费积分数。

2026-11-26 已通过 Geoapify 官方 Places Playground 的正常界面各执行一次台北与台南范围的餐馆查询。台北返回無老鍋、博多拉麵、微笑老蕭拉麵等；台南返回赤崁208巷燒烤、姚燒鳥等。台南样本中的部分结果包含 `contact.phone` 和 `opening_hours`；未做逐店实地核实，也没有外部评分或评论。测试只在官方演示内进行，未复制或复用演示凭据。

本站验证页需要本人免费项目 Key：打开 https://myprojects.geoapify.com/ 注册，创建项目，取得 API Key，并将网站来源限制为 `https://linus-he.github.io`（按控制台支持的配置格式）。仅在页面填写，不要提交到 GitHub 或聊天。此页不保存 Key，不上传本站后台；未连接时不请求店家数据。免费计划当前为每天 3,000 积分、无需信用卡、允许在限额内用于生产并要求署名，来源 https://www.geoapify.com/pricing/ 。地图与搜索共享积分；超过上限需暂停或另行评估套餐，不自动开通付费服务。

官方演示：https://apidocs.geoapify.com/playground/places/ ；Places API：https://apidocs.geoapify.com/docs/places ；详情：https://apidocs.geoapify.com/docs/place-details 。免费额度及服务政策可能变化，应在连接前核对控制台。本轮尚未用本人 Key 完成本站页面端到端验证，不把官方演示成功冒充本站已接入成功。
