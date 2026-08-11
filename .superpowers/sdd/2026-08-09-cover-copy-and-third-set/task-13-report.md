# Task 13 报告:新封底模板 mag-63 —— 彩色底 + 左下字标 + 右下条形码

## 范围纠正(执行中收到,已按此收尾)

协调方在实施过程中发来纠正:mag-63 只给(当前关着的)第三套用,第 1/2/4 套继续用
mag-22。这作废了 brief 里「要不要改 `compose_global.md` 结语规则」那条判断——其余三套
的 `slotSpecs('mag-22')` 返回 5 个文字槽,`endingSlots` 非空,结语照常有地方落,不能动
那条 prompt。范围收窄为:只做模板本体(JSON + HTML 镜像 + 两侧注册表 + React 兜底组件)+
`templates:generate` + 五张截图。**不碰 `SET_LAYOUT`,不碰 engine 的 prompt/handler**。

收到纠正前我没有改过任何 engine 文件,不存在需要回退的改动。收到纠正后,我在验证阶段发现
了一个**因为不碰 engine 而特意选择不修的真实测试失败**,详见下方「engine 测试」一节——
诚实报告,没有为了刷绿而违反纠正指令去改 engine。

## 建了什么

- `packages/contracts/templates/mag-63.json` —— `category: "ending"`,`images: []`,
  `texts: []`。零图槽、零文字槽,契约层面完全合法(见下方「校验」)。
- `packages/contracts/src/render/html-templates/mag-63.ts` —— 794×1123 静态 HTML
  模板字符串,三样东西,几何与 brief 表格逐项对应:
  - 品牌字标:`left:56px;bottom:96px;width:132px;height:55px`
  - 条形码盒:`right:56px;bottom:96px;width:130px;height:38px`
  - 小字 `YUJEE · {年份}`:`right:56px;bottom:142px;width:130px;text-align:right;
    font-size:10px;letter-spacing:2.5px;opacity:.5`
  - 页根 `background:#12363A;color:#E7E3D8`(默认深墨绿配色,同 mag-62 的默认值);
    全部三样元素只用 `currentColor`,零写死色值 —— 四套配色靠 design-apply 的
    `applyDarkChrome` 在烘焙后覆写页根 `background-color`/`color` 实现(已读源码确认,
    见下方「颜色机制」)。
  - 条形码坐标不是手填的 15 个数字,而是模块加载时跑一遍确定性算法算出来再拼进模板
    字符串(同文件里 `YEAR` 那种「算一次、拼进静态字符串」写法),避免手算/手抄出错。
- `apps/web/src/components/album/templates/mag-63/index.tsx`(`WebMag63`)—— 页面
  真相(`page.html`)缺失时的兜底 React 渲染,几何/算法与 HTML 镜像一致,固定展示默认
  深墨绿配色(兜底路径本来就绕过烘焙,拿不到 colorway 信息,同 `WebMag62` 的先例)。
- 两侧注册表:contracts 的 `render/html-templates/registry.ts`、web 的
  `components/album/web-registry.ts`,以及 `templates.test.ts` 的
  `EXPECTED_TEMPLATE_IDS` 硬编码清单。
- `pnpm --filter @yujee/contracts templates:generate` 重新生成
  `src/templates.generated.ts`(未手改)。
- 两个 doc-scope 文档(根 `README.md`、`packages/contracts/templates/README.md`)
  核对后内容仍准确,单独一个 commit 推进 `checked-at`。

**没有改**:`SET_LAYOUT`(design-apply.ts)、engine 任何源码/prompt、`compose_global.md`。

## 字标怎么来的

