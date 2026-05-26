# Yujee Web · V1 UI 实现稿

这是 Web 应用的 **V1 UI 实现稿**(不是参考稿、不是 Figma 截图、不是 mockup)。三个 HTML 文件是**已经完成的视觉成果**,CSS / JS / 交互逻辑全部内联。后续 React 化工作量集中在**结构拆分 + 数据接入**,**不需要重新设计 UI**。

## 三个页面

| 文件 | 对应 Next.js 路由 | 说明 |
|---|---|---|
| [`yujee-home2.html`](./yujee-home2.html) | `/[locale]/(tool)/create/page.tsx` + `/[locale]/(dashboard)/my-albums/page.tsx` | 首页 = 创建入口 + 已有作品列表 |
| [`design/pricing.html`](./design/pricing.html) | `/[locale]/(marketing)/pricing/page.tsx` | 定价页 |
| [`design/editor.html`](./design/editor.html) | `/[locale]/(tool)/album/[uuid]/page.tsx` | 相册编辑器 |

> 路由归属见 [`../../../docs/web/directory.md`](../../../docs/web/directory.md) §2。

## 给 React 化工程师的硬约束

1. **视觉 1:1 还原**——颜色、字号、间距、动效、SVG 图标全部从 HTML 抠出来,**不要"优化"成自认为更好的设计**。改设计必须先和产品/架构师沟通。
2. **CSS tokens 是权威**——`yujee-home2.html` 顶部 `:root { --bg, --fg, --accent, ... }` 是设计 token 源,React 化时抽到 `apps/web/src/styles/theme.css` 或 Tailwind config,**值不许改**。
3. **i18n 文案**——HTML 里所有 `data-i18n="xxx"` / `data-i18n-title="xxx"` 的 key 是 i18n 锚点,React 化时一一对应到 `apps/web/src/messages/{en,zh}.json`。
4. **页面间链接**——HTML 用 `href="design/pricing.html"` 这类相对路径互链,React 化时改为 Next.js `<Link href="/pricing">`。
5. **未接数据的部分**——HTML 里写死的项目卡片、积分余额、用户名等都是占位数据,React 化时按 [`../../../docs/web/api.md`](../../../docs/web/api.md) 的接口接真数据。

## 在浏览器里看

直接双击 `yujee-home2.html`,或:

```bash
cd apps/web/design-v1
python3 -m http.server 8080
# 访问 http://localhost:8080/yujee-home2.html
```

## 为什么放在 `apps/web/` 而不是 `docs/`

它是 Web 应用的**一部分**(UI 已完成的部分),不是设计参考资料。所以它住在它服务的 app 旁边。

## 这些文件是否进生产构建

**不**。`design-v1/` 不被 Next.js 编译、不打进 bundle、不会出现在 `apps/web/.next/` 里(Next.js 只看 `apps/web/src/` 和 `apps/web/public/`)。它们只是仓库里的静态文档资产。

React 化完成、对应路由上线后,这个目录可以保留作为"V1 设计快照",或在确认无人参考后由架构师批准删除。
