'use client';

// 开发用模板大画布（HTML 渲染真相，覆盖全部模板）。不链入导航，直接访问 /zh/dev/template-check。
// - 全部模板一次性用 HTML 模板渲染铺开，按类别分组；图槽一律灰色占位，只看版式。
// - 页面上的文字 = 模板槽位的 `sample`，示例文案的【单一真相】：既是用户没写字时画板显示的
//   占位，也是写作 LM 的输出示例（engine write_copy 塞进 prompt 让模型照着写）。
// - 点选任意元素（图槽/文字槽/装饰层）→ 右侧面板：改上下左右+宽高、改示例文案、删除该层，
//   全部写回模板源码（dev-only API /api/dev/template-box 改 HTML、/api/dev/template-copy 改 JSON）。
//   删除由 API 侧的锚点 lint 把关：会破坏契约的删除（如图槽）会被拒绝并说明原因。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ITEMS_GRID_CAPACITY,
  TEMPLATE_IDS,
  TEMPLATES,
  type TemplateDef,
  type TemplateTextSlot,
} from '@yujee/contracts/templates';
import { type AdaptablePage, type ResolveImage } from '@/components/album/adapt-layout';
import { renderPageHtml } from '@/components/album/templates/html/fill-template';
import { PAGE } from '@/components/album/templates/constants';
import { fitTextBoxes } from '@/components/album/page-html-dom';

