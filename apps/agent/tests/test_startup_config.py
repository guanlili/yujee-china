from pathlib import Path


def test_env_example_contains_non_empty_shared_secret_placeholder():
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    values = {}
    for line in env_example.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value

    assert values["AGENT_SHARED_SECRET"].strip()
