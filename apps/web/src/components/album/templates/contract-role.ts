import { getTemplate } from '@yujee/contracts/templates';
import type { AlbumTextRole } from '@yujee/contracts/render/theme-carrier';

// 槽位的 role 一律【从契约取】,不在组件里写死。
//
// 模板台(/zh/dev/template-check)能直接改模板 JSON 的 role,写死的 role 会立刻烂成
// 假前提 —— 主题就会按错误的角色去刷这个槽(标题色刷到说明文字上之类)。
// 契约(模板 JSON)是唯一真相,这里只做查表。
//
// 重复组的 bracket 键(explain[2])按基名查。

export function contractRole(templateId: string, slotKey: string): AlbumTextRole | undefined {
  const baseId = slotKey.replace(/\[\d+\]$/, '');
  const tpl = getTemplate(templateId);
  if (!tpl) return undefined;
  const slot =
    tpl.texts.find((s) => s.id === baseId) ?? tpl.items?.texts?.find((s) => s.id === baseId);
  return slot?.role as AlbumTextRole | undefined;
}
