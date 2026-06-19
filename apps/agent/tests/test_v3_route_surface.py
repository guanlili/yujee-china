from __future__ import annotations

from pathlib import Path

def test_agent_route_surface_keeps_health_and_v3_only() -> None:
    from src.main import app

    paths = {route.path for route in app.routes}

    assert "/health" in paths
    assert {
        "/v3/analyze",
        "/v3/chapter-chat",
        "/v3/recommend",
        "/v3/apply-theme",
        "/v3/cover",
        "/v3/finalize",
    }.issubset(paths)
    assert not any(path.startswith("/" + "v2" + "/album") for path in paths)


def test_agent_source_has_no_old_album_chain_residue() -> None:
    src_root = Path(__file__).resolve().parents[1] / "src"
    forbidden = ("schemas_" + "v2", "v2_" + "album", "/" + "v2" + "/album")
    offenders: list[str] = []

    for path in sorted(src_root.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if any(token in text for token in forbidden):
            offenders.append(str(path.relative_to(src_root)))

    assert offenders == []
