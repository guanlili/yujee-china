"""跨流程共享的业务工具:patch 分类、edit 协议、Web 数据客户端。

编辑环节(/v3/edit-chat)的编排已迁到 agents/edit_loop;本包只保留被多个流程复用的
纯工具:patches(patch 分类 / 页焦点)、schema(EditRepo/EditTools 协议)、web_client
(WebAgentDataClient)。按需从子模块导入(`from ..story import patches` 等)。
"""

from __future__ import annotations

__all__: list[str] = []