// 图槽一律灰色占位（不用带颜色的照片），只看版式几何。
const GRAY_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#c9c9c9"/></svg>',
)}`;

const ALL_TEMPLATE_IDS: readonly string[] = TEMPLATE_IDS;

const CATEGORY_ORDER = ['cover', 'toc', 'interior', 'ending'] as const;
type Category = (typeof CATEGORY_ORDER)[number];
const CATEGORY_LABEL: Record<string, string> = {
  cover: '封面 cover',
  toc: '目录 toc',
  interior: '内页 interior',
  ending: '封底 ending',
};
const CATEGORY_SHORT: Record<Category, string> = {
  cover: '封面',
  toc: '目录',
  interior: '内页',
  ending: '封底',
};

// 文字类型（槽位的 role）。决定：主题色/字体怎么刷这个槽、AI 写不写它（decoration 不写）。
const ROLES = ['title', 'body', 'explain', 'decoration'] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL: Record<Role, string> = {
  title: '标题 title',
  body: '正文 body',
  explain: '说明 explain',
  decoration: '装饰 decoration',
};
// variableDecor（主题一键刷色/刷字体的标记）只允许挂在这两个 role 上。
const VARIABLE_DECOR_ROLES = new Set<Role>(['title', 'decoration']);

const SIDES = ['width', 'height', 'top', 'left', 'right', 'bottom'] as const;
type Side = (typeof SIDES)[number];
const SIDE_LABEL: Record<Side, string> = {
  width: '宽',
  height: '高',
  top: '上',
  left: '左',
  right: '右',
  bottom: '下',
};

const PLACEHOLDER_SENTENCE = '（此槽还没有示例文案）';

function isItemsGridTemplate(tpl: TemplateDef): boolean {
  return tpl.images.length === 0 && (tpl.items?.images ?? []).length === 1;
}

// 文案一律原样渲染。模板不再声明任何字数上限；版面装不下由 fit-text（固定高度 +
// 字号自适应）解决，而不是砍字。
function textForSlot(slot: TemplateTextSlot): string {
  if (slot.sample) return slot.sample;
  if (slot.role === 'decoration') return '';
  return PLACEHOLDER_SENTENCE;
}

/** 按模板槽位声明生成一页示例数据（文案 = 槽位的 sample）。 */
function buildSamplePage(templateId: string): AdaptablePage {
  const tpl = TEMPLATES[templateId];
  const images: Record<string, string> = {};
  const texts: Record<string, string> = {};
  if (!tpl) return { templateId, images, texts };

  tpl.images.forEach((slot, i) => {
    images[slot.id] = `s${i}`;
  });
  tpl.texts.forEach((slot) => {
    texts[slot.id] = textForSlot(slot);
  });

  if (tpl.items) {
    const count = isItemsGridTemplate(tpl) ? ITEMS_GRID_CAPACITY : 3;
    const gridImage = tpl.items.images?.[0];
    if (gridImage) {
      for (let i = 0; i < count; i += 1) images[`${gridImage.id}[${i}]`] = `s${i}`;
    }
    const topLevelIds = new Set(tpl.texts.map((slot) => slot.id));
    for (const slot of tpl.items.texts ?? []) {
      if (topLevelIds.has(slot.id)) continue;
      for (let i = 0; i < count; i += 1) texts[`${slot.id}[${i}]`] = textForSlot(slot);
    }
  }

  return { templateId, images, texts };
}

/** 模板里某槽（含重复组）的声明；重复组整组共用一份。 */
function declaredSlot(templateId: string, slotKey: string): TemplateTextSlot | undefined {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return undefined;
  const baseId = slotKey.replace(/\[\d+\]$/, '');
  return tpl.texts.find((s) => s.id === baseId) ?? tpl.items?.texts?.find((s) => s.id === baseId);
}

// 槽 id 由代码按 role 自动派号（与 /api/dev/template-slot 同规则）。这里只做预览显示，
// 真正派号在服务端（它才有最终的模板状态）。
const BASE_ID_BY_ROLE: Record<Role, string> = {
  title: 'title',
  body: 'body',
  explain: 'explain',
  decoration: 'label',
};

function previewSlotId(templateId: string, role: Role): string {
  const tpl = TEMPLATES[templateId];
  const taken = new Set<string>([
    ...(tpl?.texts ?? []).map((s) => s.id),
    ...(tpl?.images ?? []).map((s) => s.id),
    ...(tpl?.items?.texts ?? []).map((s) => s.id),
    ...(tpl?.items?.images ?? []).map((s) => s.id),
  ]);
  const base = BASE_ID_BY_ROLE[role];
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 99; i += 1) {
    if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }
  return `${base}99`;
}

function slotsMissingSample(templateId: string): string[] {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return [];
  const all = [...tpl.texts, ...(tpl.items?.texts ?? [])];
  return all.filter((s) => s.role !== 'decoration' && !s.sample).map((s) => s.id);
}

type Kind = 'text' | 'image' | 'decor';

type Selection = {
  templateId: string;
  /** 模板根节点内的文档序号 = 源码里开标签的出现顺序（API 据此定位元素）。 */
  elementIndex: number;
  kind: Kind;
  tag: string;
  slotKey: string | null; // 文字槽/图槽的锚点 id；装饰层为 null
  box: Record<Side, string>; // 输入框字符串态；空串 = 该属性未设置
  sample: string;
  role: Role | null; // 文字槽才有
  lang: 'user' | 'en' | null; // 'user' = 用户语言;'en' = 保持英文(写作 AI 的硬约束)
  variableDecor: boolean; // 该槽能否被主题一键刷色/刷字体
};

const overrideKey = (templateId: string, elementIndex: number) => `${templateId}::${elementIndex}`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type WriteResult = {
  ok: boolean;
  applied: number;
  failed: string[];
  notes?: string[];
  /** 改 role 触发的 id 顺位改名（id 按 role 派号，API 自动做，JSON+HTML 同步）。 */
  renames?: { templateId: string; from: string; to: string }[];
  regenerated?: boolean;
};

/** 元素当前的行内 style 里显式写了哪些边（没写的不填，避免把 auto 变成硬数值）。 */
function readBox(el: HTMLElement): Record<Side, string> {
  const out = {} as Record<Side, string>;
  for (const side of SIDES) {
    const inline = el.style.getPropertyValue(side);
    if (inline && inline.endsWith('px')) {
      out[side] = String(Math.round(parseFloat(inline)));
    } else if (side === 'width' || side === 'height') {
      // 宽高即使没写死也给出实测值，方便直接改。
      const cs = window.getComputedStyle(el);
      out[side] = String(Math.round(parseFloat(cs[side]) || 0));
    } else {
      out[side] = '';
    }
  }
  return out;
}

function kindOf(el: HTMLElement): { kind: Kind; slotKey: string | null } {
  if (el.dataset.textKey !== undefined) return { kind: 'text', slotKey: el.dataset.textKey };
  if (el.dataset.imageSlot !== undefined) return { kind: 'image', slotKey: el.dataset.imageSlot };
  return { kind: 'decor', slotKey: null };
}

export default function TemplateWallPage() {
  const [cardScale, setCardScale] = useState(0.32);
  const [scale, setScale] = useState(3);
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<Side, number>>>>({});
  // 新增文字槽的表单（null = 没在新增）。
  // 槽 id 不在表单里 —— 由代码按 role 自动派号（技术标识符不该手写）。
  const [newSlot, setNewSlot] = useState<{
    templateId: string;
    role: Role;
    lang: 'user' | 'en';
    sample: string;
  } | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);

  const resolveImage: ResolveImage = () => GRAY_PLACEHOLDER;

  const pages = useMemo(() => ALL_TEMPLATE_IDS.map((id) => buildSamplePage(id)), []);

  const sections = useMemo(() => {
    const groups = new Map<string, AdaptablePage[]>();
    for (const page of pages) {
      const cat = TEMPLATES[page.templateId]?.category ?? 'other';
      groups.set(cat, [...(groups.get(cat) ?? []), page]);
    }
    const order: readonly string[] = CATEGORY_ORDER;
    return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [pages]);

  const missingByTemplate = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const id of ALL_TEMPLATE_IDS) {
      const missing = slotsMissingSample(id);
      if (missing.length > 0) out[id] = missing;
    }
    return out;
  }, []);

  /** 模板根节点内按文档序的全部元素（与源码开标签顺序一致，API 靠这个下标定位）。 */
  const elementsOf = useCallback((card: HTMLElement): HTMLElement[] => {
    const root = card.querySelector<HTMLElement>('[data-template]');
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('*'));
  }, []);

  // 每次渲染后重放：尺寸/位置 override → 选中高亮 → fit-text。改文案/热更会让 React
  // 重设 innerHTML，所以这些 DOM 侧效果必须可重放。
  const repaintEffects = useCallback(() => {
    const wall = wallRef.current;
    if (!wall) return;
    for (const [key, box] of Object.entries(overrides)) {
      const [templateId, idxRaw] = key.split('::');
      const card = wall.querySelector<HTMLElement>(`[data-tpl="${CSS.escape(templateId!)}"]`);
      if (!card) continue;
      const el = elementsOf(card)[Number(idxRaw)];
      if (!el) continue;
      for (const side of SIDES) {
        const v = box[side];
        if (v !== undefined) el.style.setProperty(side, `${v}px`);
      }
    }
    wall.querySelectorAll<HTMLElement>('[data-selected-box]').forEach((el) => {
      el.style.outline = '';
      el.removeAttribute('data-selected-box');
    });
    if (selection) {
      const card = wall.querySelector<HTMLElement>(`[data-tpl="${CSS.escape(selection.templateId)}"]`);
      const el = card ? elementsOf(card)[selection.elementIndex] : undefined;
      if (el) {
        el.style.outline = '3px solid #3b82f6';
        el.style.outlineOffset = '-1px';
        el.setAttribute('data-selected-box', '');
      }
    }
    fitTextBoxes(wall);
  }, [overrides, selection, elementsOf]);

  useEffect(repaintEffects);
  useEffect(() => {
    document.fonts?.ready?.then(() => repaintEffects());
  }, [repaintEffects]);

  function handleWallClick(e: React.MouseEvent) {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-tpl]');
    if (!card) return;
    const el = e.target as HTMLElement;
    const root = card.querySelector<HTMLElement>('[data-template]');
    if (!root || el === root || !root.contains(el)) return;
    const elementIndex = elementsOf(card).indexOf(el);
    if (elementIndex < 0) return;
    const { kind, slotKey } = kindOf(el);
    const templateId = card.dataset.tpl!;
    const slot = slotKey && kind === 'text' ? declaredSlot(templateId, slotKey) : undefined;
    setSelection({
      templateId,
      elementIndex,
      kind,
      tag: el.tagName.toLowerCase(),
      slotKey,
      box: readBox(el),
      sample: slot?.sample ?? '',
      role: (slot?.role as Role | undefined) ?? null,
      lang: (slot?.lang as 'user' | 'en' | undefined) ?? null,
      variableDecor: Boolean(slot?.variableDecor),
    });
    setStatus('');
  }

  function updateSide(side: Side, raw: string) {
    if (!selection) return;
    const next = { ...selection, box: { ...selection.box, [side]: raw } };
    setSelection(next);
    const num = Number(raw);
    setOverrides((prev) => {
      const key = overrideKey(next.templateId, next.elementIndex);
      const box = { ...(prev[key] ?? {}) };
      if (raw === '' || !Number.isFinite(num)) delete box[side];
      else box[side] = num;
      return { ...prev, [key]: box };
    });
  }

  async function saveBox() {
    if (!selection) return;
    const set: Partial<Record<Side, number>> = {};
    for (const side of SIDES) {
      const raw = selection.box[side];
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        setStatus(`${SIDE_LABEL[side]} 不是有效数字`);
        return;
      }
      if ((side === 'width' || side === 'height') && num <= 0) {
        setStatus(`${SIDE_LABEL[side]} 必须为正数`);
        return;
      }
      set[side] = Math.round(num);
    }
    if (Object.keys(set).length === 0) {
      setStatus('没有要保存的尺寸/位置');
      return;
    }
    setStatus('写回模板 HTML…');
    try {
      const r = await postJson<WriteResult>('/api/dev/template-box', {
        ops: [{ templateId: selection.templateId, elementIndex: selection.elementIndex, set }],
      });
      setStatus(
        r.ok
          ? `已写回 ${selection.templateId}.ts（${Object.entries(set).map(([k, v]) => `${SIDE_LABEL[k as Side]}${v}`).join(' ')}）`
          : `失败：${r.failed.join('; ')}`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 删除整个元素。API 侧删完会跑锚点 lint：破坏契约（图槽还被 JSON 声明着、
  // 文字槽 token 还在别处用着）的删除会被拒绝，源码不动。
  async function removeElement() {
    if (!selection) return;
    const what =
      selection.kind === 'decor'
        ? `装饰层 <${selection.tag}>`
        : `${selection.kind === 'text' ? '文字槽' : '图槽'} ${selection.slotKey}`;
    if (!window.confirm(`确定从 ${selection.templateId} 删掉 ${what}？会直接改写模板源码。`)) return;
    setStatus('删除中…');
    try {
      const r = await postJson<WriteResult>('/api/dev/template-box', {
        ops: [{ templateId: selection.templateId, elementIndex: selection.elementIndex, remove: true }],
      });
      if (r.ok) {
        // 元素没了 → 后面的下标全部左移，本地 override/选中作废，交给热更重绘。
        setOverrides({});
        setSelection(null);
        setStatus(`已从 ${selection.templateId}.ts 删掉 ${what}（热更后画布刷新）`);
      } else {
        setStatus(`拒绝删除：${r.failed.join('; ')}`);
      }
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 改页面类型（cover/toc/interior/ending）。写回模板 JSON 的 category，API 会连带重跑
  // templates:generate 和预览烘焙（预览按 category:图槽数 分桶，排版 AI 看的就是那些图）。
  async function changeCategory(templateId: string, category: Category) {
    setStatus(`把 ${templateId} 改成${CATEGORY_SHORT[category]}…`);
    try {
      const r = await postJson<WriteResult>('/api/dev/template-copy', {
        ops: [{ templateId, category }],
      });
      setStatus(
        r.ok
          ? `${templateId} → ${CATEGORY_SHORT[category]}，热更后卡片会移到新分组`
          : `失败：${r.failed.join('; ')}`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 改文字类型（role）。写回模板 JSON；若新 role 不是 title/decoration 而该槽带着
  // variableDecor（主题一键刷色/刷字体的标记），API 会连带摘掉它并在 notes 里说明。
  // id 按 role 派号：role 变了 API 会自动顺位改 id（JSON + HTML 同事务），renames
  // 里带回新 id —— 这里跟着更新选中态，否则面板还握着旧 id，下一次操作全打空。
  async function changeRole(role: Role) {
    if (!selection || selection.kind !== 'text' || !selection.slotKey) return;
    setStatus(`把 ${selection.slotKey} 改成${ROLE_LABEL[role]}…`);
    try {
      const r = await postJson<WriteResult>('/api/dev/template-copy', {
        ops: [{ templateId: selection.templateId, slotKey: selection.slotKey, role }],
      });
      if (!r.ok) {
        setStatus(`失败：${r.failed.join('; ')}`);
        return;
      }
      const oldBase = selection.slotKey.replace(/\[\d+\]$/, '');
      const rename = r.renames?.find(
        (item) => item.templateId === selection.templateId && item.from === oldBase,
      );
      const nextSlotKey = rename
        ? selection.slotKey.replace(oldBase, rename.to)
        : selection.slotKey;
      const dropped = !VARIABLE_DECOR_ROLES.has(role) && selection.variableDecor;
      setSelection({
        ...selection,
        slotKey: nextSlotKey,
        role,
        variableDecor: dropped ? false : selection.variableDecor,
      });
      setStatus(
        `${selection.slotKey} → ${ROLE_LABEL[role]}${rename ? `（id 已顺位改名 ${rename.from} → ${rename.to}）` : ''}${r.notes?.length ? `。${r.notes.join('；')}` : ''}，热更后生效`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 槽的语言约束：user = 用用户语言写；en = 保持英文（日期/编号/标签类装饰）。
  // engine write_copy 把它原样发给写作 AI —— 是硬约束，不是展示偏好。
  async function changeLang(lang: 'user' | 'en') {
    if (!selection || selection.kind !== 'text' || !selection.slotKey) return;
    setStatus(`把 ${selection.slotKey} 的语言改成 ${lang}…`);
    try {
      const r = await postJson<WriteResult>('/api/dev/template-copy', {
        ops: [{ templateId: selection.templateId, slotKey: selection.slotKey, lang }],
      });
      if (!r.ok) {
        setStatus(`失败：${r.failed.join('; ')}`);
        return;
      }
      setSelection({ ...selection, lang });
      setStatus(`${selection.slotKey} 语言 → ${lang}，热更后生效`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 开/关 variableDecor（能否被主题一键刷色/刷字体）。只有 title/decoration 能开。
  async function toggleVariableDecor(on: boolean) {
    if (!selection || selection.kind !== 'text' || !selection.slotKey) return;
    setStatus(on ? '开启主题可刷…' : '关闭主题可刷…');
    try {
      const r = await postJson<WriteResult>('/api/dev/template-copy', {
        ops: [
          { templateId: selection.templateId, slotKey: selection.slotKey, variableDecor: on },
        ],
      });
      if (!r.ok) {
        setStatus(`失败：${r.failed.join('; ')}`);
        return;
      }
      setSelection({ ...selection, variableDecor: on });
      setStatus(`${selection.slotKey} 的主题可刷已${on ? '开启' : '关闭'}，热更后生效`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 新增文字槽：一次改两个文件（模板 JSON 的 texts[] + HTML 里带锚点/token 的元素），
  // API 侧用同一套锚点 lint 把关，不合契约就两个文件都不动。建好后自动选中新元素，
  // 直接用上下左右/宽高把它挪到位。
  async function createSlot() {
    if (!newSlot) return;
    const { templateId, role, sample } = newSlot;
    setStatus(`给 ${templateId} 新增${ROLE_LABEL[role]}槽…`);
    try {
      // 不传 id —— 服务端按 role 自动派号（它才有最终的模板状态，避免并发撞号）。
      const r = await postJson<WriteResult & { elementIndex?: number; id?: string }>(
        '/api/dev/template-slot',
        {
          templateId,
          role,
          lang: newSlot.lang,
          ...(sample ? { sample } : {}),
        },
      );
      if (!r.ok) {
        setStatus(`失败：${r.failed.join('; ')}`);
        return;
      }
      setNewSlot(null);
      setOverrides({});
      setSelection(
        r.elementIndex === undefined || r.id === undefined
          ? null
          : {
              templateId,
              elementIndex: r.elementIndex,
              kind: 'text',
              tag: 'div',
              slotKey: r.id,
              box: { width: '320', height: '', top: '60', left: '60', right: '', bottom: '' },
              sample,
              role,
              lang: newSlot.lang,
              variableDecor: false,
            },
      );
      setStatus(`已新增 ${templateId}.${r.id ?? '?'}（默认放在左上角，用右侧面板挪到想要的位置）`);
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function saveSample() {
    if (!selection || selection.kind !== 'text' || !selection.slotKey) return;
    setStatus('写回模板 JSON 并重生成…');
    try {
      const r = await postJson<WriteResult>('/api/dev/template-copy', {
        ops: [
          { templateId: selection.templateId, slotKey: selection.slotKey, text: selection.sample },
        ],
      });
      setStatus(
        r.ok
          ? `已写回 templates/${selection.templateId}.json（${selection.slotKey}）${r.regenerated ? '，已重生成，热更后生效' : ''}`
          : `失败：${r.failed.join('; ')}`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function bakeAllTextHeights() {
    const wall = wallRef.current;
    if (!wall) return;
    const ops: { templateId: string; slotType: 'text'; slotId: string; set: { height: number } }[] = [];
    wall.querySelectorAll<HTMLElement>('[data-tpl]').forEach((card) => {
      const templateId = card.dataset.tpl!;
      card.querySelectorAll<HTMLElement>('[data-text-key]').forEach((el) => {
        if (el.tagName === 'IMG') return;
        const height = Math.ceil(parseFloat(window.getComputedStyle(el).height) || 0);
        if (height > 0) {
          ops.push({ templateId, slotType: 'text', slotId: el.dataset.textKey!, set: { height } });
        }
      });
    });
    if (ops.length === 0) {
      setStatus('没有可固化的文字框');
      return;
    }
    if (!window.confirm(`会给全部 ${new Set(ops.map((o) => o.templateId)).size} 个模板的 ${ops.length} 个文字框写死当前高度，确定？`)) return;
    setStatus(`固化 ${ops.length} 个文字框高度…`);
    try {
      const r = await postJson<WriteResult>('/api/dev/template-box', { ops });
      setStatus(
        r.ok
          ? `已固化 ${r.applied} 个文字框高度到模板源码`
          : `部分失败（成功 ${r.applied}）：${r.failed.slice(0, 4).join('; ')}${r.failed.length > 4 ? ` 等${r.failed.length}个` : ''}`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function exportRasterPdf() {
    setStatus(`渲染 ${pages.length} 页中…`);
    try {
      const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
      const blob = await renderAlbumPdfRaster(pages, resolveImage, { scale });
      const capturedW = Math.round(PAGE.width * scale);
      const dpi = Math.round(capturedW / 8.27);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `templates-all-scale${scale}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(
        `已下载 ${pages.length} 页。scale=${scale} → 每页 ${capturedW}×${Math.round(PAGE.height * scale)}px ≈ ${dpi} DPI；PDF ${(blob.size / 1024 / 1024).toFixed(1)} MB。`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const missingCount = Object.values(missingByTemplate).reduce((n, list) => n + list.length, 0);
  const kindLabel = selection
    ? selection.kind === 'text'
      ? '文字槽'
      : selection.kind === 'image'
        ? '图槽'
        : '装饰层'
    : '';

  return (
    <div style={{ padding: 24, paddingRight: selection ? 300 : 24, fontFamily: 'system-ui', background: '#eef1f5', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>模板大画布（HTML 渲染 · 全部 {pages.length} 个）</h1>
        <label style={{ fontSize: 13 }}>
          卡片：
          <select value={cardScale} onChange={(e) => setCardScale(Number(e.target.value))} style={{ marginLeft: 6 }}>
            <option value={0.22}>小</option>
            <option value={0.32}>中</option>
            <option value={0.45}>大</option>
            <option value={0.7}>特大</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          导出 scale：
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ marginLeft: 6 }}>
            <option value={2}>2（≈192 DPI）</option>
            <option value={3}>3（≈288 DPI）</option>
            <option value={4}>4（≈384 DPI）</option>
          </select>
        </label>
        <button onClick={exportRasterPdf} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
          导出栅格 PDF
        </button>
        <button onClick={bakeAllTextHeights} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #b45309', background: '#fef3c7', color: '#92400e', cursor: 'pointer', fontSize: 13 }}>
          固化全部文字框高度 → 源码
        </button>
        <span style={{ fontSize: 13, color: '#333' }}>{status}</span>
      </div>
      <p style={{ fontSize: 13, color: '#555', marginBottom: missingCount > 0 ? 8 : 20 }}>
        点选任意元素（文字槽 / 图槽 / 装饰层）→ 右侧改上下左右+宽高、改示例文案、删除该层，直接写回模板源码。会破坏锚点契约的删除（如图槽）会被拒绝并说明原因。
      </p>
      {missingCount > 0 && (
        <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', display: 'inline-block', padding: '4px 10px', borderRadius: 6, marginBottom: 16 }}>
          还有 {missingCount} 个槽没有示例文案（AI 写这些槽时没参考）：
          {Object.entries(missingByTemplate)
            .map(([id, slots]) => `${id}.${slots.join('/')}`)
            .join('、')}
        </p>
      )}

      <div ref={wallRef} onClick={handleWallClick}>
        {sections.map(([cat, sectionPages]) => (
          <section key={cat} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 14, color: '#666', margin: '0 0 10px' }}>
              {CATEGORY_LABEL[cat] ?? cat}（{sectionPages.length}）
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {sectionPages.map((page) => {
                const html = renderPageHtml(page, resolveImage);
                const currentCategory = (TEMPLATES[page.templateId]?.category ?? 'interior') as Category;
                return (
                  <figure key={page.templateId} style={{ margin: 0 }}>
                    <figcaption
                      style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{page.templateId}</span>
                      <select
                        value={currentCategory}
                        onChange={(e) => changeCategory(page.templateId, e.target.value as Category)}
                        title="页面类型（写回模板 JSON 的 category）"
                        style={{ fontSize: 11, padding: '1px 2px', border: '1px solid #ddd', borderRadius: 4, color: '#555' }}
                      >
                        {CATEGORY_ORDER.map((cat) => (
                          <option key={cat} value={cat}>
                            {CATEGORY_SHORT[cat]}
                          </option>
                        ))}
                      </select>
                      {missingByTemplate[page.templateId] && (
                        <span style={{ color: '#b45309' }}>缺示例</span>
                      )}
                      <button
                        onClick={() =>
                          setNewSlot({
                            templateId: page.templateId,
                            role: 'body',
                            lang: 'user',
                            sample: '',
                          })
                        }
                        title="给这个模板新增一个文字槽"
                        style={{ marginLeft: 'auto', padding: '0 5px', fontSize: 11, lineHeight: '16px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', color: '#555', cursor: 'pointer' }}
                      >
                        ＋文字槽
                      </button>
                    </figcaption>
                    <div
                      data-tpl={page.templateId}
                      style={{
                        width: PAGE.width * cardScale,
                        height: PAGE.height * cardScale,
                        overflow: 'hidden',
                        background: '#fff',
                        boxShadow: '0 2px 12px rgba(0,0,0,.1)',
                      }}
                    >
                      {html ? (
                        <div
                          style={{ transform: `scale(${cardScale})`, transformOrigin: 'top left', width: PAGE.width, height: PAGE.height }}
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      ) : (
                        <div style={{ padding: 16, fontSize: 13, color: '#999' }}>（无 HTML 模板）</div>
                      )}
                    </div>
                  </figure>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {newSlot && (
        <div
          onClick={() => setNewSlot(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 320, background: '#fff', borderRadius: 12, padding: 20, fontSize: 13, boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>给 {newSlot.templateId} 新增文字槽</div>
            <div style={{ color: '#888', fontSize: 11, marginBottom: 14 }}>
              会同时写模板 JSON 的槽位声明和 HTML 里的锚点元素（两者必须成对，否则契约校验不过）。
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <label style={{ flex: 1 }}>
                文字类型
                <select
                  value={newSlot.role}
                  onChange={(e) => setNewSlot({ ...newSlot, role: e.target.value as Role })}
                  style={{ width: '100%', marginTop: 2, padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6 }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1 }}>
                语言
                <select
                  value={newSlot.lang}
                  onChange={(e) => setNewSlot({ ...newSlot, lang: e.target.value as 'user' | 'en' })}
                  style={{ width: '100%', marginTop: 2, padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6 }}
                >
                  <option value="user">用户文案 user</option>
                  <option value="en">英文装饰 en</option>
                </select>
              </label>
            </div>

            <div style={{ marginBottom: 14, padding: '6px 8px', background: '#f5f5f4', borderRadius: 6, fontSize: 12, color: '#555' }}>
              槽 id 由代码自动派号：
              <code style={{ fontWeight: 600, color: '#111' }}>
                {previewSlotId(newSlot.templateId, newSlot.role)}
              </code>
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              示例文案
              <div style={{ color: '#888', fontSize: 11 }}>画板占位 + AI 写作参考（同一份）</div>
              <textarea
                value={newSlot.sample}
                onChange={(e) => setNewSlot({ ...newSlot, sample: e.target.value })}
                rows={3}
                style={{ width: '100%', marginTop: 2, padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6, fontFamily: 'inherit', fontSize: 12, resize: 'vertical' }}
              />
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={createSlot}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                创建
              </button>
              <button
                onClick={() => setNewSlot(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', color: '#666', cursor: 'pointer', fontSize: 13 }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {selection && (
        <aside
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            width: 264,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,.15)',
            padding: 16,
            fontSize: 13,
            zIndex: 10,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{selection.templateId}</div>
          <div style={{ color: '#666', marginBottom: 12 }}>
            {kindLabel}
            {selection.slotKey ? ` · ${selection.slotKey}` : ` · <${selection.tag}> #${selection.elementIndex}`}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {SIDES.map((side) => (
              <label key={side}>
                {SIDE_LABEL[side]} px
                <input
                  type="number"
                  value={selection.box[side]}
                  placeholder="—"
                  onChange={(e) => updateSide(side, e.target.value)}
                  style={{ width: '100%', marginTop: 2, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 6 }}
                />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
            空着的边不会写进源码（保持原样）。上下左右对绝对定位的层生效。
          </div>
          <button
            onClick={saveBox}
            style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            保存位置尺寸 → 模板 HTML
          </button>

          {selection.kind === 'text' && selection.slotKey && (
            <>
              <hr style={{ margin: '14px 0', border: 0, borderTop: '1px solid #eee' }} />
              <label style={{ display: 'block', marginBottom: 10, fontWeight: 600 }}>
                文字类型
                <div style={{ fontWeight: 400, color: '#888', fontSize: 11, marginBottom: 4 }}>
                  决定字体/配色策略和 AI 的写法（装饰槽也由 AI 写；页码除外，代码统一生成）
                </div>
                <select
                  value={selection.role ?? 'body'}
                  onChange={(e) => changeRole(e.target.value as Role)}
                  style={{ width: '100%', padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'block', marginBottom: 10, fontWeight: 600 }}>
                语言（lang）
                <div style={{ fontWeight: 400, color: '#888', fontSize: 11, marginBottom: 4 }}>
                  AI 写这个槽用什么语言：用户语言，或固定英文（日期/编号/标签类装饰）
                </div>
                <select
                  value={selection.lang ?? 'user'}
                  onChange={(e) => changeLang(e.target.value as 'user' | 'en')}
                  style={{ width: '100%', padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="user">用户语言（user）</option>
                  <option value="en">固定英文（en）</option>
                </select>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  marginBottom: 12,
                  fontWeight: 400,
                  color: selection.role && VARIABLE_DECOR_ROLES.has(selection.role) ? '#333' : '#aaa',
                }}
              >
                <input
                  type="checkbox"
                  checked={selection.variableDecor}
                  disabled={!selection.role || !VARIABLE_DECOR_ROLES.has(selection.role)}
                  onChange={(e) => toggleVariableDecor(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ fontSize: 12 }}>
                  主题可刷（variableDecor）
                  <span style={{ display: 'block', color: '#888', fontSize: 11 }}>
                    {selection.role && VARIABLE_DECOR_ROLES.has(selection.role)
                      ? '主题换色/换字体时会刷到这个槽'
                      : '只有标题/装饰槽能开；改成这两类才可勾选'}
                  </span>
                </span>
              </label>

              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                示例文案
                <div style={{ fontWeight: 400, color: '#888', fontSize: 11, marginBottom: 4 }}>
                  画板占位 + AI 写作参考（同一份）
                  {selection.slotKey.includes('[') && ' · 整个重复组共用'}
                </div>
                <textarea
                  value={selection.sample}
                  onChange={(e) => setSelection({ ...selection, sample: e.target.value })}
                  rows={4}
                  style={{ width: '100%', padding: '5px 6px', border: '1px solid #ccc', borderRadius: 6, fontFamily: 'inherit', fontSize: 12, resize: 'vertical' }}
                />
              </label>
              <button
                onClick={saveSample}
                style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontSize: 13 }}
              >
                保存文案 → 模板 JSON
              </button>
            </>
          )}

          <hr style={{ margin: '14px 0', border: 0, borderTop: '1px solid #eee' }} />
          <button
            onClick={removeElement}
            style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #dc2626', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', fontSize: 13 }}
          >
            删掉这一层
          </button>
          <button
            onClick={() => setSelection(null)}
            style={{ width: '100%', marginTop: 8, padding: '6px 0', borderRadius: 8, border: '1px solid #ccc', background: '#fff', color: '#666', cursor: 'pointer', fontSize: 13 }}
          >
            关闭
          </button>
        </aside>
      )}
    </div>
  );
}
