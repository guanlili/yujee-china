// AI 聊天气泡的 markdown 安全渲染。只在 ChatPanel 的 AI 文本注入点使用。
// 双保险:源文本先整体 HTML 转义(原生 HTML 全部变字面量,node 单测环境也成立),
// 链接协议白名单;浏览器端再过 DOMPurify 纵深防御。用户消息不走这里(保持 textContent)。
import { marked, Renderer, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

const SAFE_PROTO = /^(https?:|mailto:)/i;

const renderer = new Renderer();
renderer.link = function (token: Tokens.Link): string {
  const href = typeof token.href === 'string' && SAFE_PROTO.test(token.href) ? token.href : '#';
  const text = this.parser.parseInline(token.tokens);
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({ gfm: true, breaks: true, renderer });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdownSafe(text: string): string {
  const html = marked.parse(escapeHtml(text), { async: false });
  // DOMPurify 需要 DOM;node(单测)环境 isSupported=false 时跳过 —— 输入已整体转义、
  // 链接协议已白名单,此层只是浏览器端的额外兜底。
  if (typeof window !== 'undefined' && DOMPurify.isSupported) {
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
  }
  return html;
}
