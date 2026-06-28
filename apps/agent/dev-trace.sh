#!/usr/bin/env bash
# 本地起 agent 服务 + 开启 LLM 追踪。
# 每次 AI 调用(火山识图 / DeepSeek 文案)的「系统指令 + 用户上下文(图片脱敏)+ 模型输出」
# 都会追加到 trace 文件,实时 tail 出来,看清每一步 AI 在想什么。
#
# 用法:
#   bash apps/agent/dev-trace.sh            # 起服务 + 实时追踪
#   tail -f apps/agent/llm-trace.txt        # 另开终端单独看
#
# 触发流程:本地 Web(:3000)走一遍编辑器,或直接按 docs/agent/contract.md 调 V3 端点。
set -euo pipefail

cd "$(dirname "$0")"

TRACE_FILE="${1:-$(pwd)/llm-trace.txt}"
PORT="${PORT:-8001}"

# 每次启动清空旧 trace,避免和上一轮混在一起
: > "$TRACE_FILE"

export YUJEE_LLM_TRACE="$TRACE_FILE"

echo "=========================================================="
echo "  Agent 服务   : http://localhost:$PORT"
echo "  健康检查     : curl http://localhost:$PORT/health"
echo "  LLM 追踪文件 : $TRACE_FILE"
echo "  追踪内容     : 每步 AI 的 system / user / output(base64 图脱敏)"
echo "=========================================================="
echo "  跑一遍编辑器流程后,下方会实时打印每个 AI 步骤的输入输出。"
echo "  Ctrl-C 退出(服务和 tail 一起关)。"
echo "=========================================================="

# shellcheck disable=SC1091
source .venv/bin/activate

# 后台起服务,前台 tail trace;退出时一起收掉
uvicorn src.main:app --reload --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; exit 0' INT TERM

# 等服务起来再开始追踪
sleep 2
tail -f "$TRACE_FILE"
