# 合并后文档时效核对报告

分支 `spec/third-set-design`,当前 HEAD `509faba4`(`Merge branch 'main' into fix/photo-upload-r2-direct`)。
三份文档(`CLAUDE.md` / `README.md` / `apps/web/README.md`)的 `checked-at` 在合并时都被冲突解决成了 main
的旧值 `144a62d5`,尽管分支侧在合并前已各自把它们推进到 `a0b148a6` / `a0b148a6` / `01a977d4`(见下方
「合并前状态」核实)。本报告核对内容是否仍属实,并把三份 `checked-at` 一并推进到 `509faba4`。

## 先核实:合并冲突的真实形状

```
                CLAUDE.md    README.md    apps/web/README.md
branch(8128c72e)  a0b148a6     a0b148a6     01a977d4
main(da035c2c)     144a62d5     144a62d5     144a62d5
merged(509faba4)   144a62d5     144a62d5     144a62d5
```

`git show 509faba4 -- apps/web/README.md` 证实合并把分支侧已改好的正文(游客占位书段落)保留了下来,
只有 `checked-at` 尾块被解成 main 的旧值 —— 即任务描述的「两边都推进过、冲突解成了 main 的值」。这意味着
分支自己那次核对(`a0b148a6`/`01a977d4`)已经把「本分支范围内的改动」核对过一轮;我在下面重新独立核对一遍,
不是照抄分支侧结论。

## 核对范围怎么定的

对每份文档,用 `git log --oneline 144a62d5..HEAD -- <doc-scope paths>` 精确找出「自上次 checked-at 以来、
落在该文档 paths 内」的提交,不猜测:

- **CLAUDE.md**(`apps/web/src/app/api/**` 等):只有 `a0b148a6`(coverColorway 透传)+ merge 本身。
- **README.md**(同上 + `packages/contracts/templates/*.json`):`a0b148a6` + `59d2b84c`(新模板 mag-62)+ merge。
- **apps/web/README.md**(`apps/web/src/services/**` 等):第三套/coverColorway 全部 14 个提交
  (`5ef8d702` … `8128c72e`)+ merge —— 逐个核对后确认这 14 个提交**就是**第三套深色配色这一个功能分支的
  全部提交,没有混进无关改动。

任务里提到的「engine 侧 compose 全局批次改动」(`bb8d0ea4`/`0d76f84d`/`c7275e06`)落在 `engine/src/workflows/`
下,不在任何一份文档的 `doc-scope paths` 里(三份文档都只把 engine 的 `routes.py` 纳入 scope),因此不是
`docs:check` 报错的原因。但我仍然读了这三个提交并检查了三份文档里所有提到「标题兜底」「全局批次」「年份/
地名」字样的段落,确认没有文档对 compose 内部这块做过会被这次改动打脸的具体描述(见下方逐文档核对)。

## CLAUDE.md

**读了什么**:全文,重点是「生成 Agent」「设计 Agent」两节和 `doc-scope`。

**对照什么**:`apps/web/src/app/api/v3/albums/[uuid]/design/route.ts`(新增 `coverColorway` 可选字段)。

**判断**:文档里唯一涉及设计环节请求体的段落是:

> 生成链路只剩**一次** AI 调用:`/v3/compose`(按章并发的 Gemini 成稿,看真实照片 + 读用户故事,外加一次
> 全局封面/封尾/字体)。

以及「已设计的书追加照片后……空 `coverSlots`/`endingSlots`……engine 侧全局批次因此直接跳过」一句。两处都
不逐字段列举 `POST /design` 的请求体,只讲「封面/封尾/字体」这个粒度,`coverColorway` 是这个粒度下「封面」
的一个子维度(且当前第三套关闭、颜色是系统按 albumId 派定而非用户可选,不影响「用户选」这类表述的真实性)。
文档在这个细节层面本来就没有断言,不存在被打脸的具体句子。

**改了什么**:无正文改动,只推进 `checked-at`。

## README.md

**读了什么**:全文,重点是「当前工作流」第 6 步和「继续阅读」前的模板段落。

**对照什么**:`design/route.ts` 的 `coverColorway` 新增字段;`packages/contracts/templates/mag-62.json`
(新增封面模板)。

**判断的段落**:

> 6. 用户在设计卡里选封面/封尾组合与书页底色(文字三色是确定性恒黑,不由模型决定)。

同 CLAUDE.md,不列具体字段,`coverColorway` 不会让这句变假。

> 渲染簇与全部 HTML 模板在 `packages/contracts/src/render/`(模板数以
> `packages/contracts/templates/*.json` 为准,别在文档里手抄计数)。

这句是此前专门为了防止模板计数漂移而写的免疫条款 —— `mag-62` 加入模板池后,这句依然成立(文档本来就没
手抄数字)。全文 grep `mag-` 只命中"改模板读对应 JSON"这类通用指引,没有任何具体模板 id 或数量的硬编码。

**改了什么**:无正文改动,只推进 `checked-at`。

