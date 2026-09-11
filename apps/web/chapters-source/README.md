# 三个篇章 / Three chapters

## 中文

宠物小窝、旅行小岛、记忆宫殿以 `/pet`、`/travel`、`/palace` 为入口；五种语言沿用官网前缀。源码在本目录，已构建文件在 `../public/chapters`，由现有 Next.js rewrite 提供。没有新部署服务、数据库迁移或 AI 调用。

执行 `npm ci && npm test && npm run build`（构建末尾会自动跑 `scripts/verify-build.mjs`）。将 dist 中三个篇章和五个语言目录复制到 `../public/chapters` 后随官网发布。请勿复制本地根页面或兼容目录覆盖官网首页。

个人照片与相册目前保存在同域 IndexedDB，尚未连接官网账号的云相册。跨设备前需要导出备份。空白账号不注入虚构宠物或相册；原始迁移数据保留在备份中。移除旧验收内容仅匹配已知 ID 与原始内容，用户修改会保留。

中文标题使用官网完整 Noto Serif SC Regular 字库按 Unicode 分片，CSS 仅按需加载所需范围。静态字库声明 400，粗体由浏览器一致合成，不再混用首页的精简字库与系统中文字体。可用 fonttools/brotli 执行 `python scripts/verify-fonts.py` 检查回归文案。

## English

Pet Haven, Travel Island and Memory Palace use `/pet`, `/travel` and `/palace`, with the official five locale prefixes. Source lives here and prebuilt assets in `../public/chapters`; the existing Next.js rewrites serve them. No new hosting service, database migration or AI request is introduced.

Run `npm ci && npm test && npm run build`（构建末尾会自动跑 `scripts/verify-build.mjs`）. Copy the three chapter and five locale folders from dist into `../public/chapters` before deploying the existing website. Do not copy the local root or compatibility folders over the official homepage.

Photos and albums currently use same-origin IndexedDB, not the official account cloud albums. Export a backup before switching devices. Fresh accounts receive no fictional pets or albums; migration originals remain in backups. Retired acceptance fixtures are matched by known IDs and original contents; user edits are protected.

Chinese headings use Unicode subsets of the official full Noto Serif SC Regular font, loaded on demand. The static face is declared at weight 400 with consistent browser bold synthesis, replacing mixed landing-subset/system glyphs. Run `python scripts/verify-fonts.py` with fonttools/brotli to check regression text.
