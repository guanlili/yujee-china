# Yujee

> Category: Custom
> 黑白排版驱动，全息渐变做装饰点缀。排版即设计，字重即层级。

## 1. Visual Theme & Atmosphere

**极简、排版驱动、黑白为主。** 界面以黑色灰度阶梯和白色灰度阶梯为基础。品牌渐变（蓝绿→黄绿→紫）仅用于背景弥散光晕装饰和黑色按钮的彩色投影，不用于按钮填充色、文字色、边框色或状态色。所有层级通过字号和字重区分。

**参考风格：** 高端平面设计、现代 SaaS 产品界面、苹果产品页面。

**关键特征：**
- 黑白灰色系为主，品牌渐变用于背景弥散光晕装饰（一页最多一处），不用于按钮填充色
- **所有按钮和输入框使用 pill 全圆角**（`border-radius: 9999px`），卡片 16px、大容器 16px — 不允许直角/尖角
- **卡片和模块不用边框，用投影区分层级**
- 超大标题字（80–120px），字重做层级（800 → 700 → 600 → 400）
- 白色卡片在淡灰底色上通过投影分层
- 渐变不用于文字色、边框色、状态色

## 2. Color Palette & Roles

### Ink & Surface（唯一的 UI 色系）
- **Foreground**: `#111111` — 标题、主文字
- **Foreground-2**: `#333333` — 正文
- **Muted**: `#888888` — 辅助文字
- **Meta**: `#aaaaaa` — 标注、时间戳
- **Border**: `#e0e0e0` — 分隔线、边框
- **Surface**: `#ffffff` — 卡片、模块、弹窗（白色）
- **Background**: `#f5f5f5` — 页面底色（淡灰，与白色卡片形成分层）

### Gradient accent — 三色镜像渐变
三个品牌色形成镜像渐变，边缘高度模糊扩散：
- **Teal 蓝绿**: `#13B8A6` — 左下漾出（品牌主色）
- **Purple**: `#8C5EF4` — 中段过渡
- **Lime**: `#DAF45E` — 右上漾出

三色组合形成镜像渐变：蓝绿→紫→黄绿，左右对称，中间以紫色过渡。

**背景装饰实现：** 多个 `border-radius: 50%` + `filter: blur(80–120px)` + `opacity: 0.4–0.6`
**按钮投影实现：** `.btn-glow` 包裹容器 + `::after` 伪元素 `linear-gradient(90deg, green, purple, lime)` + `filter: blur(12px)`。黑色按钮 `z-index: 1` 在上层，`::after` `z-index: 0` 在下层，渐变从按钮底部透出形成真正的横向渐变光晕

渐变使用规则：
- 背景装饰：用于 hero 区、关键 section 背景，作为弥散光晕效果，一页最多一处
- 所有黑色按钮（Primary + Brand）通过 `.btn-glow` 包裹容器的 `::after` 渲染横向 `linear-gradient` 光晕（蓝绿→紫→黄绿），是品牌的标志性视觉
- 不做渐变填充按钮，按钮只有黑色和描边两种
- 三个色块可部分重叠，在重叠处自然混色
- **不用于**文字色、边框色、状态色
- 生产环境背景装饰可用 PNG/WebP 切图交付，也可用 CSS 实现

### Accent（品牌主色）
- **Accent**: `#13B8A6` — 蓝绿主色，用于 focus ring、链接、选中态、状态点、输入框焦点等组件强调；不做大面积按钮填充色

### Semantic（灰度）
- 状态用灰度区分，不用彩色：`#333` / `#666` / `#111`

## 3. Typography Rules

### Font Family
- **Display / Logo**: `'Bricolage Grotesque', system-ui, -apple-system, sans-serif` — Google Fonts (OFL). 编辑/杂志气质，承载品牌字标与所有标题。
- **Body**: `system-ui, -apple-system, 'Segoe UI', sans-serif` — 正文保持系统字体，零加载成本、可读性最佳。
- **Code**: `ui-monospace, 'JetBrains Mono', Menlo, monospace`

> 引入方式（每个页面 `<head>`）：
> ```html
> <link rel="preconnect" href="https://fonts.googleapis.com">
> <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
> ```

### Hierarchy

| Role | Size | Weight | Letter-spacing | Line Height |
|------|------|--------|---------------|-------------|
| Hero | 80px | 800 | -0.03em | 1.0 |
| H1 | 48px | 700 | -0.02em | 1.1 |
| H2 | 32px | 700 | -0.01em | 1.15 |
| H3 | 20px | 600 | — | 1.3 |
| Body | 15px | 400 | — | 1.5 |
| Caption | 12px | 500 | 0.08em (uppercase) | 1.4 |
| Stat | 72px | 800 | -0.03em | 1.0 |

### Principles
- 排版即设计，字重即层级
- Hero 字号 clamp(48px, 8vw, 80px)，weight 800
- 不靠颜色做层级区分，靠字号 + 字重 + 灰度
- Section label 用 uppercase + 0.08em tracking + meta 色

