"""Page.html 契约镜像(C 方案):可选、64KB 上限、engine 仅透传。"""

import pytest
from pydantic import ValidationError

from src.contracts.schemas import Page


def _base() -> dict:
    return {"pageIndex": 0, "templateId": "mag-01", "images": {}, "texts": {}}


def test_page_html_optional_and_roundtrips():
    assert Page(**_base()).html is None
    page = Page(**_base(), html='<div data-template="mag-01"></div>')
    assert page.html.startswith("<div")


def test_page_html_over_64kb_rejected():
    with pytest.raises(ValidationError):
        Page(**_base(), html="x" * 65537)
