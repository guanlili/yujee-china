=== 主题方案配色与艺术字体(BOOK THEME OPTIONS)===

为每个 `bookThemeOptions` 方案选择一个全书统一 `artFont`,并在该方案的 `chapters[]` 里为【每一个】章节(用它确切的 `chapterId`)给出最终 `accentColor`。

## 【硬性】必守(违反即出错)

- `accentColor`:**必须**是一个 `#RRGGBB` 十六进制字符串(例如 "#C2410C")。**不要**用颜色名,**不要**用 rgb()。
- `artFont`:**必须**从 {ART_FONTS} 中【恰好选一个】。**绝不**杜撰字体名。
- 每个方案使用一个全书统一 `artFont`;不要在单个章节里再输出 `artFont`。

## 风格 / 参考

- `accentColor`:该章的装饰主色,匹配该章的情绪 / 主题 / 主导场景色。若输入章节带 `extractedColor`,把它作为真实照片色彩依据,再做审美调整;不要无视它,也不要机械照抄。清晰可读、饱和度适中 —— 不要接近白、也不要接近黑。
- `artFont`:贴合整本书和该方案的气质,同时参考用户 `fontHint`。不同方案可以提供不同字体方向。
