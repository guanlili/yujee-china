"""AI trace 观测台:渲染 ai-trace.jsonl 里每次 AI 调用的输入/输出/图片。

engine(workflow 各环节)与 design-agent(:8787)共写一份 JSONL;这里起一个只读
HTTP 服务把它变成可视页面 —— 重点是把「视觉评委到底收到了什么图」直接画出来。

用法:
    .venv/bin/python trace-viewer.py            # http://127.0.0.1:8788
    .venv/bin/python trace-viewer.py --port 8788 --file /path/to/ai-trace.jsonl

无第三方依赖,杀掉即走。AI_TRACE_JSONL 环境变量可代替 --file。
只读展示 + 唯一的写操作是「清空」按钮(POST /api/clear 截断 trace 文件)。
"""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

_DEFAULT_FILE = Path(__file__).resolve().parent / "ai-trace.jsonl"
# 单次响应最多回传的记录数;文件超大时只读尾部这个字节数,避免整文件进内存。
_DEFAULT_LIMIT = 50
_TAIL_BYTES = 64 * 1024 * 1024

_PAGE = """<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>AI Trace 观测台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #101418; color: #d8dee6; font: 13px/1.5 -apple-system, "PingFang SC", sans-serif; }
  header { position: sticky; top: 0; background: #161b22; padding: 10px 16px; display: flex; gap: 16px; align-items: center; border-bottom: 1px solid #2a313a; z-index: 2; }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  header .meta { color: #8b98a5; font-size: 12px; }
  header label { color: #8b98a5; font-size: 12px; display: flex; gap: 4px; align-items: center; }
  main { padding: 12px 16px 60px; }
  .rec { border: 1px solid #2a313a; border-radius: 8px; margin-bottom: 10px; background: #151a20; overflow: hidden; }
  .rec > summary { list-style: none; cursor: pointer; padding: 8px 12px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .rec > summary::-webkit-details-marker { display: none; }
  .rec[open] > summary { border-bottom: 1px solid #2a313a; }
  .time { color: #8b98a5; font-variant-numeric: tabular-nums; }
  .src { padding: 1px 8px; border-radius: 10px; font-size: 11px; background: #1f3a5f; color: #9ecbff; }
  .src.design-agent { background: #3a2f5f; color: #c5b3ff; }
  .model { color: #7ee2b8; }
  .tok { color: #8b98a5; font-size: 12px; margin-left: auto; }
  .imgs-badge { color: #f0b429; font-size: 12px; }
  .body { padding: 10px 12px; display: grid; gap: 10px; }
  .body h3 { margin: 0 0 4px; font-size: 12px; color: #8b98a5; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #0d1117; border: 1px solid #232a33; border-radius: 6px; padding: 8px 10px; max-height: 420px; overflow: auto; font-size: 12px; }
  .imgs { display: flex; gap: 8px; flex-wrap: wrap; }
  .imgs img { max-height: 260px; max-width: 100%; border: 1px solid #2a313a; border-radius: 4px; background: #fff; cursor: zoom-in; }
  .imgs img.big { max-height: none; cursor: zoom-out; }
  .empty { color: #8b98a5; text-align: center; padding: 48px 0; }
</style>
</head>
<body>
<header>
  <h1>AI Trace 观测台</h1>
  <span class="meta" id="meta">…</span>
  <label><input type="checkbox" id="auto" checked> 自动刷新</label>
  <label>来源 <select id="source"><option value="">全部</option></select></label>
  <button id="clear" title="清空 trace 文件(不可恢复)" style="margin-left:auto;background:#3a1f22;color:#e8a0a6;border:1px solid #5c2b30;border-radius:6px;padding:4px 12px;font:inherit;cursor:pointer">清空</button>
</header>
<main id="list"><div class="empty">等待 trace …</div></main>
<script>
const state = { recs: [], open: new Set(), sources: new Set() };

function fmtCost(r) {
  // engine 记录:cost + costCurrency(CNY/USD);design-agent 记录:costUsd。
  if (r.cost != null) {
    const sym = r.costCurrency === "CNY" ? "¥" : r.costCurrency === "USD" ? "$" : (r.costCurrency || "") + " ";
    return `${sym}${Number(r.cost).toFixed(4)}`;
  }
  if (r.costUsd != null) return `$${Number(r.costUsd).toFixed(4)}`;
  return null;
}

function fmtTok(r) {
  const parts = [];
  if (r.inputTokens != null) parts.push(`in ${r.inputTokens}`);
  if (r.outputTokens != null) parts.push(`out ${r.outputTokens}`);
  const cost = fmtCost(r);
  if (cost) parts.push(cost);
  return parts.join(" · ");
}

function key(r) { return `${r.ts}|${r.model}|${(r.output || "").length}`; }

function render() {
  const filter = document.getElementById("source").value;
  const list = document.getElementById("list");
  const recs = state.recs.filter(r => !filter || r.source === filter);
  if (!recs.length) { list.innerHTML = '<div class="empty">还没有匹配的 trace。跑一遍生成/对话流程,这里会实时出现每次 AI 调用。</div>'; return; }
  list.innerHTML = "";
  for (const r of recs.slice().reverse()) {
    const d = document.createElement("details");
    d.className = "rec";
    const k = key(r);
    if (state.open.has(k)) d.open = true;
    d.addEventListener("toggle", () => { d.open ? state.open.add(k) : state.open.delete(k); });
    const imgs = (r.images || []);
    d.innerHTML = `
      <summary>
        <span class="time">${r.time || ""}</span>
        <span class="src ${r.source === "design-agent" ? "design-agent" : ""}">${r.source || "?"}</span>
        <span class="model">${r.model || ""}</span>
        ${imgs.length || r.imageCount ? `<span class="imgs-badge">🖼 ${imgs.length || r.imageCount}</span>` : ""}
        <span class="tok">${fmtTok(r)}</span>
      </summary>
      <div class="body">
        ${imgs.length ? `<div><h3>发给模型的图</h3><div class="imgs">${imgs.map(u => `<img loading="lazy" src="${u}">`).join("")}</div></div>` : ""}
        <div><h3>输入</h3><pre>${esc(r.input || "")}</pre></div>
        <div><h3>输出</h3><pre>${esc(r.output || "")}</pre></div>
      </div>`;
    for (const img of d.querySelectorAll(".imgs img")) img.addEventListener("click", () => img.classList.toggle("big"));
    list.appendChild(d);
  }
}

function esc(s) { return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function tick() {
  try {
    const res = await fetch("/api/traces");
    const data = await res.json();
    // 已加载记录的累计成本(按币种分开;engine=cost/costCurrency,design-agent=costUsd)。
    const sums = {};
    for (const r of state.recs) {
      if (r.cost != null) sums[r.costCurrency || "?"] = (sums[r.costCurrency || "?"] || 0) + Number(r.cost);
      else if (r.costUsd != null) sums.USD = (sums.USD || 0) + Number(r.costUsd);
    }
    const costText = Object.entries(sums)
      .map(([cur, v]) => `${cur === "CNY" ? "¥" : cur === "USD" ? "$" : cur + " "}${v.toFixed(4)}`)
      .join(" + ");
    document.getElementById("meta").textContent =
      `${data.file} · ${(data.bytes / 1024).toFixed(0)} KB · ${data.total} 条(显示末 ${data.records.length} 条)` +
      (costText ? ` · 累计 ${costText}` : "");
    const sel = document.getElementById("source");
    for (const r of data.records) {
      if (r.source && !state.sources.has(r.source)) {
        state.sources.add(r.source);
        const opt = document.createElement("option");
        opt.value = opt.textContent = r.source;
        sel.appendChild(opt);
      }
    }
    const changed = JSON.stringify(data.records.map(key)) !== JSON.stringify(state.recs.map(key));
    state.recs = data.records;
    if (changed) render();
  } catch (e) { document.getElementById("meta").textContent = `读取失败: ${e}`; }
}

document.getElementById("source").addEventListener("change", render);
document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("清空全部 trace 历史?文件会被截断,不可恢复。")) return;
  try {
    const res = await fetch("/api/clear", { method: "POST" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "clear failed");
    state.recs = [];
    state.open.clear();
    render();
    tick();
  } catch (e) { alert(`清空失败: ${e}`); }
});
tick();
setInterval(() => { if (document.getElementById("auto").checked) tick(); }, 2000);
</script>
</body>
</html>"""


