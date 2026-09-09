"""推理单飞锁 —— CLIP 与档案共用一把。

CLIP worker 是 shared-cpu-1x / 2048MB。实测(2026-09-09,本机原生):

    torch + open_clip + ViT-B-32 加载        峰值 ~1356 MB   ← 已经吃掉 66%
      + u2netp (320²) 推理                   峰值 ~1356 MB   ← 没再抬高
      + isnet  (1024²) 推理                  峰值 ~950 MB(单独跑)

也就是说单路推理装得下,**并行就装不下**:run_in_threadpool 默认 40 个线程,
两三路并发就把工作集乘爆。CLIP 和档案抢的是同一台机器的同一块内存,所以必须
共用同一把锁,不能各锁各的。

用 RLock 而不是 Lock:route 层已经包了一次,内层函数再包一次是同一个线程,
可重入才不会自锁。
"""

from __future__ import annotations

import threading
from typing import Any, Callable, TypeVar

_T = TypeVar("_T")

INFERENCE_LOCK = threading.RLock()


def locked(fn: Callable[..., _T]) -> Callable[..., _T]:
    """把一个同步推理函数包成「全机串行」—— 交给 run_in_threadpool 之前套上。"""

    def _run(*args: Any, **kwargs: Any) -> _T:
        with INFERENCE_LOCK:
            return fn(*args, **kwargs)

    return _run
