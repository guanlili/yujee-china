"""Gemini 判图网络出口开关(_gemini_client_kwargs):

未设 → 环境代理(trust_env 默认);"direct" → 强制直连忽略环境代理;
其他 → 显式代理 URL。只影响 Gemini client,不碰 Ark/DeepSeek。
"""

from src.providers import gemini_client


def test_unset_keeps_env_proxy_behaviour():
    assert gemini_client.client_kwargs(None, 30) == {"timeout": 30}
    assert gemini_client.client_kwargs("", 30) == {"timeout": 30}
    assert gemini_client.client_kwargs("  ", 30) == {"timeout": 30}


def test_direct_disables_env_proxy():
    assert gemini_client.client_kwargs("direct", 30) == {"timeout": 30, "trust_env": False}
    assert gemini_client.client_kwargs("DIRECT", 30) == {"timeout": 30, "trust_env": False}


def test_url_sets_explicit_proxy():
    assert gemini_client.client_kwargs("http://127.0.0.1:7890", 45) == {
        "timeout": 45,
        "proxy": "http://127.0.0.1:7890",
        "trust_env": False,
    }