def _read_tail_records(path: Path, limit: int) -> tuple[list[dict], int, int]:
    """读 JSONL 尾部最多 limit 条。返回 (records, 文件字节数, 总行数估计)。"""
    if not path.exists():
        return [], 0, 0
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > _TAIL_BYTES:
            f.seek(size - _TAIL_BYTES)
            f.readline()  # 丢掉被截断的半行
        raw_lines = f.read().splitlines()
    records: list[dict] = []
    for line in raw_lines:
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if isinstance(rec, dict):
            records.append(rec)
    return records[-limit:], size, len(records)


class _Handler(BaseHTTPRequestHandler):
    trace_file: Path = _DEFAULT_FILE

    def do_GET(self) -> None:  # noqa: N802 - stdlib 命名
        parsed = urlparse(self.path)
        if parsed.path == "/":
            body = _PAGE.encode("utf-8")
            self._respond(200, "text/html; charset=utf-8", body)
        elif parsed.path == "/api/traces":
            limit_raw = parse_qs(parsed.query).get("limit", [str(_DEFAULT_LIMIT)])[0]
            try:
                limit = max(1, min(500, int(limit_raw)))
            except ValueError:
                limit = _DEFAULT_LIMIT
            records, size, total = _read_tail_records(self.trace_file, limit)
            payload = {
                "file": str(self.trace_file),
                "bytes": size,
                "total": total,
                "records": records,
            }
            self._respond(200, "application/json", json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        else:
            self._respond(404, "text/plain; charset=utf-8", b"not found")

    def do_POST(self) -> None:  # noqa: N802 - stdlib 命名
        parsed = urlparse(self.path)
        if parsed.path == "/api/clear":
            # 一键清空:截断 trace 文件(engine/design-agent 均为 append 打开,
            # 清空后新记录照常追加)。仅本地观测台使用。
            try:
                self.trace_file.parent.mkdir(parents=True, exist_ok=True)
                with self.trace_file.open("w", encoding="utf-8"):
                    pass
                self._respond(200, "application/json", b'{"ok": true}')
            except Exception as exc:  # noqa: BLE001 - 观测台失败只回错误,不抛
                body = json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False).encode("utf-8")
                self._respond(500, "application/json", body)
        else:
            self._respond(404, "text/plain; charset=utf-8", b"not found")

    def _respond(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # 安静:不往终端刷访问日志
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="AI trace 观测台 (ai-trace.jsonl viewer)")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--file",
        default=os.environ.get("AI_TRACE_JSONL") or str(_DEFAULT_FILE),
        help="JSONL 路径(默认 AI_TRACE_JSONL 或本目录 ai-trace.jsonl)",
    )
    args = parser.parse_args()

    _Handler.trace_file = Path(args.file)
    server = ThreadingHTTPServer((args.host, args.port), _Handler)
    print(f"AI Trace 观测台: http://{args.host}:{args.port}  (file: {_Handler.trace_file})")
    server.serve_forever()


if __name__ == "__main__":
    main()
