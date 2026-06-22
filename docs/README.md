# Yujee 文档索引

> 不要从头到尾读这些文档。按角色加载,见根目录 `CLAUDE.md`。

## 总入口

- [`../CLAUDE.md`](../CLAUDE.md) —— 项目说明 + 角色 → 文档映射 + 不变式
- [`architecture.md`](./architecture.md) —— 架构骨架 + 不变式完整版

## Agent 子文档(`docs/agent/`)

| 文件 | 内容 | 谁需要 |
|---|---|---|
| [`agent/contract.md`](./agent/contract.md) | Web↔Agent 协议:req/res + 错误码 + 状态机 | Agent 接入(Web 侧)· Agent 服务作者 |
| [`agent/design.md`](./agent/design.md) | Agent 内部分层 + pipeline + failover + validation | Agent 服务作者 |

## Web 子文档(`docs/web/`)

| 文件 | 内容 | 谁需要 |
|---|---|---|
| [`web/layering.md`](./web/layering.md) | 四层架构 + 依赖方向 | 所有 Web 工程师 |
| [`web/directory.md`](./web/directory.md) | Web 目录到文件级 | 新增文件前必读 |
| [`web/conventions.md`](./web/conventions.md) | 命名 + Route/Service/Repo 模板 | 所有 Web 工程师 |
| [`web/errors.md`](./web/errors.md) | AppError + 错误码集中表 | 写 route / service 的人 |
| [`web/database.md`](./web/database.md) | 所有表 schema + 索引 + 状态机 | 写 repo / migration 的人 |
| [`web/api.md`](./web/api.md) | API 接口清单 + 浏览器核心流程 | 写 API / UI 的人 |

## 部署(`docs/deploy/`)

| 文件 | 内容 | 谁需要 |
|---|---|---|
| [`deploy/env.production.md`](./deploy/env.production.md) | 生产环境变量参考(按 Web / Agent 分组) | Infra · 上线核对 |

---

## 阅读流程提醒

1. 任何任务开始前 → 读 [`../CLAUDE.md`](../CLAUDE.md)
2. 然后读 [`architecture.md`](./architecture.md)
3. 然后按 `CLAUDE.md` 的角色清单加载起手子文档
4. 任务过程中遇到清单外细节,按需打开对应子文档查证

修改任何子文档需要架构师 review。