直接从 `packages/contracts/src/render/html-templates/mag-22.ts` 复制了内联 SVG 的三段
字母 `<path>` 的 `d` 属性原文(y/u/j 三个字形,mag-22/mag-20 那份「yuj + 品牌渐变圆点」
的简化字标,不是完整拼出「yujee」五个字母——这是原文件本来的形状,不是我裁剪的),以及
两个渐变定义(`linearGradient`/`radialGradient`)和两个 `<circle>`。**验证方式**:
```
diff <(grep -o 'd="M2[^"]*"' mag-22.ts) <(grep -o 'd="M2[^"]*"' mag-63.ts)
```
三段路径逐字节相同。只改了:viewBox 外框的 `width`/`height`(112×47 → 132×55,与
brief 表一致)、定位(`top:979px` → `left:56px;bottom:96px`)、渐变/圆点 id 前缀
(`mag22-` → `mag63-`,避免 dev/template-check 把全部模板铺开渲染时 id 撞车,同
mag-20/22/62 之间已有的先例)。React 版 `WebMag63` 里的 SVG JSX 是同一份 `d` 路径
手工转写成 JSX 属性名(`stop-color`→`stopColor` 等 HTML→JSX 属性名转换,数值不变),
不是重新画的矢量。

## 校验遇到的坑:零槽位模板

brief 预判「全仓没有图槽和文字槽都是零的模板先例,可能撞校验」。实测:**没有撞上**,
零槽位在这套系统里是合法形状,不需要塞一个用不到的槽凑数。证据:

1. `packages/contracts/src/templates.ts` 的 `TemplateDef` zod schema:`images`/`texts`
   都是必填的**数组**字段,但没有 `.nonempty()`,空数组合法解析。
2. `validateSlotsForTemplate`(同文件)对空 `imageSlotKeys`/`textSlotKeys` 的两个
   `for` 循环体都不会执行,直接落到 `return { ok: true }`。
3. `lintTemplateHtml`(`html-template-lint.ts`)对 `tpl.texts`/`tpl.images`/
   `tpl.items` 的遍历在集合为空时天然什么也不检查;唯一的强制要求是根节点带
   `data-template="mag-63"`(已有)。
4. 实测跑通:`pnpm --filter @yujee/contracts templates:check` → `HTML 模板锚点校验
   通过(覆盖 51/51 个模板,已要求全量)`,零报错。
5. `pnpm --filter @yujee/contracts test` 115 个测试全绿,包括
   `every template HTML passes lint`、`image-slot matching hints survive the loader`、
   `every template has a valid category` 等全量遍历型测试。

**结论:校验本来就该放行这种模板,不是模板不合法。** 没有给模板塞任何用不到的槽。

## `endingSlots` 投入的调查(范围纠正后已作废的判断,但证据仍如实报告)

按原 brief 要求验证过(在收到范围纠正**之前**做的调查,过程记录如下,供归档):

- `apps/web/src/services/album/design-apply.ts` 的 `slotSpecs(templateId)` 直接
  `(template?.texts ?? []).map(...)`——`mag-63.json` 的 `texts: []`,该函数对
  `mag-63` 天然返回 `[]`。
- 同文件 `assembleDesignedPages`:`endingSlotIds = (templateOf(endingTemplateId)
  ?.images ?? []).map(s => s.id)`,`mag-63` 为空数组时
  `Object.fromEntries(endingSlotIds.map(...))` 对空数组安全返回 `{}`,不会抛错、
  不会塞空字符串。
- **范围纠正到达后**:协调方明确「那个判断作废,prompt 一个字都不要动」,理由是
  第 1/2/4 套仍用 mag-22(5 文字槽),`endingSlots` 对那三套非空,`compose_global.md`
  的结语规则对它们依然有效、不能动。第三套现在关着(`SET_LAYOUT` 第 3 行仍是
  `{ cover: 'mag-32', ending: 'mag-22' }`,读源码逐行确认,见 `design-apply.ts:258-263`),
  所以「结语没地方落」这件事眼下不会被任何一本书触发。**未改动
  `engine/src/workflows/core/compose/compose_global.md` 或 `handler.py` 任何一行。**

## 颜色机制(为什么全走 currentColor 是对的)

