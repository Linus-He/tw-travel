# 岛屿漫游
台湾地图旅行攻略网站：[打开网站](https://linus-he.github.io/tw-travel/)。默认使用 OpenStreetMap + Leaflet，不需要地图密钥或 Google 结算。

## 界面与操作
- 黑白界面、原色地图与精简地点列表；地址、营业时间优先，出处和讨论入口可展开查看。
- 玻璃质感导航提供探索、收藏与笔记入口，手机端固定在底部，支持地图与列表切换。
- 使用系统字体与随站发布的 Lucide 图标，支持键盘操作、减少动态效果和减少透明度偏好。

## 真实地点与范围探索
首批 **200 个真实地点**：台北 80 个景点，台南 60 个景点与 60 个餐饮地点。按官方来源 ID 与行政区轮选，覆盖台北 12 区、台南 37 区，**不是热门榜**。

- 城市、分类、关键词、收藏和地图范围可组合筛选；支持常见简繁体关键词。
- 移动或缩放地图后点击“搜索此区域”，列表采用当时视野的范围快照。继续移动不会偷偷更改列表，清除范围可恢复全部结果。
- 小比例尺聚合标记，点击数字放大；街道级展开单点，点击详情定位。
- 列表每次显示 30 条，支持加载更多。
- 详情保留官方名称、地址、坐标、来源营业时间、电话、出处、原始更新时间与独立收录日期。

资料来自[观光署景点](https://data.gov.tw/dataset/7777)、[观光署餐饮](https://data.gov.tw/dataset/7779)、[台南景点](https://data.gov.tw/dataset/6183)。按[政府资料开放授权条款第 1 版](https://data.gov.tw/license)使用，详细署名、下载地址、文件 SHA-256、处理规则见 `sources.json`，页面“资料来源与说明”也提供署名。

### 已知覆盖边界
- 本批次没有台北餐饮资料，不表示台北没有店家。台北详细街道地址在此次来源中缺失，保留缺失状态，只展示已知行政区。
- 120 条有详细地址，54 条有来源营业时间。没有实时营业状态，出发前请核实；个别来源更新时间较旧，不能把收录日当更新日。
- 未导入任何平台评分、评论和照片；列表不显示虚构评分或照片占位。分类为本站依据名称与来源类型整理，不表示官方推荐。
- 所有地点使用稳定官方 ID，旧版七个演示地点的 numeric 收藏/评价继续保存在导出备份中，不会混接到真实地点。
- 收藏、私人体验和私人笔记保存在当前浏览器，继续支持备份导入导出，不会自动上传。
- 新增独立的公共评价与旅友笔记，由 Cloudflare Worker + D1 保存，可跨设备读取。访客使用昵称主动公开发表；编辑、删除和恢复权限保存在发布设备，清除浏览器数据后需联系运营者处理。昵称不等于已核验身份或到店证明。
- 地点页支持 Threads、Facebook、Instagram 官方原帖嵌入，按需点击加载；内容由后台 `social-posts.json` 关联。当前只核实收录 1 条博物馆官方历史 Facebook 动态，0 条外部旅友评价，不代表三平台全网评论已接入。
- 官方动态与旅友原帖分别标注，来源说明见 `SOCIAL-CURATION.md`。帖文可能删除、设为私密或限制嵌入，始终保留原文入口。

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
无需 API Key，手动运行 `python3 import-places.py` 从官方来源刷新，审查 `places.json` / `sources.json` 后一起提交。此版本没有定时任务。

离线可复现：
```sh
python3 import-places.py --attractions-zip /tmp/taiwan-attractions.zip --restaurants-zip /tmp/taiwan-restaurants.zip --tainan-json /tmp/tainan-attractions.json --retrieved-at 2026-11-25
```

数据整理只在完整读取、校验后写出；取得时间和源数据更新时间独立。台南补充资料仅做本地 ID + 名称完全相符的合并。

## GitHub Pages
main 通过 `.github/workflows/deploy.yml` 自动测试、打包到 public/ 后发布。Pages Source 设为 GitHub Actions。`build-site.py` 只打包站点资产，脚本和测试不会成为网站文件。可在 Actions 手动 Run workflow 重试。

## 可选 Google 地图
暂时无需配置，默认免费 OSM。若以后切换，在 Google Cloud 关联结算、启用 Maps JavaScript API，创建仅允许 `https://linus-he.github.io/*` 和 Maps JavaScript API 的网站 Key。填入 GitHub Actions Repository Secret `GOOGLE_MAPS_API_KEY`，可选 Variable `GOOGLE_MAPS_MAP_ID`（未填时用 DEMO_MAP_ID 测试），再重新发布。浏览器 Key 对访客可见，Secret 仅避免源码提交，保护来自来源/API 限制。
