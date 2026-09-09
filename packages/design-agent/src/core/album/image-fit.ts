/**
 * 意图 -> imagePos。**几何归代码,模型只表达意图** —— LLM 心算坐标必错,
 * 而且错得没规律、测不出来(设计文档 §4.4)。
 *
 * ⚠️ **这是个近似解,不是 bug。** 精确地把主体推到容器正中需要
 * `R = 照片宽高比 / 槽位宽高比`,而槽位宽高比在 `CatalogImageSlotDef`
 * (只有 id/orientation/quality/composition)和模板 JSON(只有槽 id)里**都没有**,
 * 只存在于 HTML 模板的 CSS 里。所以这里用不需要槽位宽高比的近似:
 *
 * - `object-position: p%` 的语义是「图片的 p% 点对齐容器的 p% 点」
 * - 令 `p = 主体中心的百分比`,可保证**主体一定落在可见区域内**
 *   (p=50 时精确居中;主体越靠边,它在可见窗口里也越靠边,但不会被裁掉)
 *
 * 对「别切脸」这个真实目标够用。要精确居中,前置条件是给 `templates:generate`
 * 加一步「渲染模板量出每个槽的宽高,写进 templates.generated.ts」—— 本批不做。
 *
 * ⚠️ 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。别用 [0,1]。
 *
 * ⚠️ **人脸框现在恒空,这不是 bug。** A 线拍板不接 YuNet(要自己写 priors 解码 +
 * NMS,没验过的代码不如明说没有),所以 `PhotoProfile.faceBoxes` 在生产一直是空
 * 数组 —— `avoid-face-crop` 因此**必然**退化成 `center-subject`(不报错,只是少
 * 一条约束)。下面那条「没找到脸就退到 center-subject」的分支正是为此而写的,
 * 别看到「两个意图结果一样」就以为坏了去改它。将来真接上人脸检测,这里零改动
 * 就会自动生效。
 *
 * ⚠️ **rotate 本批明确不动**:`ImagePos` 契约里有可选的 `rotate`(90/180/270),
 * `set_image_pos` 的 schema 只收 `x/y/scale`,本函数也只产出这三个字段,既有的
 * rotate 值由工具层原样保留。这是有意为之,不是漏了 —— 对齐 `page-html-dom.ts`
 * 与 `types.ts` 那两处 rotate 契约不一致是手工编辑那条线的账,混进来只会扩大 diff。
 */

import type { PhotoBox, PhotoProfile } from "@yujee/contracts";

export type ImageFit = "center-subject" | "avoid-face-crop" | "fill";

export const IMAGE_FIT_MODES: readonly ImageFit[] = ["center-subject", "avoid-face-crop", "fill"];

export interface ImagePosValue {
	x: number;
	y: number;
	scale: number;
}

/** #165 的 render default:没设过 imagePos 的槽就是这个值。 */
export const DEFAULT_IMAGE_POS: ImagePosValue = { x: 50, y: 50, scale: 1 };

/** scale 的合法区间,与 contracts 的 ImagePos 一致(cover 语义下 <1 会露底)。 */
export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 2;

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

function centerOf(box: PhotoBox): { x: number; y: number } {
	return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** 多个人脸的并集包围盒 —— 目标是「所有脸都别被裁」,不是「第一张脸居中」。 */
function unionBox(boxes: readonly PhotoBox[]): PhotoBox {
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.w));
	const bottom = Math.max(...boxes.map((box) => box.y + box.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isImageFit(value: unknown): value is ImageFit {
	return typeof value === "string" && (IMAGE_FIT_MODES as readonly string[]).includes(value);
}

export function resolveImagePos(fit: ImageFit, profile?: PhotoProfile): ImagePosValue {
	if (fit === "fill") return { ...DEFAULT_IMAGE_POS };

	if (fit === "avoid-face-crop" && profile?.faceBoxes && profile.faceBoxes.length > 0) {
		const center = centerOf(unionBox(profile.faceBoxes));
		return { x: clampPct(center.x), y: clampPct(center.y), scale: MIN_IMAGE_SCALE };
	}

	// avoid-face-crop 没找到脸 => 退到 center-subject(而不是直接默认):
	// 没检测到脸不等于没主体。
	const box = profile?.subjectBox;
	if (!box) return { ...DEFAULT_IMAGE_POS };

	const center = centerOf(box);
	return { x: clampPct(center.x), y: clampPct(center.y), scale: MIN_IMAGE_SCALE };
}