读 `apps/web/src/services/album/design-apply.ts` 确认:四色配色不是靠 React
props/data 传入,而是**烘焙后**的字符串级 patch——`applyDarkChrome` 用
`patchHtmlPageStyle` 在已烘的 `page.html` 根节点(`[data-template]`)上覆写
`background-color`/`color` 两个内联样式属性(`upsertStyleAttr` 把新属性追加到
style 字符串末尾,CSS 级联下后写的 `background-color` 会盖过更早的 `background`
简写,`color` 直接覆盖旧值)。`darkInkByPageIndex` 对 cover/ending 页給的是
`{ bg: colorway.bg, body: colorway.sub }`,所以页根最终 `color` 会变成
`colorway.sub`(不是 `colorway.title`)——这也是为什么截图里字标/条形码/年记三样
东西统一跟着 `sub` 色走,而不是标题的强调色,与 mag-62 的 label/label2/label3(同一批
「副标题/竖排系列名/署名」)配色口径一致。

## 五张截图

用真实产物验证(不是手画的示意图):写了一个 node 脚本用 `--experimental-strip-types`
直接 `import` 编译期的 `MAG_63_HTML` 常量,拿到浏览器最终会吃到的那份字符串本体(含真实
计算出的条形码坐标、真实 `${YEAR}`、原样的 `&quot;` 转义),对根节点的
`background:#12363A;color:#E7E3D8` 做字符串替换成四套配色 + 一组近白测试色,再用系统自带
Google Chrome headless(`--window-size=794,1123 --screenshot=`)逐张截图。

路径(都在本工作区目录下):
- `.superpowers/sdd/2026-08-09-cover-copy-and-third-set/task-13-screenshots/mag63-teal.png`
  —— 深墨绿 `#12363A` / 字色 `#E7E3D8`(THIRD_SET_COVERS teal.sub)。字标「yuj+圆点」、
  条形码 15 条竖线、右下角 `YUJEE · 2026` 均清晰可读,浅色压深底。
- `.../task-13-screenshots/mag63-cream.png` —— 奶黄 `#F9EDC4` / 字色 `#4A4A42`
  (cream.sub)。三样元素自动压深,清晰。
- `.../task-13-screenshots/mag63-pink.png` —— 粉 `#F0A4C2` / 字色 `#3A2B31`
  (pink.sub)。同上,清晰。
- `.../task-13-screenshots/mag63-navy.png` —— 深蓝 `#0E2A47` / 字色 `#C9D3DE`
  (navy.sub)。浅色压深底,清晰。
- `.../task-13-screenshots/mag63-nearwhite.png` —— `#FFFFFF` / 字色 `#1c1b18`
  (通用深墨色,非某个真实 colorway,单纯验证机制)。证明浅底上 currentColor 会自动
  压深,不是只在四个预设色上碰巧好看。

五张图逐张目视核对过:字标位置/比例、条形码位置/根数(15 条)、小字位置/内容全部一致,
只有底色/墨色四(+1)个变体不同,几何没有漂移。渐变圆点(brand accent dot)在五张图里
颜色保持不变(青→紫渐变),符合 mag-20/22 先例「渐变圆点是品牌色点缀,不跟墨色变」的
设计意图。

截图是验证产物,不在 git 提交范围内(未 `git add`),复核完可以删除
`task-13-screenshots/` 整个目录。

## 完整套件输出

### `pnpm --filter @yujee/contracts test`
115 个测试全部通过(0 fail),含
`generated templates are synchronized with template JSON files`(内部重跑
`templates:check`)、`every template HTML passes lint`、
`text slot ids follow the role-derived naming rule` 等全量遍历测试。

### `pnpm --filter @yujee/contracts templates:check`
```
HTML 模板锚点校验通过(覆盖 51/51 个模板,已要求全量)
```

### `cd apps/web && pnpm test`
```
tests 1635
suites 8
pass 1634
fail 0
cancelled 0
skipped 1
todo 0
```
(1 skipped 为改动前既有的 skip,与本次改动无关。)

### `pnpm typecheck`(仓根,含 `docs:check` + `sitemap:check` + `templates:check` +
contracts/web 各自 `typecheck`)
全绿,最后一次运行 `docs:check` 输出「文档时效校验通过。」(无未核对告警——两个
doc-scope 文档的 `checked-at` 已推到本次改动的 commit)。