## 4. Component Stylings

### Buttons
- **Primary**: 纯黑背景 `#111`，白色文字，**pill 全圆角**（`border-radius: 9999px`）。用 `.btn-glow` 包裹容器，`::after` 伪元素 `linear-gradient(90deg, green → purple → lime)` + `filter: blur(12px)` + `opacity: 0.55` 做横向渐变光晕。Hover：整体上浮 2px，光晕变亮变大
- **Brand**: 纯黑背景 `#111`，白色文字，**pill 全圆角**。`.btn-glow btn-glow-brand` 包裹，同样 `::after` linear-gradient 但更强：`blur(14px)` + `opacity: 0.7` + `width: 80%`。**仅用于最重要的品牌 CTA，一页最多 1 个**
- **Outline**: 透明背景，1px 黑色边框，**pill 全圆角**，hover 反转黑白
- **Ghost**: 无边框无背景，文字 + 箭头 →，hover 变灰
- 没有渐变填充按钮 — 按钮只用黑色或描边

### Cards
- Background: `#ffffff`（白色，在淡灰底色上自然分层）
- **无边框** — 不用 `border`，用投影区分
- Radius: **16px**
- Shadow: `0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)`
- Hover: 投影加深 + 微抬升 `translateY(-2px)`

### Inputs
- Background: `#ffffff`（白色）
- Border: 1px solid `#ebebeb`（极淡），**pill 全圆角**（`border-radius: 9999px`），带微投影
- Focus: 边框变紫 `#8b5cf6` + 焦点环
- Placeholder: `#aaa`

### Tags
- **无边框** — 用淡灰底色 `#f5f5f5` + 微投影区分
- **pill 全圆角**，小字号
- 纯灰度，无彩色分类标签

### Action Chip（AI 对话操作芯片）
用于 AI 对话场景中，用户对 AI 生成结果执行操作（重新编辑、再次生成、复制、分享等）。视觉上比按钮更轻，比标签更可交互。
- **外观**: 透明背景，1px 描边 `--border`，pill 圆角（9999px）
- **尺寸**: padding 6px 14px，字号 13px，font-weight 500
- **图标**: 左侧 16px 图标，与文字间距 6px，颜色 `--muted`
- **文字颜色**: `--fg-2`（#333）
- **Hover**: 背景变为灰色 `#ebebeb`，边框加深
- **Active**: 背景变为深灰 `#e0e0e0`，边框加深
- **更多按钮**: 同样式但只有 `···` 图标，无文字，宽高相等（32px 正方形 pill）
- **排列**: 水平排列，间距 8px，紧贴内容底部
- **不要**: 不用彩色、不用填充背景、不用投影 — 保持轻量

### Nav Pill（导航/工具栏 pill 按钮）
用于顶部导航栏或工具栏中的功能入口，比按钮更轻量，适合密集排列。
- **外观**: 白色背景 `--surface`，1px 描边 `--border-soft`，pill 圆角，微投影
- **尺寸**: padding 8px 16px，字号 `--text-sm`（13px），font-weight 500
- **图标**: 左侧 emoji 或 16px 图标，间距 6px
- **下拉变体**: 右侧带 12px 下拉箭头 chevron（`--muted` 色）
- **Hover**: 背景变淡灰 `--bg`，投影加深
- **排列**: 水平排列，间距 8px

### Icon Button（圆形图标按钮）
用于工具栏中仅有图标的操作入口（社交图标、通知铃铛等）。
- **外观**: 白色背景 `--surface`，1px 描边 `--border-soft`，圆形（36×36px），微投影
- **图标**: 18px，`--muted` 色，hover 变 `--fg-2`
- **Hover**: 背景变淡灰 `--bg`，边框加深

### Status Pill（状态/积分 pill）
用于显示用户积分、会员等级、在线状态等复合信息。
- **外观**: 白色背景 `--surface`，1px 描边 `--border-soft`，pill 圆角，微投影
- **结构**: 左侧状态圆点（8px）+ 数值 + 分隔线（1px 竖线）+ 计划标签
- **状态圆点**: `--grad-green` 默认，`--accent` 表示 Pro
- **数值**: `--fg-2`，`--text-sm`，font-weight 500
- **计划标签**: `--muted`，`--text-xs`

### Avatar（用户头像）
圆形用户头像，支持首字母或图片。
- **尺寸**: 默认 36px，大号 48px
- **外观**: `--accent` 背景 + 白色首字母，font-weight 700
- **图片模式**: `border-radius: 50%` + `object-fit: cover`
- 可用品牌色（`--grad-green`、`--fg`）做不同角色区分

