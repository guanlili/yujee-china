---
name: 相册字体
description: 用于设定或调整全书文字字体，或用户提出"换个字体/字型/换个字"类需求。
---

# 相册字体

给相册定文字字体时，使用这个技能。

## 字体角色模型

全书文字按三类角色各设一个字体，用 `set_text_fonts` 一键刷到底：

- **标题字体（titleFont）**：标题（title 角色）。
- **正文字体（bodyFont）**：大段正文（body），图注/说明（explain）跟正文同字体。
- **装饰字体（decorationFont）**：装饰槽（decoration）——英文标签、页码、日期、印章式点缀。

装饰**独立于标题**（跟配色不同：配色里装饰跟标题同色，字体里装饰自成一档）。只改一类就只传那一类；不传的类保持原样。不要用 `update_page_texts` 手工写 `#artFont` carrier 键。

## 字体菜单（值必须原样传 id，且属于该角色，选错会打回）

**标题 titleFont**
- 中文：`noto-serif-sc`(思源宋体·加粗) · `zcool-xiaowei`(站酷小薇) · `lxgw-wenkai`(霞鹜文楷) · `smiley-sans`(得意黑·现代展示) · `zcool-qingke-huangyou`(站酷庆科黄油体·圆润) · `long-cang`(龙藏) · `zhi-mang-xing`(志莽行书) · `liu-jian-mao-cao`(柳建毛草·仅极短)
- 英文：`playfair-display` · `cormorant-garamond` · `bebas-neue`(全大写高瘦) · `archivo-black`(厚重) · `abril-fatface` · `montserrat`

**正文 bodyFont**
- 中文：`noto-sans-sc`(思源黑体·首选) · `noto-serif-sc`(思源宋体常规) · `lxgw-wenkai`(霞鹜文楷·唯一能撑正文的手写风) · `zcool-xiaowei`(站酷小薇)
- 英文：`eb-garamond` · `source-serif-4` · `lora` · `libre-baskerville`(衬线) · `inter` · `work-sans` · `dm-sans` · `poppins` · `raleway` · `montserrat`(无衬线)

**装饰 decorationFont**
- 中文：`noto-serif-sc` · `lxgw-wenkai` · `long-cang` · `zhi-mang-xing` · `liu-jian-mao-cao`
- 英文：`ibm-plex-mono` · `jetbrains-mono`(页码/英文标签) · `great-vibes` · `dancing-script` · `sacramento` · `parisienne`(签名式点缀)

## 搭配方法论

- 经典搭配：**正文 1 款求稳 + 标题 1 款可有性格 + 装饰 1 款点缀**。正文优先 `noto-sans-sc` / `noto-serif-sc` / 衬线英文，保证可读；成段正文不要草书/展示体（工具会挡）。
- **全书最多一个「性格字体」**（草书/花体/展示体，如 `smiley-sans`/`great-vibes`/`zhi-mang-xing`）当点缀，多了会乱。
- 页码、英文标签走等宽（`ibm-plex-mono`/`jetbrains-mono`）；签名式落款走 script（`great-vibes`/`dancing-script` 等）。
- 按调性取字：婚礼/情感 → 标题 `great-vibes` 或 `lxgw-wenkai`；旅行/都市 → `montserrat`/`inter`；家庭/怀旧 → `noto-serif-sc`/`eb-garamond`；封面张扬 → `smiley-sans`/`bebas-neue`。
- 中英各挑一套：一本书里中文槽和英文槽的字体气质要接近（都衬线或都无衬线）。
- 配色和字体是一套设计语言，改字体时顺带看现有配色是否还搭（相册配色技能）。用户给了明确偏好时以用户为准，只做合法性把关。

## 汇报口径

- 写入后用一句话说明选字理由（"标题用 great-vibes 花体贴合婚礼，正文配 eb-garamond 保证易读，页码走 ibm-plex-mono"），不要罗列受影响的槽位。