### engine pytest(**未在 brief 的强制项里**——本次没碰 prompt,所以不是"必须跑"的
verification,但因为 contracts/engine 共用同一份模板 JSON 源,我额外主动跑了一遍做
交叉验证,只跑测试、没有改动任何 engine 文件)

本 worktree 没有 `engine/.venv`(brief 给的命令 `engine/.venv/bin/python` 实际不存在),
借用同机 `memoir-agent-rebuild` worktree 现成的 venv 二进制、`PYTHONPATH` 指回本
worktree 的 `engine` 目录跑测试(只执行,没有向 `memoir-agent-rebuild` 写入任何文件):

```
PYTHONPATH=engine /Users/smalldog/Desktop/yujee工程文件/memoir-agent-rebuild/engine/.venv/bin/python3 -m pytest engine/tests -q
```

结果:**382 passed, 1 failed**。唯一失败:

```
engine/tests/test_template_loader.py::test_loader_reads_shared_template_json_count
AssertionError: assert 51 == 50
```

这个测试硬编码「模板 JSON 文件数=50」,是 TS 侧 `templates.test.ts` 的
`EXPECTED_TEMPLATE_IDS` 硬编码清单在 Python loader 侧的镜像(`engine/src/workflows/
core/layout/templates.py` 是 `templates:README.md` 里写的「Python 加载器镜像
`src/templates.ts`」)。我在 TS 侧已经按 README 的「新增模板要动的地方」清单同步改了
`EXPECTED_TEMPLATE_IDS`;Python 侧这个数字没有被 README 的清单点名,是我在验证阶段
才发现的遗漏点。

**按范围纠正的明确指令「不碰 engine 的任何东西」,我没有去改这一行**(把 `50` 改成
`51` 是一行数字改动,机制上跟我已经改过的 TS 清单是同一类维护性更新,但纠正指令写得
很重——"如果你已经改了 engine 侧任何文件,回退掉"——所以我判断这不是我该自己拍板去
碰的文件)。**这是留给后续要接线 engine/SET_LAYOUT 的任务的一行已知修复**:
`engine/tests/test_template_loader.py:22`,`assert len(json_files) == 50` →
`assert len(json_files) == 51`。

**顺带验证到的一个相关隐患(来自 `.superpowers/sdd/.../progress.md` 里协调方已有的
研究笔记,我独立读源码复核过,结论一致)**:`engine/src/workflows/core/layout/
skeleton_v3.py` 的 `default_ending_template_id()` 对 `ending` 类目下所有模板 id
做字典序排序取第一个,不看图槽容量;`wrap_with_cover_ending` 拿这个 id 给
`assign_images_v3` 塞一张照片,若该模板图槽数为 0(`mag-63` 正是),`assign_images_v3`
会 `raise ValueError`。今天 `"mag-20" < "mag-22" < "mag-63"` 字典序,`mag-20`
(1 图槽)仍然胜出,所以不会触发;而且额外确认了 `wrap_with_cover_ending` 目前**只被
它自己的测试文件调用,不在任何真实路由/pipeline 里被引用**(`grep` 全仓,调用点只有
`test_skeleton_v3.py`),是尚未接线的死代码路径——不是本分支引入的新问题,但本分支
**把「0 图槽 ending 模板」从「不存在」变成了「存在但字典序恰好排在后面」**,值得在
未来给 `default_ending_template_id()` 加一个容量守卫(过滤图槽数为 0 的候选,或改成
显式表)。同样按纠正指令没有动手,只报告。

## 自查清单(brief 要求)

- **字标是不是复用 mag-22.ts 的矢量,不是重打字/重描边**——是,`diff` 逐字节核对过
  三段 `d` 路径,见上「字标怎么来的」。
- **条形码是否确定性**——是,固定 30 项宽度序列 + 固定间隔算法,零 `Math.random`;
  同一份 `BARCODE_WIDTHS` 数组在 TS 模板文件和 React 兜底组件里各自独立实现同一套
  公式(没有共享一份代码,是两个文件按同一算法各自计算——这是唯一没有完全去重的地方,
  见下「关注点」)。
