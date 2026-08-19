// 用户自由描述 -> 安全 prompt 的外壳。用户提供内容,承重墙提供结构,两者不可对调。
//
// 承重墙同时压在**前面和后面**:实测里模型对靠后的指令服从度更高,所以尾部重申
// 一遍,用户写 "ignore all previous instructions" 也冲不掉。这不是万无一失的
// 防注入(语义注入没法根治),但把最常见的一类挡住了。
//
// 清洗规则都对应 2026-08-18 的实测,不是防御性编程的想当然:
// - 十六进制色码必剥。实测 18/18 被模型当成文字原样印在图上。
// - 换行/连续空白压平。不给用户用伪造的分隔结构去伪造"系统指令"。
// - 截断。自由输入不设上限就是给上游账单开口子。



export const MAX_USER_PROMPT_CHARS = 200;

/**
 * 用户自由描述的承重墙。**与 prompt-recipe 的 PROMPT_FRAMING 刻意分开**:
 * 那一句是给底图纹理写的(`extreme macro close-up of a material surface`),
 * 套在通用描述上会把「黄昏的海边礁石」压成一块石头表面的微距 —— 实跑复现过。
 *
 * 这里只留**跟画面内容无关的结构性约束**:
 * - 满幅到边(正面说「画面延伸到四边」,而不是「不留白边」——
 *   负向词在实测里无效,同目录测试会拦)
 * - 不提 text/photo/portrait 这些词本身(实测模型会把它们画成乱码假字),
 *   所以只能正面说「表面干净」
 * 画面内容一律交给用户那句话。
 */
const USER_FRAMING =
  'A single scene that fills the entire frame, reaching all four edges. ' +
  'Clean surface, natural lighting, calm composition.';

const HEX_COLOUR = /#\s*[0-9a-fA-F]{3,8}/g;
// eslint-disable-next-line no-control-regex
const CONTROL_AND_SPACE = /[\u0000-\u001f\u007f\s]+/g;

export function sanitizeUserPrompt(raw: string): string {
  return raw
    .replace(HEX_COLOUR, ' ')
    .replace(CONTROL_AND_SPACE, ' ')
    .trim()
    .slice(0, MAX_USER_PROMPT_CHARS);
}

export function buildUserImagePrompt(raw: string): string {
  const cleaned = sanitizeUserPrompt(raw ?? '');
  if (!cleaned) throw new Error('empty prompt after sanitising');
  // 前置承重墙 -> 用户内容 -> 后置承重墙重申。
  return `${USER_FRAMING} The image shows: ${cleaned}. ${USER_FRAMING}`;
}
