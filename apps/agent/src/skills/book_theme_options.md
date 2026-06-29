全书主题推荐

基于全书章节概览、Stage1 提取色、全局分析摘要、用户引导和可选字体倾向,推荐恰好 3 组全书级主题方案。

## 方案内容

- 每个 `bookThemeOptions[]` 是一套完整主题:一个全书统一 `artFont`,一段可选 `label`/`style`,以及覆盖全部章节的 `chapters[]`。
- `chapters[].subject`:可选章节标题,简短、有画面感,只扎根于该章节照片和 description。结尾不加标点,不加引号。
- `chapters[].accentColor`:最终章节装饰色。以该章 `extractedColor` 作为真实色彩依据,但做审美设计,不要机械照抄。缺少 extractedColor 时,根据章节情绪与场景设计。
- `artFont`:结合全书气质、用户 `fontHint` 和方案风格选择。每组选一个全书统一字体。

## 必守

- 只推荐主题,绝不输出 templateId、pageIndex、页数、排版或照片摆放指令。
- 输出恰好 3 个 `bookThemeOptions`。
- 每个 option 的 `chapters` 必须覆盖每个输入章节一次,使用确切 `chapterId`;不漏、不加。
