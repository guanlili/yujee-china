from ..schemas import LayoutRequest


async def run(req: LayoutRequest) -> None:
    raise NotImplementedError


async def emit_failure(req: LayoutRequest, code: str, message: str) -> None:
    raise NotImplementedError
