# 岛屿漫游
台湾地图旅行攻略原型。纯静态 HTML / CSS / JavaScript，可部署至 GitHub Pages。

## 运行
在项目目录运行 `python3 -m http.server 8000`，访问 http://localhost:8000。
依赖网络加载 Leaflet、OpenStreetMap 地图、字体和 Unsplash 氛围图片。

## 功能与数据边界
- 地图缩放、地点详情、搜索、分类、收藏。
- 本地评价、攻略编写、JSON 备份导入导出。数据仅保存于当前浏览器 localStorage；无登录和多人同步。导入会替换当前笔记，请先导出备份。
- 七个演示地点，评分均为示例，图片为氛围配图，并非实地照片。
- Google Maps、Threads、Dcard、小红书目前仅提供地点关键词搜索入口，没有抓取或同步平台内容。
- 正式数据接入需另行设计平台授权、内容来源记录及后端同步；GitHub Pages 不能运行服务端，也不能安全保存 API 密钥。

## GitHub Pages 部署
1. 将这些文件推送到 GitHub 仓库的 main 分支。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
3. 工作流会发布静态文件；在 Actions 查看部署地址。

尚未连接 GitHub 仓库，未实际发布。
