"""语义组:一次视觉模型调用出五个字段。

单测把模型响应打桩 —— 重点测解析和兜底,不测模型本身。
模型真实质量的验收在 Task Z1。
"""

import json
import re

from PIL import Image

from src.workflows.core.profile import semantic


def _img():
    return Image.new("RGB", (64, 64), (120, 90, 60))


def _stub(monkeypatch, payload):
    monkeypatch.setattr(semantic, "_call_vision", lambda image: payload)


def test_parses_all_five_fields(monkeypatch):
    _stub(monkeypatch, json.dumps({
        "composition": "closeup",
        "scene": "indoor",
        "peopleCount": "1",
        "mood": "quiet",
        "description": "窗边的侧脸",
    }))
    out = semantic.semantic_features(_img())
    assert out == {
        "composition": "closeup",
        "scene": "indoor",
        "peopleCount": "1",
        "mood": "quiet",
        "description": "窗边的侧脸",
    }


def test_rejects_out_of_enum_value_and_falls_back(monkeypatch):
    """模型吐了枚举外的值 —— 落到安全默认,不抛,不让一张坏照片打挂整本分析。"""
    _stub(monkeypatch, json.dumps({
        "composition": "panorama",
        "scene": "space",
        "peopleCount": "many",
        "mood": "chaotic",
        "description": "x",
    }))
    out = semantic.semantic_features(_img())
    # composition 落 None 而不是编一个 focal:slot_matcher_v3 遇到 None 视作任意、
    # 不挡,那是正确的降级;编一个值会让选版按错误的构图约束匹配槽位。
    assert out["composition"] is None
    assert out["scene"] == "outdoor"
    assert out["peopleCount"] == "0"
    assert out["mood"] == "quiet"


def test_handles_non_json_response(monkeypatch):
    _stub(monkeypatch, "对不起，我无法分析这张图片。")
    out = semantic.semantic_features(_img())
    assert out["composition"] is None
    assert out["description"] == ""


def test_handles_fenced_json(monkeypatch):
    """模型爱套 ```json 围栏,得剥掉。"""
    _stub(monkeypatch, '```json\n{"composition":"wide","scene":"nature",'
                       '"peopleCount":"0","mood":"quiet","description":"山脊线"}\n```')
    assert semantic.semantic_features(_img())["composition"] == "wide"


def test_description_is_truncated_to_contract_limit(monkeypatch):
    _stub(monkeypatch, json.dumps({
        "composition": "focal", "scene": "city", "peopleCount": "2-3",
        "mood": "energetic", "description": "很长" * 400,
    }))
    assert len(semantic.semantic_features(_img())["description"]) <= 300


# 位置类词 + 禁令词。子串检查(`"地名" in PROMPT`)拦不住把提示词改成
# 「请写出地名」—— 而那正是这道闸唯一要防的改动,所以必须匹配「禁令 + 位置词」
# 这个组合,而不是光看位置词出没出现过。
_LOCATION_WORD = re.compile(r"地名|地点|位置|坐标|经纬|location|place|gps|coordinate", re.I)
_PROHIBITION = re.compile(
    r"(严禁|禁止|不得|不许|不准|不要|别写|never|do not|don't|avoid)[^。\n]{0,24}"
    r"(地名|地点|位置|坐标|经纬|location|place|gps|coordinate)",
    re.I,
)


def test_prompt_forbids_location_info():
    """隐私红线:提示词必须明确**禁止**写地名。这是红线的第一道闸。"""
    assert _PROHIBITION.search(semantic.PROMPT), (
        "提示词里没有一条「禁止写位置信息」的指令"
    )


def test_prompt_has_no_line_that_asks_for_location():
    """反向断言:凡提到位置的行都必须是禁令。

    ⚠️ 别退回子串检查。旧写法是 `"地名" in PROMPT`,把整条禁令换成
    「请写出地名和位置,越具体越好」照样绿 —— 隐私红线的第一道闸等于没有。
    实测过这个变异:旧断言 passed,这一条 failed。
    """
    offenders = [
        line
        for line in semantic.PROMPT.splitlines()
        if _LOCATION_WORD.search(line) and not _PROHIBITION.search(line)
    ]
    assert offenders == [], f"这些行提到位置却不是禁令:{offenders}"


