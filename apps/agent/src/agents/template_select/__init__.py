"""template_select agent: recognition-model template pick per page (V3 §4.1)."""

from __future__ import annotations

from .handler import SelectTemplateError, plan_pages, select_template_pages

__all__ = ["SelectTemplateError", "plan_pages", "select_template_pages"]
