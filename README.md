# 岛屿漫游
台湾地图旅行攻略网站：[打开网站](https://linus-he.github.io/tw-travel/)。默认使用 OpenStreetMap + Leaflet，不需要地图密钥或 Google 结算。

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
- 未导入任何平台评分、评论和照片，页面显示“暂无评分”“暂无照片”。分类为本站依据名称与来源类型整理，不表示官方推荐。
- 所有地点使用稳定官方 ID，旧版七个演示地点的 numeric 收藏/评价继续保存在导出备份中，不会混接到真实地点。
- 收藏、体验、攻略仅存当前浏览器 localStorage，不是多人共享系统。支持备份导入导出和本地攻略编辑。
- Threads、Dcard、小红书只提供关键词搜索入口，不代表本站已收录对应讨论。

## 运行与验证
运行 `python3 -m http.server 8000`，访问 http://localhost:8000。

```sh
node --check app.js
node --check map.js
node --test tests/*.test.cjs
python3 build-site.py
```

页面需联网加载 Leaflet、OSM 底图、字体。地点数据来自随站发布的 JSON，不会在每次移动地图时调用第三方数据接口。OSM 保留可见版权署名，禁用批量预取；其公共瓦片服务无可用性保证，大流量需更换合适的服务。

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
