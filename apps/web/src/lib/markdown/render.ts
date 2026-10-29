// AI 聊天气泡的 markdown 安全渲染。只在 ChatPanel 的 AI 文本注入点使用。
// 双保险:源文本先整体 HTML 转义(原生 HTML 全部变字面量,node 单测环境也成立),
// 链接协议白名单;浏览器端再过 DOMPurify 纵深防御。用户消息不走这里(保持 textContent)。
//
// 2026-10-29 懒加载:marked(~40KB)+dompurify(~25KB)此前静态 import 进首包,
// 但只有 AI 聊天气泡用到 —— 动态 import 后首包减 ~65KB(首屏不出现 AI 对话的
// 访客永远不加载)。首次调用返回 null(调用方 fallback 纯文本并触发加载),后续同步。
const SAFE_PROTO = /^(https?:|mailto:)/i;

interface LoadedModule {
  render(escapedText: string): string;
}

let modPromise: Promise<LoadedModule | null> | null = null;
let loaded: LoadedModule | null = null;

function ensureModule(): Promise<LoadedModule | null> {
  if (loaded) return Promise.resolve(loaded);
  modPromise ??= (async () => {
    try {
      const [{ marked, Renderer }, dompurifyModule] = await Promise.all([
        import('marked'),
        import('dompurify'),
      ]);
      const DOMPurify = dompurifyModule.default;
      const renderer = new Renderer();
      renderer.link = function (
        this: { parser?: { parseInline?: (t: unknown[]) => string } },
        token: { href?: unknown; tokens?: unknown[] },
      ): string {
        const href = typeof token.href === 'string' && SAFE_PROTO.test(token.href) ? token.href : '#';
        const text = this.parser?.parseInline?.((token.tokens ?? []) as never[]) ?? '';
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      };
      marked.use({ gfm: true, breaks: true, renderer });
      loaded = {
        render(escapedText: string): string {
          const html = marked.parse(escapedText, { async: false });
          // DOMPurify 需要 DOM;node(单测)环境 isSupported=false 时跳过。
          if (typeof window !== 'undefined' && DOMPurify.isSupported) {
            return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
          }
          return html;
        },
      };
      return loaded;
    } catch {
      return null;
    }
  })();
  return modPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 首次调用返回 null(模块尚未加载完毕);调用方 fallback 到纯文本并安排重渲。
 * 后续调用同步返回安全 HTML。原同步版 `renderMarkdownSafe` 改为此签名。
 */
export function renderMarkdownSafe(text: string): string {
  const escaped = escapeHtml(text);
  if (!loaded) {
    // 模块还没加载完:先返回安全转义文本(调用方 innerHTML 直接可用,零改动),
    // 同时触发异步加载;下一轮渲染自然切到真 markdown。
    void ensureModule();
    return escaped;
  }
  return loaded.render(escaped);
}

/** 等待模块加载完毕(用于测试或需要确保首条即渲染的场景)。 */
export async function ensureMarkdownLoaded(): Promise<void> {
  await ensureModule();
}