## apps/web/README.md(重点核对)

**读了什么**:全文,重点是「游客模式」段落、"Generation Flow" 代码块和 append-compose 段落。

**对照什么**:`apps/web/src/services/album/design-apply.ts` 的 `buildCoverTextBase`/`coverTextBase`/
`placeholderCoverTextBase`,`apps/web/src/services/album/album-service.ts` 的 `applyPlaceholderDesign`,
`apps/web/src/services/job/job-service.ts` 的 `mergeComposeIntoDraft`(`textBaseOf = isPlaceholder ?
placeholderCoverTextBase : coverTextBase`)。

**判断的段落**(这是任务点名要重点确认的一段):

> 游客模式(匿名影子账号,anonymous 插件):落地页点「发送」即静默建号,免登录走完建相册 → CLIP 分组 →
> 讲故事 → 选版 → 确认封面(**占位成稿**:内页保留模板 sample,封面/封尾也全量落模板 sample(含非标题
> 槽)—— 占位书本来就明示是「示例」,不存在印模板作者年份地名的顾虑,靠它撑住游客的第一印象;真成稿路径
> 只兜标题槽不变,见 `design-apply.ts` 的 `coverTextBase`/`placeholderCoverTextBase`),
> `albums.copy_source='placeholder'`,零 AI/零积分/零 R2)→ 本地导出。

逐句核对代码:

- `design-apply.ts` 的 `buildCoverTextBase(templateId, { albumTitle, allSlots })`:`allSlots=false`
  (`coverTextBase`,真成稿路径)只保留 `role==='title'` 的槽;`allSlots=true`
  (`placeholderCoverTextBase`,占位书路径)非 title 槽也回落 `sample`。与文档「真成稿路径只兜标题槽不变」
  「封面/封尾也全量落模板 sample(含非标题槽)」逐字对得上。
- `job-service.ts:278` `const textBaseOf = isPlaceholder ? placeholderCoverTextBase : coverTextBase;`
  —— 证实 compose 回调落库(真成稿)走 `coverTextBase`。
- `album-service.ts` 的 `applyPlaceholderDesign`:不建 `agent_jobs`、不调 Agent、同步
  `mergeComposeIntoDraft(..., isPlaceholder=true)`、`copySource: 'placeholder'`,函数注释自身写着
  「不派 compose、不碰 Gemini、不动积分」——对应文档「零 AI/零积分/零 R2」。

结论:这段文字与当前代码**完全一致**,是分支在合并前已经改对、只是 `checked-at` 尾块在合并中被冲掉的
情况(即 `git show 509faba4` 里 combined diff 显示的:main 侧还是旧的「模板 sample 文案」一句,分支侧
已经是现在这个更详细的版本,合并干净地取了分支侧)。

其余两处相关段落同样核对过:

> 已设计的书之后再加照片……请求(Agent 侧全局批次因此跳过,不写封面不动字体)。

对照 `engine/src/workflows/compose.py:213` `if not req.coverSlots and not req.endingSlots: ...
global_dropped`——空槽跳过全局批次的机制未被 `bb8d0ea4`/`0d76f84d`/`c7275e06` 三个提交改变(它们改的是
全局批次**跑起来之后**的 prompt 规则和入参,不是"要不要跑"的判断条件),文档这句依然成立。

第三套(深色椭圆/`coverColorway`/`SET_LAYOUT`/`THIRD_SET_INTERIOR`)的全部机制,本文档**完全没有提到**
——`grep -n "第三套\|四套\|SET_LAYOUT\|coverColorway\|colorway"` 在 `apps/web/README.md` 里零命中。这属于
「文档确实不涉及这层细节」:第三套目前处于关闭态(`design-apply.ts` 里 `SET_LAYOUT` 第 3 行指回 `mag-32`
的注释已经说明),它的选择逻辑、深色配色链路都只在 `design-apply.ts`/`job-service.ts` 内部注释里交代,
不是这份面向读者的服务级 README 该展开的层级 —— 与 "Key files" 一节里 `design-apply.ts` 的既有描述
（「设计环节的确定性应用层(封面组规则、carrier sweep、组页、字体兜底),零 AI」)口径一致,没有需要补的
断言,也没有被打脸的断言。

**改了什么**:无正文改动,只推进 `checked-at`。

## 未改动的原因小结

三份文档在各自 `doc-scope` 覆盖范围内,对本分支改动(`coverColorway` 请求体字段、四套固定表、第三套深色
管线、mag-62 模板、compose 全局批次的地点/年份注入、相册标题兜底调整)要么没有具体到会被打脸的断言,要么
——apps/web/README.md 的占位书段落——已经在合并前被正确改写,只是 `checked-at` 尾块没跟上。因此三份文档
本轮都是「核对通过,内容属实,只推进戳记」,没有一处需要改写正文。

## 最终 docs-check 输出

```
$ node scripts/docs-check.mjs
文档时效校验通过。
```

（exit code 0)
