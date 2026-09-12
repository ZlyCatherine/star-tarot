# 星见塔罗

一个移动端优先的 Rider–Waite–Smith 塔罗抽牌应用。用户可以先选择牌阵，静心洗牌，逐张抽取并翻开牌面，查看正位或逆位的简短中文解读，还可以通过 DeepSeek 生成一次完整的牌阵解读。

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
- 通过访问码调用 DeepSeek 生成 AI 综合解读
- 手机和桌面端自适应
- 不使用账号或数据库

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

如需在本地联调 AI 解牌，复制 `.env.example` 为 `.env.local`，并将其中的地址指向本地或已部署的 Worker。

正式构建：

```bash
npm run build
```

静态文件会生成到 `dist` 目录。

## GitHub Pages

项目包含 `.github/workflows/deploy.yml`。代码推送到 GitHub 仓库的 `main` 分支后，在仓库设置中将 Pages 的 Source 设为 **GitHub Actions**，工作流会构建并发布 `dist`。

AI 解牌上线后，还需要在仓库的 Actions Variables 中配置公开变量 `VITE_TAROT_AI_API_URL`，值为部署后的 Worker 地址。该变量只包含公开接口地址，不包含任何密钥。

## DeepSeek Worker

AI 接口位于 `worker/`，使用 Cloudflare Worker 保存并调用 DeepSeek 密钥。当前默认模型为 `deepseek-flash`。

本地准备：

```bash
cp worker/.dev.vars.example worker/.dev.vars
npx wrangler dev --config worker/wrangler.toml
```

在 `worker/.dev.vars` 中填写：

```dotenv
DEEPSEEK_API_KEY=你的 DeepSeek API Key
TAROT_ACCESS_CODE=发给朋友的应用访问码
```

部署前通过 Cloudflare Secrets 设置线上密钥：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config worker/wrangler.toml
npx wrangler secret put TAROT_ACCESS_CODE --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

`.env.local`、`.dev.vars` 和真实密钥均不会提交到 GitHub。

Worker 数据校验测试：

```bash
npm run test:worker
```

## 素材

牌面与内容来源说明见 [CREDITS.md](./CREDITS.md)。牌义仅供娱乐与自我探索参考。
