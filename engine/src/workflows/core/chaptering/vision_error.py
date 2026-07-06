"""Vision-agent shared error type."""


class VisionError(Exception):
    """AI 视觉环节以一种应作为 AGENT_VISION_FAILED 外抛的方式失败。"""