- **五张截图是否真的展示了声称的内容**——目视核对过,见上「五张截图」逐张描述。
- **有没有哪次编辑把几何改离了 brief 表格**——没有。最终三处定位/尺寸
  (`left:56/bottom:96/132×55`、`right:56/bottom:96/130×38`、
  `right:56/bottom:142/130,10px,2.5px,.5`)与 brief 表格逐项相同,截图也印证了。
- **`&quot;` 是否原样存活**——是。从编译产物里 `grep -c '&quot;'` 数出 6 处
  (3 个字体名各一对开合引号),与源文件 `SANS_EN` 常量里的 3 个 `&quot;font&quot;`
  一一对应,没有被任何环节解码。

## 改动文件

**Commit `c25e0a73`**(功能提交):
- `packages/contracts/templates/mag-63.json`(新增)
- `packages/contracts/src/render/html-templates/mag-63.ts`(新增)
- `packages/contracts/src/render/html-templates/registry.ts`(登记 mag-63)
- `packages/contracts/src/templates.generated.ts`(`templates:generate` 产物)
- `packages/contracts/src/templates.test.ts`(`EXPECTED_TEMPLATE_IDS` 加 mag-63)
- `apps/web/src/components/album/templates/mag-63/index.tsx`(新增,`WebMag63`)
- `apps/web/src/components/album/web-registry.ts`(登记 mag-63)
- `.superpowers/sdd/2026-08-09-cover-copy-and-third-set/task-13-brief.md`(纳入版本控制)

**Commit `1b5e832c`**(doc-scope checked-at 推进):
- `README.md`
- `packages/contracts/templates/README.md`

**未提交、仅供复核的验证产物**(不在 git 范围内):
- `.superpowers/sdd/2026-08-09-cover-copy-and-third-set/task-13-screenshots/*.png`(5 张)

## 关注点(Concerns)

1. **engine 测试留了一个已知、未修的红**:`test_loader_reads_shared_template_json_count`
   断言文件数 50,现在是 51。修法是把 `engine/tests/test_template_loader.py:22` 的
   `50` 改成 `51`,一行、无风险,但按范围纠正的明确指令我没有动 engine 目录下任何文件。
   需要协调方(或下一个被授权碰 engine 的任务)顺手改掉,否则 engine 测试套件会一直红
   到那时候。
2. **`default_ending_template_id()` 缺容量守卫**:目前是死代码(没有真实调用点),
   不影响线上,但本分支让「0 图槽 ending 模板」第一次进入这个函数的候选池。如果未来
   给它接线(brief 提到的「analyze pipeline」注释)或者再加一个字典序更靠前的 0 图槽
   ending 模板,会在 `assign_images_v3` 直接 `ValueError`。建议后续给这个函数加个
   「优先选图槽数 > 0」的过滤,而不是纯字典序。同上,按指令没有动手。
3. **条形码算法在两处独立实现**(`mag-63.ts` 和 `mag-63/index.tsx` 的
   `WebMag63`)。两份 `BARCODE_WIDTHS` 数组字面量相同,但没有共享成一个模块——这是
   HTML 镜像(contracts 包,纯字符串产物)和 React 组件(web 包)本来就是两个独立
   package、两条渲染路径的既有代价(mag-20/22/62 的品牌 SVG/图标同样是两份拷贝),
   不是本次新引入的模式,但如果以后要改条形码序列,需要两处一起改。
4. **`YUJEE · {年份}` 用了动态年份**(`new Date().getFullYear()`),跟 mag-20/22 的
   `© {year} Yujee` 版权行同一惯例,而不是把 brief 里写的字面 `2026` 焊死。今天两种
   写法输出完全一样(`2026`),明年动态版本会变成 `2027`。这是我按同文件家族既有惯例
   做的判断,不是 brief 明确要求的,如果协调方希望这行字是不随年份变化的固定「年记/
   版次」标识,需要改成字面量 —— 请确认这个判断对不对。
