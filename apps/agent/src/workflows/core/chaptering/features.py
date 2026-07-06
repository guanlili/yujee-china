"""Stage1 分章使用的图片特征能力。

这里放可复用的本地图片特征:轻量像素特征总是可用;CLIP embedding 延迟 import,
避免没有跑到视觉子分组时就加载大模型依赖。
"""

from __future__ import annotations

import base64
import io
import math
import os
import sys
from functools import lru_cache
from typing import Any

from PIL import Image

_REMOTE_CLIP_BATCH_SIZE = 30


def image_from_data_url(data_url: str) -> Image.Image:
    try:
        _, payload = data_url.split(",", 1)
    except ValueError as exc:
        raise ValueError("photo base64 must be a data URL") from exc
    raw = base64.b64decode(payload, validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def pix_feat(image: Image.Image) -> list[float]:
    im = image.convert("RGB")
    gray_values = [float(value) for value in im.convert("L").resize((8, 8)).tobytes()]
    gray_mean = sum(gray_values) / len(gray_values)
    gray_var = sum((value - gray_mean) ** 2 for value in gray_values) / len(gray_values)
    gray_std = math.sqrt(gray_var) + 1e-6
    gray = [(value - gray_mean) / gray_std for value in gray_values]

    raw = im.resize((64, 64)).tobytes()
    pixels = [
        (raw[index] / 255.0, raw[index + 1] / 255.0, raw[index + 2] / 255.0)
        for index in range(0, len(raw), 3)
    ]
    hist = [0.0] * 12
    values: list[float] = []
    saturations: list[float] = []

    for red, green, blue in pixels:
        mx = max(red, green, blue)
        mn = min(red, green, blue)
        delta = mx - mn
        value = mx
        saturation = delta / mx if mx > 0 else 0.0
        values.append(value)
        saturations.append(saturation)

        if delta <= 1e-6:
            hue = 0.0
        elif mx == red:
            hue = ((green - blue) / delta) % 6
        elif mx == green:
            hue = ((blue - red) / delta) + 2
        else:
            hue = ((red - green) / delta) + 4
        hue /= 6.0

        keep = (
            saturation > 0.12
            and value > 0.12
            and not (value > 0.93 and saturation < 0.14)
        )
        if keep:
            bucket = min(11, max(0, int(hue * 12)))
            hist[bucket] += saturation * value

    hist_sum = sum(hist) + 1e-9
    hist = [value / hist_sum for value in hist]
    value_mean = sum(values) / len(values)
    saturation_mean = sum(saturations) / len(saturations)
    return gray + [value * 6 for value in hist] + [value_mean * 3, saturation_mean * 3]


def clip_embeddings(images: list[Image.Image]) -> list[list[float]]:
    from ....settings import get_settings

    settings = get_settings()
    if settings.grouping_clip_base_url:
        return _remote_clip_embeddings(images, settings)

    _prepend_grouping_pythonpath()
    import torch

    model, preprocess = _load_clip()
    tensors = torch.stack([preprocess(image.convert("RGB")) for image in images])
    with torch.no_grad():
        encoded = model.encode_image(tensors)
    encoded = encoded / encoded.norm(dim=-1, keepdim=True)
    return encoded.cpu().tolist()


def _remote_clip_embeddings(images: list[Image.Image], settings: Any) -> list[list[float]]:
    import httpx

    data_urls = [_image_to_data_url(image) for image in images]
    url = settings.grouping_clip_base_url.rstrip("/") + "/internal/open-clip/embeddings"
    secret = settings.grouping_clip_secret or settings.agent_shared_secret
    headers = {"Authorization": f"Bearer {secret}"}
    all_embeddings: list[list[float]] = []
    with httpx.Client(timeout=settings.grouping_clip_timeout_seconds) as client:
        for start in range(0, len(data_urls), _REMOTE_CLIP_BATCH_SIZE):
            chunk = data_urls[start : start + _REMOTE_CLIP_BATCH_SIZE]
            response = client.post(url, json={"images": chunk}, headers=headers)
            response.raise_for_status()
            body = response.json()
            embeddings = (
                body.get("data", {}).get("embeddings")
                if isinstance(body, dict)
                else None
            )
            if not isinstance(embeddings, list) or len(embeddings) != len(chunk):
                raise ValueError("remote CLIP service returned invalid embeddings")
            all_embeddings.extend(embeddings)
    return all_embeddings


def _image_to_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@lru_cache(maxsize=1)
def _load_clip() -> tuple[Any, Any]:
    from ....settings import get_settings

    _prepend_grouping_pythonpath()
    import open_clip

    settings = get_settings()
    model_path = getattr(settings, "grouping_clip_model_path", None)
    if model_path:
        model = open_clip.load_openai_model(
            model_path, device="cpu", precision="fp32"
        ).eval()
        preprocess = open_clip.image_transform(model.visual.image_size, is_train=False)
        return model, preprocess

    model_name = getattr(settings, "grouping_clip_model_name", "ViT-B-32")
    pretrained = getattr(settings, "grouping_clip_pretrained", "openai")
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_name,
        pretrained=pretrained,
        device="cpu",
    )
    return model.eval(), preprocess


def _prepend_grouping_pythonpath() -> None:
    from ....settings import get_settings

    value = getattr(get_settings(), "grouping_pythonpath", None)
    if not value:
        return
    for raw_path in reversed(value.split(os.pathsep)):
        path = raw_path.strip()
        if path and path not in sys.path:
            sys.path.insert(0, path)
