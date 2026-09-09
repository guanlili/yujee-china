"""几何组:主体包围盒 + 人脸框。

⚠️ 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。
别改成 0-1 —— 两套坐标系并存,Agent 心算必错。

模型(RMBG-1.4)按需惰性加载,进程内缓存一份。box_from_mask 是纯函数,
可以脱离模型单测。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from PIL import Image

from .inference import locked


def box_from_mask(mask: Image.Image, threshold: int = 128) -> dict | None:
    """alpha mask -> 主体包围盒(0-100 百分比)。前景为空返回 None。

    threshold:RMBG 输出边缘是渐变的,低于阈值的弱像素视作背景,免得噪点撑大框。
    """
    grey = mask.convert("L")
    width, height = grey.size
    if width == 0 or height == 0:
        return None

    binary = grey.point(lambda value: 255 if value >= threshold else 0)
    bbox = binary.getbbox()  # (left, upper, right, lower);全黑返回 None
    if bbox is None:
        return None

    left, upper, right, lower = bbox
    return {
        "x": left / width * 100,
        "y": upper / height * 100,
        "w": (right - left) / width * 100,
        "h": (lower - upper) / height * 100,
    }


# ── 模型接入 ────────────────────────────────────────────────────────────────────
#
# ⚠️ 选型理由(别改回 RMBG-1.4):RMBG-1.4 的许可是 bria-rmbg-1.4,官方写明
# "source-available model for **non-commercial** use"。Yujee 是收费产品,烘进镜像
# 就是拿非商用许可的模型商用。改用 Apache-2.0 的这两个,许可干净:
#
#   建档 profile → u2netp  (320²,4MB) —— 档案只要**包围盒**,320² 足够,而且
#                                        实测它在 CLIP 之上一点没抬高内存峰值。
#   抠图 cutout  → isnet-general-use (1024²,170MB) —— 真抠图要精细边缘;
#                                        拿 320² 的糙边去抠人像,正是 2026-08-29
#                                        否决自动抠图的那个病。
#
# 两个模型的归一化常数不一样,张冠李戴 mask 会整个糊掉 —— 所以绑在 spec 里。


@dataclass(frozen=True)
class _ModelSpec:
    name: str
    setting: str          # settings 上的权重路径字段名
    size: int             # 模型输入边长(正方形)
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    # alpha 分段拉伸的 (lo, hi);None = 不拉伸,保留原始软 mask。
    alpha_stretch: tuple[int, int] | None = None


SPECS: dict[str, _ModelSpec] = {
    "profile": _ModelSpec(
        name="profile",
        setting="profile_seg_model_path",
        size=320,
        mean=(0.485, 0.456, 0.406),
        std=(0.229, 0.224, 0.225),
    ),
    "cutout": _ModelSpec(
        name="cutout",
        setting="profile_matting_model_path",
        size=1024,
        mean=(0.5, 0.5, 0.5),
        std=(1.0, 1.0, 1.0),
        # 见 _stretch_alpha 的抬头。建档档(profile)刻意**不**拉伸:实测拉不拉
        # 对包围盒都没区别(<0.3 个百分点),不改没必要改的。
        alpha_stretch=(40, 170),
    ),
}

Quality = Literal["profile", "cutout"]

_SESSIONS: dict[str, Any] = {}


def _session(spec: _ModelSpec):
    """惰性加载 + 进程内单例。min_machines_running=0 的机器冷启已经慢,
    别在 import 期加载;也别每张照片重建 session。"""
    if spec.name not in _SESSIONS:
        import onnxruntime as ort

        from ....settings import get_settings

        options = ort.SessionOptions()
        # 关掉内存池:实测开着会一路只涨不还(1095MB 且继续爬),关掉就稳在一个
        # 平台期。这台机器只有 2GB,稳比快重要。
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        # shared-cpu-1x 就一个核,多线程只会多占内存。
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        path = getattr(get_settings(), spec.setting)
        _SESSIONS[spec.name] = ort.InferenceSession(
            path, options, providers=["CPUExecutionProvider"]
        )
    return _SESSIONS[spec.name]


def _preprocess(image: Image.Image, spec: _ModelSpec):
    """PIL -> NCHW float32,按 spec 的 mean/std 归一化。"""
    import numpy as np

    resized = image.convert("RGB").resize((spec.size, spec.size), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.array(spec.mean, dtype=np.float32)) / np.array(spec.std, dtype=np.float32)
    return array.transpose(2, 0, 1)[None, ...].astype(np.float32)


# 「有没有主体」的判据。**必须看归一化之前的绝对置信度** —— _mask_from_output 的
# min-max 归一化让最大值恒为 255,box_from_mask 的 128 阈值因此必有像素通过,
# subjectBox=None 那条分支在真实管线里根本走不到(实测:纯噪声出满屏框;而
# 天亮地暗那类**有梯度的背景**会被切出一个编造的半屏主体框 —— h≈49.7% ——
# 构图裁切就照着这个假框去挪)。
#
# 0.5 是概率口径上的地板:模型对整张图最有把握的那个像素都没到「一半可能是前景」,
# 就当它没看出主体。真主体在 u2netp 上一般是 0.9+,离地板很远,不会误杀。
MIN_SUBJECT_CONFIDENCE = 0.5


def _subject_confidence(output) -> float:
    """原始输出的绝对置信度上限(概率口径)。

    各家显著性模型输出量纲不一:有的已经过了 sigmoid(0..1),有的是 logits。
    超出 [0,1] 的一律先过 sigmoid 拉回概率口径再比,否则对 logits 输出这条地板会乱判。
    """
    import numpy as np

    prediction = np.asarray(output)[0, 0].astype("float64")
    if prediction.min() < 0.0 or prediction.max() > 1.0:
        prediction = 1.0 / (1.0 + np.exp(-prediction))
    return float(prediction.max())


def _mask_from_output(output, size: tuple[int, int]) -> Image.Image:
    """模型 logits -> 与原图同尺寸的 L mask。

    各家显著性模型的输出量纲不一(有的过了 sigmoid 有的没有),一律按 min-max
    拉回 0..1 再转 0..255 —— 我们只用它取包围盒/抠图,绝对量纲无所谓。"""
    import numpy as np

    prediction = np.asarray(output)[0, 0]
    lo, hi = float(prediction.min()), float(prediction.max())
    prediction = (prediction - lo) / (hi - lo + 1e-8)
    mask = Image.fromarray((prediction * 255).astype("uint8"), mode="L")
    return mask.resize(size, Image.Resampling.BILINEAR)


def _stretch_alpha(mask: Image.Image, lo: int, hi: int) -> Image.Image:
    """alpha 分段拉伸:<lo 归 0,>hi 归 255,中间线性铺满。

    为什么要这一步(2026-09-09 端到端验收,25 张真人像):isnet 输出的是**软 mask**,
    灰度区 = 模型不确定的区域。棚拍纯背景那几张 mask 是纯白、抠得完美;但光线复杂、
    背景有帘子的(IMG_9287 / IMG_9350 / IMG_9059),大片衣服区域 alpha 只有一百多 ——
    抠出来叠到版式上就是**鬼影**,用户点了「抠图」拿到一个半透明的自己。

    ⚠️ 别改成纯二值化(`v >= 128 ? 255 : 0`)。对照图逐张看过:二值化会在衣服上
    炸出白色破洞(alpha<128 的整片区域被归零),边缘也变硬 —— **破洞比半透明更难看**。
    分段拉伸的好处是主体变实、边缘仍然柔和。

    只用在 quality="cutout";建档档不拉伸,理由见 SPECS。
    """
    span = max(hi - lo, 1)
    return mask.point(
        lambda v: 0 if v < lo else (255 if v > hi else round((v - lo) / span * 255))
    )


@locked
def _segment(image: Image.Image, spec: _ModelSpec) -> tuple[Image.Image, float]:
    """跑一次分割,回 (mask, 归一化前的绝对置信度)。

    置信度必须在这里取:出了这个函数,mask 已经被 min-max 拉成满量程,
    「模型到底有多确定」的信息就没了。

    @locked:全机推理串行,理由见 inference.py。
    """
    session = _session(spec)
    tensor = _preprocess(image, spec)
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    mask = _mask_from_output(output, image.size)
    if spec.alpha_stretch is not None:
        mask = _stretch_alpha(mask, *spec.alpha_stretch)
    return mask, _subject_confidence(output)


def subject_mask(image: Image.Image, *, quality: Quality = "profile") -> Image.Image:
    """前景 mask(L 模式,与原图同尺寸)。

    quality="profile" 建档用(u2netp/320²,只为取包围盒);
    quality="cutout"  真抠图用(isnet/1024²,要精细边缘)。
    """
    return _segment(image, SPECS[quality])[0]


def detect_faces(image: Image.Image) -> list[dict]:
    """人脸框(0-100 百分比),0..n 个。

    ⚠️ 现状:**还没接检测器,恒返回 []**。后果是 design-agent 的
    `avoid-face-crop` 会退化成 `center-subject` —— 不会报错,只是少一条约束。

    没接的理由:计划首选的 YuNet 要自己写 priors 解码 + NMS,而手上没有真实
    人脸样本可以验证,写了也是没验过的代码;走 opencv 又是给一台只剩 ~690MB
    余量的机器加重依赖。签名和 0-100 口径先钉死,将来接上不用动调用方。
    """
    return []


def subject_geometry(image: Image.Image) -> dict:
    """几何组的对外入口。mask 只用来取框,**不返回也不保存** ——
    绝大多数照片不会被抠,预存 mask 是净浪费(见契约注释)。

    置信度不到地板就判定没主体(subjectBox=None,imagePos 走默认 50/50/1)——
    理由见 MIN_SUBJECT_CONFIDENCE。宁可没有框,也不要一个编造的框:
    构图裁切会照着框挪,假框比没框更坏。
    """
    mask, confidence = _segment(image, SPECS["profile"])
    return {
        "subjectBox": box_from_mask(mask) if confidence >= MIN_SUBJECT_CONFIDENCE else None,
        "faceBoxes": detect_faces(image),
    }
