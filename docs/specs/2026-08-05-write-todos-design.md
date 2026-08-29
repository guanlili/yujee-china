# write_todos：设计 Agent 的复诵式长任务计划工具

日期：2026-08-05。参考实现：deepagents / langchain `TodoListMiddleware`（Claude Code
TodoWrite 的开源复刻）。背景：design-agent 处理「整本换模板、逐页批量调整」这类要
几十次读写工具调用的长任务时，没有任何计划机制，模型走到一半会丢目标跑偏。

## 机制选择

三种业界做法里选**复诵式（recitation）**：一个只写不执行的 `write_todos` 工具，
让模型自己维护待办清单。每次调用**整表覆盖**——模型必须把完整列表重新吐一遍，
这个吐写动作本身（tool call 参数 + 回执）就把计划持续顶在 context 近端，对抗跑偏。

不选 OpenManus 式框架编排（计划锁死、执行中无法调整，不适合对话式改书）；
不选 MetaGPT 式结构化 Plan/Task（依赖图 + replan 对本场景过重）。已知风险：
deepagents 0.7.0 起把该工具从默认栈移除（对新模型收益减小），所以本设计把规则
压缩到最小，收益不明显时可以整体摘除（一个工具 + 一段 prompt，无其他耦合）。

## 数据结构与存放

```ts
interface AlbumTodo {
  content: string;                                      // 非空
  status: "pending" | "in_progress" | "completed";
}
```

**工具完全无状态**——与 deepagents 不同，不在服务端存副本。当前计划的唯一载体
就是对话历史里最近一次 `write_todos` 的参数与回执（复诵本义：每次写就是一次读），
session 消息跨轮保留，用户说「继续」时计划自然还在。`details` 随现有 tool_call
事件进 trace/NDJSON，将来 Web 要渲进度条从事件流取最近一次即可。收益不明显时
摘除成本 = 一个工具函数 + 一段 prompt。

## 工具行为

- `write_todos`，参数 `{ todos: AlbumTodo[] }`，整表覆盖；空数组 = 清空计划。
- **no-op**：不碰书状态、不设 `terminate`。回执把列表渲染成 `[ ]/[→]/[✓]` 文本
  （复诵载体）。`details` 带 `{ todos, counts }`，随现有 tool_call 事件进 trace，
  Web 端将来可用它渲进度条（本次不做 UI）。
- 校验（execute 内 throw，与 search_book 同风格）：todos 必须是数组、content 非空、
  status 三选一、最多 30 条。
- **不进** web 侧 `DESIGN_WRITE_TOOLS`（`has()` 白名单，非写工具天然不产生 designOps，
  与 read_page 同类，无需同步）。

## Prompt 分工

- 工具 description（会随 formatToolsBlock 进系统提示词）：说清「是什么 + 什么时候
  用/不用」。
- 系统提示词新增「长任务规划」节，规则四条：≥3 步/页的任务先写计划，简单任务禁用；
  开工前标 in_progress（除非全完成，任何时刻至少一项 in_progress），完成立刻标
  completed 不许攒批；计划可随时增删改，遇阻塞不标完成而是新加条目；一轮最多调用
  一次，最终答复必须出现在最后一次 write_todos 之后。

## 测试

节点测试（node:test，沿用 createHarness 模式）：注册；整表覆盖语义；回执复诵格式；
清空；校验拒绝（非法 status/空 content/超 30 条）；书状态逐字节不动、version 不变、
不 terminate。

<!-- doc-scope
paths: packages/design-agent/src/core/album/tools.ts, packages/design-agent/src/core/album/system-prompt.ts
checked-at: a7db82ef
-->
