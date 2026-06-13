# 模板结构重新设计 · Spec

> 目标:把"随便扔进去"的 21 个版式收敛成一套**结构清晰、可手工细调**的模板定义。
> 单一真相源仍是 `packages/contracts/templates/*.json`,TS/Python loader 单向派生(不变)。
> 本文只定义**版式结构**;**写作指引不在模板里**,按"文字角色"单独成模块(见 §5)。

---

## 1. 核心原则

- **模板只管版式**,不含任何写作指引。写作指引按文字角色(标题/正文/解释/装饰)在独立模块里定义一次。
- **画布模型**:所有页在一块画布内。
  - 画布**首** = 封面单页位(`slot=cover`),不进跨页系统。
  - 画布**尾** = 尾页单页位(`slot=ending`),不进跨页系统。
  - 画布**中间** = 目录 + 正文(`slot=interior`),两两成对跨页。
- 跨页配对逻辑**只在 `slot=interior` 上运行**;封面/尾页天然被排除(靠 slot,无需特判)。

---

## 2. 模板字段(新结构)

```jsonc
{
  "id": "mag-08",              // 必填,等于文件名
  "slot": "interior",          // cover | interior | ending  —— 画布位置
  "scene": "portrait",         // 固定场景清单之一(§3)
  "pairing": null,             // 仅 interior 可非空,见 §4
  "images": [                  // 数组,保留顺序;图片数量 = images.length(不另存)
    { "id": "img1", "orientation": ["portrait"], "quality": ["hero"] }
  ],
  "texts": [                   // 数组,每条四要素
    { "id": "title",    "role": "title",      "maxChars": 10, "lang": "user" },
    { "id": "subtitle", "role": "decoration", "maxChars": 25, "lang": "en"   },
    { "id": "dateNum",  "role": "decoration", "maxChars": 5,  "lang": "en"   },
    { "id": "body",     "role": "body",       "maxChars": 80, "lang": "user" },
    { "id": "caption",  "role": "explain",    "maxChars": 80, "lang": "user" }
  ]
}
```

- **图片数量**不单独存,取 `images.length`,避免双真相源漂移。
- `pairing` 仅 `slot=interior` 时可非空;`cover`/`ending` 恒为 `null`。

---

## 3. 枚举

| 字段 | 取值 |
|---|---|
| `slot` | `cover`(首单页) / `interior`(进跨页) / `ending`(尾单页) |
| `scene` | `opening`开篇 / `portrait`人物 / `scenery`风景 / `record`多图记录 / `interlude`引文过渡 / `textOnly`纯文字 / `ending`结尾 |
| `text.role` | `title`标题 / `body`正文 / `explain`解释 / `decoration`装饰 |
| `text.lang` | `user`用户语言 / `en`通用英文 |
| `image.orientation` | `portrait` / `landscape` / `square`(沿用) |
| `image.quality` | `hero` / `detail` / `fill`(沿用) |

- **`slot` 与 `scene` 正交**:章节扉页 = `scene=opening` + `slot=interior`;书封面 = `scene=opening` + `slot=cover`。slot 管物理位置(分页硬约束),scene 管内容匹配。
- **`lang` 默认跟随 role**:`decoration→en`,其余 `→user`。只在特例时显式覆盖。

---

## 4. 画布与跨页规则

- `slot=cover` → 画布首,单页位,**不配对**。
- `slot=ending` → 画布尾,单页位,**不配对**。
- `slot=interior` → 进跨页系统,两两成对翻。
- **强制套用** `pairing = { "forced": true, "with": "<模板id>", "side": "left"|"right" }`:
  该 interior 模板必须与 `with` 指定模板成对占同一个跨页,`side` 指定它在左/右页。用于印刷上必须成对的版式。
- 配对引擎在拍平/渲染时:封面/尾页直接放首尾单页位 → 中间 interior 页按 `pairing` 先放强制对,再两两补齐。

---

## 5. 文字角色 → 写作策略(指引单独成模块,此处只列语义)

> 模板里**不写**指引,只标 `role`。AI 拿 role 去写作指引模块查"怎么写"。

| role | 语义 | 写法要点(归写作指引模块) |
|---|---|---|
| `title` 标题 | 一页核心一句 | 短、有力 |
| `body` 正文 | 叙事/情感主线 | 用户语言,第一人称 |
| `explain` 解释 | 贴某张照片说 | 落到画面细节 |
| `decoration` 装饰 | 日期/编号/英文小标 | 视觉节奏用,通常英文/数字,AI 不纠结含义 |

---

## 6. 与旧结构差异 / 迁移

| 旧 | 新 |
|---|---|
| `category`(cover/spread/single/grid/closing) | 拆成 `slot` + `scene`(图片数量取 `images.length`) |
| `imageSlots: {name: {...}}` (dict) | `images: [{id, orientation, quality}]` (数组) |
| `textSlots: {name: {type, recommendedMaxChars}}` (dict) | `texts: [{id, role, maxChars, lang}]` (数组) |
| `type`(7 种) | 收敛为 `role`(4 种) |
| (无) | 新增 `scene` / `pairing` / `lang` |

- 数组键里的 `cells[0].image`/`items[0].title` 这类括号路径仍由 web 的 `adapt-layout` 还原成嵌套数组(不变)。
- 21 个模板的具体重写 + 视觉细调由**人工逐个完成**;本 spec 只定字段与规则。

---

## 7. 受影响消费方(实现范围)

| 区域 | 文件 | 改动 |
|---|---|---|
| 契约 | `packages/contracts/src/templates.ts` `templates.generated.ts` `v2.ts` | 新 schema + zod + 类型 |
| Agent loader | `apps/agent/src/templates.py` | 解析新字段 |
| Agent 选模板 | `apps/agent/src/services/skeleton.py` | `pick_template` 用 `slot`+`scene`+`pairing` |
| Web 渲染 | FlipBook + PDF 跨页系统 | 封面/尾页单页位 + interior 配对 + 强制套用 |
| Web 交互/编辑器 | 编辑器 + `/api/v2` + `adapt-layout` | 文字角色/语言呈现 + 新数据形状 |
| 写作指引(新) | 待定位置 | 按 role 的写作 prompt 模块 |
