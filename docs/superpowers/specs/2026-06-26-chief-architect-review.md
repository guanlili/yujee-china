# 总架构师审核报告 — 6 板块详设

- 日期:2026-06-26
- 审核对象:detail-shared / stage1 / stage2 / stage3 / stage4 / stage5(均在 specs/)
- 基准:蓝图 v2 锁定的边界 I/O + 全局决策 + 现有 v3.ts/schemas.py 代码核对

## 总结论:条件性 PASS(需修订)
骨架健康、**穷尽性达标、边界清晰、共享件单点定义无重复**,可开工。但有 3 个 Blocker 必须先消解,4 项须 boss 拍板(多为越不变式/加依赖,boss 已定方向、需正式登记),其余板块自修。

## Blocker(开工前必消)
- **B1 history 归属**:对话消息单一真相 = `agent.edit_messages`;Web `album_messages` 在 edit-chat 路径**停写、保留只读、不镜像**。Stage3 + Web 文档写死。
- **B2 跨两库提交弱一致**(=D3,须 boss):agent 库写会话/操作、Web 库写相册,无分布式事务;方案自洽(version CAS + progress 投影自愈)但**偏离"单写入者原子"不变式** → boss 确认后登记 architecture.md。
- **B3 模板预览图资产**:裁定 烘焙脚本入 `apps/web/scripts/`(不新增顶层目录);产物存 `packages/contracts/template-previews/`(随模板库,Stage2/Stage3 共用一份)。Stage2 文档把路径定死。

## Should-fix(板块自修)
- **S1 V3JobStage 词表**:Stage1/Stage2 各提一套且无 owner → 指定**契约板块**为单一 owner,统一为一张终表(引入 jobKind 维度)。
- **S2 callback 去 pages**:用**过渡形态 `pages?: optional`**(非直接删),让 Web 渲染改造与 Stage2 上线解耦;两端同步。
- **S3 私有函数提升公开**:`_clean_texts`/`_page_slot_specs` 提升归 **Stage3**;`_apply_page` 提升归 **Stage4**;Stage5 只消费。三文各补一句认领,消除"都以为对方提升"。

## 待 boss 决策
- **D1/D2 agent 自有库**:加依赖(sqlalchemy/asyncpg/alembic)+ 加 `apps/agent/migrations/`(Alembic)+ agent 无状态→有状态 + Fly 注入 DATABASE_URL。方向已定,**须正式登记 architecture.md**(CLAUDE.md 铁律)。
- **D3 跨两库弱一致**(=B2):确认容忍"agent 多记一条 op、相册这次没落"的弱一致。
- **D4 finalize_color 保留 + 逻辑(boss 待给)**:★颜色分工 = **颜色识别(代码,Stage1 1d `accent_of_group` 出提取色,作依据)+ 颜色设计(AI,Stage4「颜色设计」skill,吃提取色出最终色)+ finalize_color 归一化**。finalize_color **保留**:AI 设计出的章节色经它定最终 hex。**封面色已定 = 同一套模型**:代码 `accent_from_photo` 从封面照片出提取色 → AI「颜色设计」skill 设计封面色 → finalize_color 归一化。颜色算法签名已锁,finalize_color 逻辑待 boss。
- **D5 颜色识别取色数值(新增)**:`accent_color` 识别/提取的固定 L/S 与阈值(V_HI/S_HI/V_LO/S_LO)= 可调设计常量,最终值待 boss 定(流程口径已定,见 detail-stage1 §1d)。

## 穷尽性:全链路有主,无整段缺口。orphan 子项均已在上表指派归属。

## 共享 5 风险裁定
1 弱一致=需 boss(D3) · 2 加依赖/目录=需 boss(D1/D2) · 3 history=需改(B1) · 4 预览图存放=需改(B3) · 5 颜色识别代码化 + 颜色设计=AI + finalize_color 保留=**已并入决策,描述已修正**。

### 风险 5 重要修正(实测代码 + ★颜色分工决策)
共享文档原称"`_coerce_accent`/`apply_theme_v3`/`finalize_v3` 三处各自钳色"**不准确**:**只有 `_coerce_accent`(theme_recommend/handler.py:329)真做设计色→hex 归一化**;`_apply_page`(apply_theme_v3.py:130)、`_bake_text_slots`(finalize_v3.py:262)只是**消费**已合法色、不归一化。
★决策:**颜色设计 = AI + 「颜色设计」skill**(Stage4,AI 拿章节描述 + Stage1 1d 提取色作依据出最终色);**颜色识别 = 代码**(Stage1 1d `accent_of_group` 出**提取色**喂 AI,参考 accent_color.py,是依据非最终色);**finalize_color 恢复**(AI 出色经它/`_coerce_accent` 归一化成最终 hex)。`_coerce_accent` **保留**(它就是 finalize_color 在 recommend 端的落点)。新模型下:章节色来自 Stage4(AI 设计→finalize_color)、封面色来自 Stage5(代码 `accent_from_photo` 出提取色 → AI 设计 → finalize_color,同一套);下游 `_apply_page`/`_bake_*` 收到的 accentColor 一律已合法。**唯一出色口 = finalize_color,铁律在新模型下仍成立、无第二条路径**(Stage4 detail v3 已正确:字体+颜色+风格)。

