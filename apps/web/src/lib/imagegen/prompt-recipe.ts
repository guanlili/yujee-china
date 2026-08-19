// 生图 prompt 配方。2026-08-18 用火山 Seedream 4.0 实测 36 张后定下来的写法。
// 五条教训直接写进代码,别改回去(同目录 .test.ts 会拦):
//
// 1. prompt 里一旦出现 book / cover,模型画的是「一本书的实物照」——有书脊、有圆角、
//    四边露白底,不是能当底的满幅纹理。第一批 8 张全废在这上面。
// 2. 负向词无效。明写 "no flowers, no petals" 照样出玫瑰,两个色系都复现。
//    要排除什么就正向描述成别的东西,不要写 no。
// 3. **绝不能把十六进制色码写进 prompt。** 模型会把 "#DBE4EA" 当成要画的文字,
//    原样印到图上。第二批 18 张 18 张全中。色彩一律用自然语言描述,色码只用于文件名。
// 4. **不提 text / photo / portrait。** 写了 "so a portrait photo and a line of text
//    can sit on top",模型就在图上画出 "PROTRAIIT, and mtecad lor" 这种乱码假字。
//    想说「留白给别的东西压上去」,就只说 even and uncluttered。
// 5. 一次只描述一个色。喂两三个色,模型理解成横向色块,出来是拼色不是纹理。
//
// 「水彩晕染(wash)」方向被砍掉了:watercolour 这个词先验太强,必带花卉,
// 在解决掉之前不进配方。

export const TEXTURE_DIRECTIONS = ['paper', 'linen', 'grain'] as const;

export type TextureDirection = (typeof TEXTURE_DIRECTIONS)[number];

/**
 * 垫底背景用的色调。hex 锚在 `lib/board-bg/presets.ts` 的 COLOR_PRESETS 中段那批
 * 「书页纸张常用底色」上(同目录测试会校验),但**发给模型的是 wording,不是 hex**
 * —— 见上面第 3 条。hex 只用来命名文件和入库时对色。
 */
export const BACKDROP_TONES = [
  { id: 'rice', hex: '#f4f1ea', wording: 'warm off-white rice paper tone' },
  { id: 'mist', hex: '#dbe4ea', wording: 'pale cool blue grey' },
  { id: 'sage', hex: '#dfe6d6', wording: 'soft muted sage green' },
  { id: 'clay', hex: '#ece0d8', wording: 'gentle warm blush beige' },
  { id: 'butter', hex: '#FFFCE1', wording: 'pale creamy butter yellow' },
  { id: 'cloud', hex: '#FFE9F8', wording: 'faint powdery pink' },
] as const;

export type ToneId = (typeof BACKDROP_TONES)[number]['id'];

/** 满幅约束 —— 「fills the entire frame」这句是整个配方的承重墙。
 *  user-prompt.ts 复用它当自由描述的外壳,别改成不导出。 */
export const PROMPT_FRAMING =
  'Extreme macro close-up of a material surface, so close that the material ' +
  'fills the entire frame edge to edge, seamless and full bleed. ' +
  'Flat even lighting, low contrast, calm and quiet, even and uncluttered across the middle.';

const SURFACE: Record<TextureDirection, string> = {
  paper: 'Cotton rag fibres seen up close, soft tooth, matte finish.',
  linen: 'Woven linen threads seen up close, regular tight weave, matte fabric.',
  grain: 'Dense risograph grain, single ink, soft vertical falloff.',
};

export function buildTexturePrompt(opts: { direction: TextureDirection; tone: ToneId }): string {
  const surface = SURFACE[opts.direction];
  if (!surface) throw new Error(`unknown texture direction: ${opts.direction}`);
  const tone = BACKDROP_TONES.find((t) => t.id === opts.tone);
  if (!tone) throw new Error(`unknown tone: ${opts.tone}`);
  return `${PROMPT_FRAMING} ${surface} The whole surface is a single flat ${tone.wording}.`;
}
