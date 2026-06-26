"""Unit tests for `src.prompts.load_replies`.

兜底回复文件由产品手调,可能用 ASCII 冒号 `:` 或全角冒号 `：` 当分隔符。
解析器须对两者都正确切分(取行内更靠前的那个),并保留既有宽容行为
(裁空白 / 忽略 `#` 注释与空行 / 重复键最后一次为准)。
"""

from src.prompts import load_replies


def test_load_replies_splits_on_ascii_and_fullwidth_colon(tmp_path):
    path = tmp_path / "replies.md"
    path.write_text(
        "\n".join(
            [
                "# a comment line, ignored",
                "",
                "write.en: Hello there",  # ASCII colon
                "write.zh：你好",  # full-width colon U+FF1A
            ]
        ),
        encoding="utf-8",
    )

    out = load_replies(path)

    assert out["write.en"] == "Hello there"
    assert out["write.zh"] == "你好"


def test_load_replies_picks_earliest_separator(tmp_path):
    # Full-width colon appears before the ASCII colon → split on the full-width one,
    # so the ASCII colon stays inside the value.
    path = tmp_path / "earliest.md"
    path.write_text("key：value: with ascii colon", encoding="utf-8")

    out = load_replies(path)

    assert out == {"key": "value: with ascii colon"}


def test_load_replies_ignores_blanks_comments_and_last_wins(tmp_path):
    path = tmp_path / "dup.md"
    path.write_text(
        "\n".join(
            [
                "  ",
                "# comment",
                "dup.zh：第一次",
                "dup.zh：最后一次",
                "no_separator_line",
            ]
        ),
        encoding="utf-8",
    )

    out = load_replies(path)

    assert out == {"dup.zh": "最后一次"}