## 一致性核对
① describe 去 pages ↔ Stage2 产 pages ↔ callback:一致,用 optional 过渡(S2)。
② /v3/edit-chat 取代旧端点:一致。
③ recommend 改 3 组(★字体+颜色+整体风格,AI 用「颜色设计」skill 吃提取色作依据)、apply-theme 零契约变更:**成立**(apply_theme 多章守卫存在,V3ChapterThemeChoice[] 形状不变,Web 编排展开;accentColor 字段值取 Stage4 AI 设计经 finalize_color 的最终值)。
④ /v3/cover EXTEND:一致(+coverPhoto/hint/userMessage/history/needsUserInput,route 改 async)。封面色已定 = 与章节色同一套模型:代码 `accent_from_photo` 从封面照片出提取色 + AI「颜色设计」skill 设计 + finalize_color 归一化。
⑤ 出色口核对:★颜色识别 = 代码(章节色 `accent_of_group` / 封面色 `accent_from_photo`,出提取色作依据);颜色设计 = AI「颜色设计」skill(吃提取色出最终色,章节色 Stage4 + 封面色 Stage5 同一套);finalize_color 归一化 = 唯一出最终色口(章节色 Stage4、封面色 Stage5)。成立(见风险 5 修正)。
⑥ T-history 归 agent 库 → Web album_messages 角色:=B1。
⑦ ★颜色分工一致性:detail-stage1 §1d / blueprint §0·§2·§5 / detail-stage4 v3 / detail-stage5 / detail-shared §1·§1A 口径一致 —— 颜色识别=代码出提取色(章节色 `accent_of_group` / 封面色 `accent_from_photo`);颜色设计=AI+「颜色设计」skill 吃提取色出最终色(章节色 + 封面色同一套);finalize_color 恢复(归一化最终 hex,章节色 + 封面色)。无残留"Stage4 不出颜色 / 章节色纯代码出最终 hex / finalize_color 降级 / 封面色待定"旧表述。

---

## 二轮外部评审(B1–B10 / M1–M10)逐条核实结论
> 说明:此处编号沿用**外部评审反馈**的编号(与本报告上文 Blocker B1/B2/B3 是两套体系,勿混)。每条已到文档核实"是否真存在",真存在的按绑定结论改并标【已解决】,误报标【经核实不成立·未改】。

**Blocker**
- **B1 gemini_layout 候选 owner 冲突**【已解决】:blueprint §2/§4/§5 原写"请求带 candidates / 200px真图+模板预览"与 detail-stage2 §2.3/detail-shared §2.3「模块内部组装」矛盾。统一为**模块内部组装**(调用方只传 units{...photos{photoId,ref200px,orientation,takenAt}};candidates 由 `gemini_layout` 用 `legal_candidates` 算 + 加载预览图)。改:blueprint §2/§4/§5、detail-stage2 §1.2/§2.1/§2.3、detail-shared §2.2。
- **B2 case4 拿不到 200px**【已解决】:edit-chat 请求体确无 base64(Stage3 §1/§7),detail-shared 仅写模糊"Web 重发"。定 `GET /internal/agent-data?type=page-photos` → `{photoId,ref200px,orientation,takenAt}` 喂 gemini_layout。改:detail-shared §4.1/§4.3、stage3 §5(T4)/§7。
- **B3 写协议漏 pagesTexts**【已解决】:stage3 记录步骤(§1/§3/§8)只写 patches,CommitBundle 却有 `pagesTexts?`。记录步骤改为 **patches + pagesTexts**。改:stage3 §1/§3/§8。
- **B4 弱一致污染 history**【已解决】:agent 先写 message/op、Web 后落相册,原仅"无害冗余"容忍 → T-history 会读到相册未落的动作。加 **opId + status(pending/committed) + `POST /internal/agent-ack {opId}` + T-history 只读 committed**。改:stage3 §1/§2/§3/§4.1/§5/§7、detail-shared §4.6/§5.4。
- **B5 progressDecision 无 schema**【已解决】:与 `V3StoryProgress{currentChapterId,doneChapterIds[]}`(无 pageDone/stage)对不上。定 `{pageDone?,chapterDone?,advanceTo?:'theme'|null}` + 写明映射(pageDone 不进 progress→落 pages.completion;chapterDone→doneChapterIds;advanceTo→albums.stage)。改:stage3 §4.1/§7。
- **B6 Agent DB 表名不一致**【已解决】:detail-shared(edit_sessions/edit_messages/edit_operations)vs stage3(edit_session/edit_message/edit_op)。统一为复数 **edit_sessions/edit_messages/edit_ops**。改:detail-shared §5.4、stage3 全文。
- **B7 Stage4 主题 schema 不可执行**【已解决】:原 `palette` 写"含逐章 accent 或可推导规则",apply-theme 拿不到确定逐章色。定 `V3BookThemeOption{optionId,artFont,chapters:[{chapterId,accentColor,subject?}]}`(每章确定 accentColor),删含糊表述。改:stage4 §2.2/§2.3/§3/§4/§7、blueprint §2。
- **B8 封面当一章刷不成立**【已解决】:stage5 §6 复用章级刷色但封面/封尾无 V3Chapter、artFont 来源未定;finalize 逐章 carrier bake 不触及封面页。改**页级直刷**(不经 chapter tree;`apply_page` 刷色 + 页级写 `#artFont` carrier 键);artFont=选中 option 的全书 artFont。改:stage5 §6/§9。
- **B9 extractedColor 未登记契约**【已解决】:stage1 1d 加 `extractedColor` 但 `V3Chapter`/`V3ChapterOverview`(均 `.strict()`)未登记 → 解析必失败。加契约变更 **C3**(v3.ts + schemas.py 同步加 `extractedColor: AccentColor?`)。改:stage1 §契约变更 C3。
- **B10 Stage2 缺 takenAt**【已解决】:`SelectLayoutRequest` photos 缺 takenAt,而 `fill_generic_copy` 的 date/dateNum 依赖 takenAt(Stage2 不持完整 tree)。请求 photo ref 加 **takenAt**。改:detail-stage2 §1.2/§6、detail-shared §2.2、blueprint §2/§5。

