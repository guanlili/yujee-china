import { getTemplate } from '@yujee/contracts/templates';

/**
 * 封面选择卡上一张预览要填的图槽表。
 *
 * 修的是「封底少一张照片」：此前 coverOptionHTML 只填 `heroSlotId`(= 模板的第一个
 * 图槽)，而 **mag-22 封底有两个图槽 image1/image2** —— 第 1/2/4 套的封底都是它，
 * 于是线上三套的封底预览第二张图一直是空的。第 3 套用 mag-63(零图槽)，不受影响。
 *
 * 口径跟真实成书对齐：`assembleDesignedPages` 组封底时也是把**所有**图槽填满、
 * 「不够则复用最后一张，图槽绝不留空」。这里预览手上只有一张 endingPhotoId，
 * 所以后续槽复用同一张 —— 真书在有补充照片(extraEndingPhotoIds)时会填不同的图，
 * 预览这一步是**近似**：宁可重复一张，也不能留空洞。
 *
 * 没照片 / 不认识的模板一律返回空表：让模板渲自己的 sample，不塞空 src。
 */
export function coverOptionImages(
  templateId: string,
  photoId: string | null,
): Record<string, string> {
  if (!photoId) return {};
  const slots = getTemplate(templateId)?.images ?? [];
  return Object.fromEntries(slots.map((slot) => [slot.id, photoId]));
}
