"""Loader for checked-in template preview assets (#268).

Stage2 uses these low-resolution template/bucket PNGs as Gemini layout context.
The assets live with contracts so Web and Agent share one versioned source.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class TemplatePreview:
    templateId: str
    category: str
    imageSlotCount: int
    structureDescription: str
    previewImage: str


@dataclass(frozen=True)
class TemplatePreviewSet:
    by_template: dict[str, TemplatePreview]
    bucket_images: dict[tuple[str, int], str]


_CACHE: TemplatePreviewSet | None = None


def _repo_preview_dir_from_file() -> Path | None:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "contracts" / "template-previews"
        if candidate.is_dir():
            return candidate
    return None


def _resolve_preview_dir() -> Path:
    explicit = os.environ.get("YUJEE_TEMPLATE_PREVIEWS_DIR")
    if explicit:
        path = Path(explicit)
        if not path.is_dir():
            raise RuntimeError(f"YUJEE_TEMPLATE_PREVIEWS_DIR points to a missing directory: {path}")
        return path

    container_path = Path("/app/packages/contracts/template-previews")
    if container_path.is_dir():
        return container_path

    repo_path = _repo_preview_dir_from_file()
    if repo_path is not None:
        return repo_path

    raise RuntimeError("could not find packages/contracts/template-previews")


def _png_data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _load() -> TemplatePreviewSet:
    root = _resolve_preview_dir()
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("templates")
    if not isinstance(entries, list):
        raise RuntimeError("template preview manifest missing templates[]")

    by_template: dict[str, TemplatePreview] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        template_id = str(entry.get("templateId") or "")
        if not template_id:
            continue
        png_path = root / f"{template_id}.png"
        json_path = root / f"{template_id}.json"
        if not png_path.is_file() or not json_path.is_file():
            raise RuntimeError(f"template preview missing assets for {template_id}")
        meta: dict[str, Any] = json.loads(json_path.read_text(encoding="utf-8"))
        by_template[template_id] = TemplatePreview(
            templateId=template_id,
            category=str(meta.get("category") or entry.get("category") or ""),
            imageSlotCount=int(meta.get("imageSlotCount") or entry.get("imageSlotCount") or 0),
            structureDescription=str(
                meta.get("structureDescription") or entry.get("structureDescription") or ""
            ),
            previewImage=_png_data_uri(png_path),
        )

    bucket_images: dict[tuple[str, int], str] = {}
    bucket_dir = root / "capacity-buckets"
    if bucket_dir.is_dir():
        for path in sorted(bucket_dir.glob("*.png")):
            stem = path.stem
            if "-" not in stem:
                continue
            category, raw_capacity = stem.rsplit("-", 1)
            try:
                capacity = int(raw_capacity)
            except ValueError:
                continue
            bucket_images[(category, capacity)] = _png_data_uri(path)

    return TemplatePreviewSet(by_template=by_template, bucket_images=bucket_images)


def load_template_previews() -> TemplatePreviewSet:
    global _CACHE
    if _CACHE is None:
        _CACHE = _load()
    return _CACHE
