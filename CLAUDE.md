# Yujee(遇己) Agent 起手约束

本仓是 AI 人生纪念册应用:

```text
Browser -> Web (Next.js) -> Agent (FastAPI)
             |
             v
       Postgres + Cloudflare R2
```

`docs/` 已删除。不要再引用或恢复旧 docs 体系。

## 必读顺序

1. 仓根 `README.md`:系统总框架和当前工作流。
2. 做 Web 相关任务:再读 `apps/web/README.md`。
3. 做 Agent 相关任务:再读 `engine/README.md`。
4. 改跨服务字段:读 `packages/contracts/src/v3.ts` 和 `engine/src/contracts/schemas.py`。
5. 改模板:读 `packages/contracts/templates/README.md` 和对应 JSON。

## 当前重要现实

- Agent 当前 route surface: `/v3/analyze`, `/v3/select-layout`, `/v3/judge-page-template`, `/v3/design`。
- 排版是**一次确定性选版**:`/v3/select-layout` 直接回调 `completed` + 完整 `pages`,没有候选缩略图/评委来回。
- 旧 edit-chat/theme/cover/finalize 等 Agent 能力已经从当前路由层剥离;不要把旧文档或旧假设写成现状。
- Web 仍可能保留更完整的路由/client 壳。判断端到端能力时必须同时看 Web caller 和 Agent `routes.py`。

## 动手规则

- 先读真实文件和 `git status`;不要按记忆或旧 docs 下结论。
- 不恢复用户删除的文件,除非用户明确要求。
- 新增顶层目录、依赖、数据库 schema、外部 API、Web<->Agent 协议前,先说明影响面。
- 临时脚本、验证产物、trace 文件用完即删。
- 长期说明放在仓根 README、对应 app README,或靠近模块的小 README;不要重新扩张大 `docs/` 树。
- 推送/PR/合并前先跑相应验证;没验证不要声称通过。
