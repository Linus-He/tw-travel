# 岛屿漫游
台湾地图旅行攻略网站，部署地址：https://linus-he.github.io/tw-travel/

## 地图
支持 Google Maps JavaScript API；配置密钥后自动使用 Google Maps 和 Advanced Markers。
未配置密钥时继续使用 OpenStreetMap，界面明确标注地图来源。Google 加载或认证失败时显示提示，地点、收藏、攻略仍可使用。
Google 底图里的原生商家信息不等于本站已收录；侧边栏筛选和标记目前仍针对七个演示地点。

## 首次启用 Google Maps
1. 在 https://console.cloud.google.com/ 创建或选择项目。由账户所有者自行关联结算；地图请求可能产生费用。
2. 启用 **Maps JavaScript API**。本次只接地图，不需要开启 Places API。
3. 创建网站专用 API Key：应用限制选 Websites / HTTP referrers，允许 `https://linus-he.github.io/*`。如需本地预览，建议单独创建开发 Key，允许 `http://localhost:8000/*`。
4. API 限制仅允许 **Maps JavaScript API**；根据预计用量设置可用配额和预算提醒。预算提醒不是消费硬上限。
5. 在仓库 Settings → Secrets and variables → Actions → Secrets，新建 Repository secret：`GOOGLE_MAPS_API_KEY`，填入网站专用 Key。不要发送账户凭据、服务账号 JSON 或未限制的 Key。
6. 可创建生产用 JavaScript Map ID，在 Actions → Variables 中添加 `GOOGLE_MAPS_MAP_ID`。省略时使用 Google 的 `DEMO_MAP_ID` 测试标记。
7. Actions → Deploy GitHub Pages → Run workflow，选择 main。Secrets 修改本身不会触发重新发布。

浏览器地图 Key 必然对访客可见；Actions Secret 只避免将其提交到源码，不会让生成后的 Key 保密。真正保护来自网站来源和 API 限制。不要复用服务端密钥。

## 本地运行
运行 `python3 -m http.server 8000`，访问 http://localhost:8000。
如需本地 Google 地图，在 `config.js` 临时填入单独限制过的开发 Key，勿提交此改动。
`node --check app.js`、`node --check map.js` 和 `node --test tests/map.test.cjs` 验证语法和地图加载/联动/错误处理。
依赖网络加载地图、字体、Leaflet（未配置 Google 时）和 Unsplash 氛围图片。

## 数据边界
- 七个演示地点，评分均为示例，图片为氛围配图，并非实地照片。
- 本次不导入 Google 商家评分或平台评论。Google Maps、Threads、Dcard、小红书提供关键词搜索入口。
- 收藏、评价、攻略仅存于当前浏览器 localStorage；无登录和多人同步。可导出 JSON 备份，导入会替换当前笔记。
- 正式评分与评论接入需另行设计，遵守来源授权、归属标注和存储规则。

## 部署
main 分支通过 `.github/workflows/deploy.yml` 发布；Pages 的 Source 设为 GitHub Actions。
工作流从 Actions Secret 生成 `public/config.js`，只上传网站静态文件。
