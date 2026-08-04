// 预览「垫底背景」的共享定义:相册级属性,预览画板与导出拼图共用同一来源。
// 编辑器、PATCH 路由校验、拼图导出都从这里取,保证三处口径一致。

export type BoardBackground =
  | { kind: 'color'; color: string }
  | { kind: 'preset'; presetId: string }
  // 用户上传图:仅存本地(IndexedDB via photoStore),key 是本地 blob 的 id。
  // 只在当前设备解析得到;换设备/清缓存则解析为空、回落无背景(MVP 取舍)。
  | { kind: 'upload'; key: string };

// 共用常用色板:吸色工具(文字/页背景)与画板垫底背景两处保持一致(用户诉求)。
// 前段是深色/品牌色(文字常用),TextPanel/mes 快捷色取 slice(0,8) 恰好是这一段;
// 中段是柔和中性 —— 这四个就是书页纸张的常用底色(2026-08-04 用户点名保留);
// 尾段是版式出彩背景(2026-08-04 用户按图钦点)。自定义取色覆盖其余。
export const COLOR_PRESETS: string[] = [
  '#1C1B18', // 墨黑
  '#FFFFFF', // 纯白
  '#23397b', // 藏蓝
  '#50351b', // 深棕
  '#501b1b', // 酒红
  '#13B8A6', // 品牌青
  '#8C5EF4', // 品牌紫
  '#999999', // 灰
  '#f4f1ea', // 米白
  '#dbe4ea', // 雾蓝
  '#dfe6d6', // 鼠尾草
  '#ece0d8', // 藕粉
  '#FFFCE1', // 奶白黄
  '#FFE9F8', // 云粉
  '#134498', // 宝蓝
  '#106621', // 森绿
  '#AB3F27', // 赤陶红
  '#239BB6', // 孔雀蓝
  '#7546EB', // 紫罗兰
];

// 内置图片预设(梦幻抽象底)。文件放 public/board-bg/<id>.jpg,缩略图同图 CSS 缩放。
export const IMAGE_PRESETS: { id: string; label: string }[] = [
  { id: 'field', label: '青野' },
  { id: 'mist', label: '雾蓝' },
  { id: 'water', label: '水光' },
  { id: 'dawn', label: '霞光' },
];

const IMAGE_PRESET_IDS = new Set(IMAGE_PRESETS.map((p) => p.id));

export function presetImageUrl(presetId: string): string {
  return `/board-bg/${presetId}.jpg`;
}

// 十六进制颜色校验(#rgb / #rrggbb),PATCH 路由与前端共用。
export function isValidHexColor(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

export function isKnownPresetId(id: string): boolean {
  return IMAGE_PRESET_IDS.has(id);
}

// 收敛的 BoardBackground 校验(存库前/取用前都过一遍),非法一律当「无背景」。
export function normalizeBoardBackground(v: unknown): BoardBackground | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'color' && typeof o.color === 'string' && isValidHexColor(o.color)) {
    return { kind: 'color', color: o.color };
  }
  if (o.kind === 'preset' && typeof o.presetId === 'string' && isKnownPresetId(o.presetId)) {
    return { kind: 'preset', presetId: o.presetId };
  }
  // 上传图:key 是本地 blob id(uuid 级短串)。存库只留 key,解析在客户端 photoStore。
  if (o.kind === 'upload' && typeof o.key === 'string' && o.key.length > 0 && o.key.length <= 64) {
    return { kind: 'upload', key: o.key };
  }
  return null;
}
