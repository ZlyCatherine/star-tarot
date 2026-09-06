# 星见塔罗

一个纯前端的 Rider–Waite–Smith 塔罗抽牌应用。用户可以先选择牌阵，静心洗牌，逐张抽取并翻开牌面，查看正位或逆位的简短中文解读。

## 一期功能

- 今日指引：1 张牌
- 事物发展：过去／现在／未来
- 建议牌阵：现状／阻碍／建议
- 恋人十字：你的想法／对方想法／过去／关系现状／未来发展
- 78 张完整 RWS 牌组
- 正位与逆位
- 支持在牌堆上画圈洗牌
- 可拖动圆弧牌环浏览全部未抽牌，并主动点选要抽取的牌
- 可选填写探索问题
- 手机和桌面端自适应
- 不使用账号、接口或持久化存储

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

正式构建：

```bash
npm run build
```

静态文件会生成到 `dist` 目录。

## GitHub Pages

项目包含 `.github/workflows/deploy.yml`。代码推送到 GitHub 仓库的 `main` 分支后，在仓库设置中将 Pages 的 Source 设为 **GitHub Actions**，工作流会构建并发布 `dist`。

## 素材

牌面与内容来源说明见 [CREDITS.md](./CREDITS.md)。牌义仅供娱乐与自我探索参考。