**Major**
- **M1 全余量矛盾**【已解决】:stage1 §1a 退化写"或全进 unplaced 交 1b",但 1b 只归入已有章 → 全余量时无目标章。改 1a **至少建 1 章**(硬约束,禁全进 unplaced)。改:stage1 §1a。
- **M2 1b 破坏 cluster 不跨章**【已解决】:1b 按单图归组、无 cluster 原子约束。加 **cluster 原子**(同 clusterId 余量图整簇归同章;完整 cluster 不被打散)。改:stage1 §1b 护栏。
- **M3 候选容量 vs allowAddPages**【已解决】:候选按整章 N 取,与 §2.5 多页排版冲突(每页 slot 远小于 N)。改**按页容量桶**(候选池 = 各页容量桶 legal_candidates 并集)。改:detail-stage2 §2.4 + §5.1 步骤 2。
- **M4 合法化丢 Gemini slot**【已解决】:§5.1 步骤 3 无条件 `assign_images_v3` 重塞,丢 Gemini 图→槽决策。改**只修非法、保留合法 Gemini slot,assign 仅兜底**。改:detail-stage2 §5.1。
- **M5 DeepSeek 看 base64**【已解决】:stage5 §0/§2.1/§3 让 DeepSeek "看" coverPhoto base64(DeepSeek 纯文本)。改 **DeepSeek 不收 base64**(base64 只给代码 `accent_from_photo` 取色;文案/AI 颜色设计吃 `coverPhotoDesc` 文字 + 提取色 hex)。改:stage5 §0/§2.1/§3/§5、blueprint §2。
- **M6 交互无硬上限**【已解决】:stage5 §3 反问只靠 prompt 控制,代码无上限。加**代码层 `MAX_COVER_CLARIFY_ROUNDS`,触顶强制成稿**。改:stage5 §3.1。
- **M7 Cover*Result 未定义**【经核实不成立·未改】:依据 stage5 §2.2(lines 78-80)**有意**把契约边界定为"页级 patch + `needsUserInput` + `assistantReply`"(均已是 §2.2 字段),**不单列 coverTexts/endingTexts/Cover*Result**;5a/5b 内部模型输出形状属"不含 prompt/算法/token"的声明高度之下,非契约层缺口或矛盾。故不构成问题。
- **M8 pages 迁移口径不一**【已解决】:chief S2 要 `pages?: optional`,stage1 callback 契约 C1 主写"删除该字段"。统一 callback `V3AnalyzeCompleted.pages` 为 **optional 过渡形态**(`V3AnalyzeResult.pages`=describe 内部结果,确为删除,非同一字段,不动)。改:stage1 §契约变更 C1。
- **M9 预览图路径未收敛**【已解决】:chief B3 已裁定但 stage2 §3/§9 + detail-shared §7-4 仍写候选/待定。统一为**脚本 `apps/web/scripts/` + 产物 `packages/contracts/template-previews/`**。改:stage2 §3.1/§3.3/§9、detail-shared §7-4。
- **M10 残留**【已解决】:stage2 末尾 `</content></invoke>` 杂散标签删除;stage5 §9 `V3ChatThemeChoice` typo 改 `V3ChapterThemeChoice`。改:stage2 §9、stage5 §9。
