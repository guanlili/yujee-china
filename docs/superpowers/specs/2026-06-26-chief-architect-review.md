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
- **D4 finalize_color 去留 + 逻辑(降级)**:★章节色已改为 **Stage1 1d 代码取色**(`accent_of_group`),不再需要 finalize_color;Stage4 不出色。finalize_color 现**仅可能服务封面色**——封面色是否仍用豆包通用色(经 finalize_color)还是改用同套 `accent_from_photo` 代码取色 = **待 boss 在 Stage5 定**。若封面色也走代码取色,则 finalize_color 可整体删除。颜色算法签名已锁,逻辑待 boss(仅当封面色仍用通用色时才需要)。
- **D5 章节色取色数值(新增)**:`accent_color` 取色的固定 L/S 与阈值(V_HI/S_HI/V_LO/S_LO)= 可调设计常量,最终值待 boss 定(流程口径已定,见 detail-stage1 §1d)。

## 穷尽性:全链路有主,无整段缺口。orphan 子项均已在上表指派归属。

## 共享 5 风险裁定
1 弱一致=需 boss(D3) · 2 加依赖/目录=需 boss(D1/D2) · 3 history=需改(B1) · 4 预览图存放=需改(B3) · 5 章节色改纯代码取色 + finalize_color 降级=**已并入决策,描述已修正**。

### 风险 5 重要修正(实测代码 + ★章节色决策)
共享文档原称"`_coerce_accent`/`apply_theme_v3`/`finalize_v3` 三处各自钳色"**不准确**:**只有 `_coerce_accent`(theme_recommend/handler.py:329)真做通用→hex 归一化**;`_apply_page`(apply_theme_v3.py:130)、`_bake_text_slots`(finalize_v3.py:262)只是**消费**已合法色、不归一化。
★决策变更:**章节色改为 Stage1 1d 纯代码确定性取色**(`accent_of_group`,参考 accent_color.py),既已纯代码出 hex,**`_coerce_accent` 随章节色移出 Stage4 而废弃/删除**(recommend 端不再产色)。新模型下:章节色来自 Stage1(代码 hex)、封面色来自 Stage5(待定),Stage4 不出任何色;下游 `_apply_page`/`_bake_*` 收到的 accentColor 一律已合法。**"唯一/不重复出色口"铁律在新模型下仍成立、无第二条路径**(Stage4 detail v2 已正确:只字体+风格)。

## 一致性核对
① describe 去 pages ↔ Stage2 产 pages ↔ callback:一致,用 optional 过渡(S2)。
② /v3/edit-chat 取代旧端点:一致。
③ recommend 改 3 组(★只字体+整体风格,不出颜色)、apply-theme 零契约变更:**成立**(apply_theme 多章守卫存在,V3ChapterThemeChoice[] 形状不变,Web 编排展开;accentColor 字段值取 Stage1 1d 已定值,不在本环节产生)。
④ /v3/cover EXTEND:一致(+coverPhoto/hint/userMessage/history/needsUserInput,route 改 async)。封面色取色方式(豆包+finalize_color vs 同套代码取色)= 待 boss 在 Stage5 定。
⑤ 出色口核对:★章节色 = Stage1 1d 代码取色(`accent_of_group`,非 finalize_color);Stage4 不出色;finalize_color 后无第二出色口,且现仅可能服务封面色(待 Stage5)。成立(见风险 5 修正)。
⑥ T-history 归 agent 库 → Web album_messages 角色:=B1。
⑦ ★章节色归属一致性:detail-stage1 §1d / blueprint §0·§2·§5 / detail-stage4 v2 / detail-shared §1·§1A 口径一致 —— 章节色 = Stage1 代码取色;Stage4 只字体;finalize_color 仅可能服务封面(待 Stage5)。无残留"模型出章节色 / finalize_color 管章节色"旧表述。
