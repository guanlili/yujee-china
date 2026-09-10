// 三个篇章是手写 CSS，不用 Tailwind。
// 没有这个文件，vite 会一路向上找到 apps/web/postcss.config.mjs（官网的 Tailwind v4 配置），
// 而这里并没有装 @tailwindcss/postcss —— 干净 checkout 上 npm run build 会直接失败。
export default {plugins:{}};