### Segmented Control（分段切换器）
用于在 2–4 个选项之间切换视图或模式（年付/月付、列表/网格/看板等）。
- **Track**: 淡灰底色 `--bg`，1px 描边 `--border-soft`，pill 圆角，4px 内间距
- **Item**: 透明背景，`--muted` 文字，padding 8px 20px，pill 圆角
- **Active item**: 白色背景 `--surface`，`--fg` 文字，微投影
- **Hover**: 文字变 `--fg-2`
- **可附加 Promo Badge**: 小型圆角标签（`--grad-green` 背景），用于折扣/促销标记（如 "-16%"），11px 字号，font-weight 700

### Selection Chip（AI 提供的选项芯片）
用于 AI 对话场景中，AI 提供若干选项供用户选择（风格偏好、功能分类、方向选择等）。支持单选和多选。
- **外观**: 透明背景，1px 描边 `--border`，pill 圆角
- **尺寸**: padding 8px 16px，字号 `--text-sm`（13px），font-weight 500
- **无图标**: 纯文字，不带图标
- **文字颜色**: `--fg`（#111）
- **Hover**: 背景变为灰色 `#ebebeb`，边框加深
- **Active**: 背景变为深灰 `#e0e0e0`
- **选中态**: 黑底白字（`--fg` 为背景，`--surface` 为文字），边框同底色
- **排列**: 水平排列，自动换行（flex-wrap），间距 8px
- **不要**: 不用彩色选中态、不用勾选图标 — 黑白即可

## 5. Iconography

- **图标库**: 使用 [Lucide Icons](https://lucide.dev)（ISC 开源协议，免费商用）
- **风格**: 线性描边（stroke），不使用填充（fill）图标
- **描边宽度**: 1.75px，与 UI 线条粗细一致
- **尺寸**: 组件内图标 16px，独立图标按钮 18px，大图标 24px
- **颜色**: 继承父元素 `currentColor`，默认 `--muted`，hover 变 `--fg-2`
- **端点**: `stroke-linecap: round`，`stroke-linejoin: round`
- **禁止**: 不要用 emoji 代替图标；不要混用填充和描边风格；不要手绘 SVG

## 6. Spacing & Layout

- **Base unit**: 4px
- **Container**: max 1320px，32px gutter
- **Section spacing**: 96px desktop，56px tablet，36px phone
- **组件间距**: 通过 section-label 编号划分板块（01 —、02 —）

## 7. Motion

- **Fast**: 180ms（hover, focus）
- **Base**: 300ms（状态转换）
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)`
- 卡片 hover 投影加深（从 `--elev-card` 到 `--elev-card-hover`）+ 微抬升 `translateY(-2px)`
- Ghost 按钮箭头 → hover 平移 4px
- Primary / Brand 按钮（`.btn-glow` 容器）hover 整体上浮 2px + `::after` 渐变光晕 blur 加大、opacity 升高、下移；active 回弹 + 光晕收缩变淡

## 8. Voice & Brand

- 克制、自信、不多说
- 排版本身就是品牌表达
- 彩色（全息渐变）只在最关键的品牌时刻出现
- 黑白是默认，渐变是例外

## 9. Responsive Behavior

- **Desktop ≥ 1024px**: 12 列，32px gutter
- **Tablet 640–1023px**: 8 列，20px gutter
- **Phone < 640px**: 4 列，16px gutter
- Hero 字号用 clamp() 流式缩放
- Nav 在移动端只保留 logo + CTA

## 10. Anti-patterns

- ❌ 不要做渐变填充按钮——按钮只有黑色和描边，品牌色只通过 `.btn-glow` 包裹容器的 `::after` linear-gradient 光晕体现
- ❌ 不要用 `box-shadow` 做多色渐变投影——box-shadow 只支持单色，多色混合效果差；必须用 `.btn-glow` 包裹容器 + `::after` `linear-gradient` + `filter: blur` 实现
- ❌ 不要直接在按钮上加 `::after`——z-index 会在不同 stacking context 下出问题；必须用外部 `.btn-glow` 包裹容器
- ❌ 不要加重阴影——投影保持微妙（模糊 3–24px，透明度 4–10%）
- ❌ 渐变不要用在文字色、边框色、状态色、按钮填充色上——只用于背景装饰和按钮底部光晕
- ❌ 不要用 beige/cream/peach 暖底色
- ❌ 不要用左边框色条装饰卡片
- ❌ 输入框不要用底部横线——用完整 pill 全圆角边框
- ❌ 一页不要出现超过一处渐变
- ❌ 不要用 emoji 做图标——统一使用 Lucide Icons 的线性描边 SVG
- ❌ 不要混用填充图标和描边图标——全部用描边
- ❌ 不要使用直角/尖角（border-radius: 0）— 所有按钮和输入框必须使用 pill 全圆角（9999px），卡片/容器至少 16px 圆角
- ❌ 不要给按钮用 8px 或 12px 圆角 — 按钮统一 pill 全圆角
- ❌ 不要给卡片加边框——用投影做分层