def test_model_failure_falls_back_not_raises(monkeypatch):
    """模型调用本身抛异常时降级 —— 一张照片的失败不该打挂整本分析。"""
    def _boom(image):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(semantic, "_call_vision", _boom)
    out = semantic.semantic_features(_img())
    assert out["composition"] is None
    assert out["description"] == ""


def test_call_vision_wires_into_the_real_ai_client(monkeypatch):
    """接线测试:_call_vision 必须真能拼出 ai_client.chat_completion 的调用。

    其余用例都把 _call_vision 打桩了,等于这条真实路径一行没验过 —— 计划里
    对 ai_client 的函数名/签名本来就是猜的。这里只桩掉最外层的 HTTP 调用,
    slot 解析、消息拼装、asyncio.run、extract_text 全部真跑。
    """
    import inspect

    from src import settings as settings_module
    from src.providers.ai_client import chat_completion as real_chat_completion

    # ⚠️ 真签名必须在打桩**之前**取:打桩后再 import 拿到的是 **kwargs 的桩,
    # 那样这条断言会被桩喂饱,永远为真。
    accepted = set(inspect.signature(real_chat_completion).parameters)

    monkeypatch.setenv("ARK_API_KEY", "ark-test-key")
    monkeypatch.setenv("VISION_PROVIDER", "ark")
    settings_module.reset_settings_cache()

    seen: dict = {}

    async def _fake_chat_completion(**kwargs):
        seen.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"composition":"wide","scene":"nature",'
                        '"peopleCount":"0","mood":"quiet","description":"山脊线"}'
                    }
                }
            ]
        }

    monkeypatch.setattr("src.providers.ai_client.chat_completion", _fake_chat_completion)

    out = semantic.semantic_features(_img())
    assert out["composition"] == "wide"
    assert out["description"] == "山脊线"

    # 照片必须以 image_url data URL 进 content,提示词必须同行。
    content = seen["messages"][0]["content"]
    assert content[0]["type"] == "text" and "composition" in content[0]["text"]
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert seen["api_key"] == "ark-test-key"

    # 桩是 **kwargs,吃得下任何键 —— 拿真签名再核一遍,否则「传了个
    # chat_completion 根本不认的参数」会被桩喂饱。
    assert set(seen) <= accepted, f"chat_completion 不认这些参数:{set(seen) - accepted}"


# ── 整组失效时不能全程静默 ──────────────────────────────────────────────────────
#
# 这个 except 原来一行日志都不打。视觉槽整体不可用时(key 轮换掉了、上游限流、
# 代理挡死)每张照片都静静落回退值,日志里没有任何一行说明视觉组挂了 —— 而
# tree_builder 会老老实实把回退值回填进章节树。


class _LogSpy:
    def __init__(self) -> None:
        self.warnings: list[tuple[str, dict]] = []

    def warning(self, event, **kw):
        self.warnings.append((event, kw))

    def info(self, event, **kw):
        pass


def test_vision_failure_is_logged_with_photo_id_and_exception_type(monkeypatch):
    def _boom(image):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(semantic, "_call_vision", _boom)
    spy = _LogSpy()
    monkeypatch.setattr(semantic, "log", spy)

    semantic.semantic_features(_img(), photo_id="p42")

    assert spy.warnings, "视觉调用失败没有打任何日志"
    kw = dict(spy.warnings[0][1])
    assert kw.get("photo_id") == "p42"
    assert "RuntimeError" in str(kw.get("error"))


def test_unparseable_response_is_logged_too(monkeypatch):
    """模型返回了东西但解不出 JSON —— 也要留痕,否则「全书 composition 都是 None」
    分不清是视觉组挂了还是模型在胡说。"""
    _stub(monkeypatch, "对不起，我无法分析这张图片。")
    spy = _LogSpy()
    monkeypatch.setattr(semantic, "log", spy)

    semantic.semantic_features(_img(), photo_id="p43")

    assert spy.warnings, "解析失败没有打任何日志"
    assert dict(spy.warnings[0][1]).get("photo_id") == "p43"
