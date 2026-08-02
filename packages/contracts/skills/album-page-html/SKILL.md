---
name: 页面HTML编辑
description: 改版面/挪元素/加装饰/整页内容重排 —— 直接编辑页面 HTML 的方法论（内容修改的首选路径）。
---

# 页面 HTML 编辑

页面的真相是一段 794×1123 的 HTML（`read_page` 的 `html` 字段）。要改版面、挪元素、加装饰、或一次改整页多处内容时，直接改这段 HTML，用 `write_page_html` 完整交回。

## 红线（工具会校验，违反直接打回）

- 原有 `data-text-key` / `data-image-slot` 锚点**一个不能删**（可以挪位置、改样式、改内容）。
- 图片 src 必须保持 `{{IMG_SRC:slotId}}` token，真实图渲染时才注入；绝不要写真实 URL / base64。
- 禁 `<script>` / `<iframe>` / 事件属性 / 外链；根节点 `data-template` 不可改（换排版用 `swap_page_template`）。

## 方法

- 以 `read_page` 返回的 html 为底稿改，不要凭空重写；整页 ≤64KB。
- 自己新增的装饰元素不加锚点属性（那是用户可操作面的契约）。
- 只改一两个槽的文字时，`update_page_texts` 更省（会原位 patch，不动你的版面）。
- 换模板（`swap_page_template`）和主题一键（`set_text_colors` / `set_text_fonts`）会从模板重新生成该页 HTML，手工版面改动会被重置 —— 先告知用户再做。
