# CLIP worker 国内构建变体（engine/Dockerfile 的 INSTALL_CLIP=true 分支本地化）。
# 与上游的三处差异：
#   1) pip 走清华源；torch/torchvision CPU wheel 走阿里 pytorch-wheels 镜像
#      （download.pytorch.org 国内不通；PyPI 的 linux torch 是 CUDA 巨包，不能碰）；
#      2026-10-28 起大 wheel 用远程 ADD 预取：阿里镜像 CDN 开始对 HTTP/1.1 限速
#      ~80KB/s（pip 只会 http1.1，两个 wheel ~460MB 要磨 1 小时），builder 的
#      Go HTTP 走 HTTP/2 实测 14MB/s。URL 只含 x86_64（目标机固定）。
#   2) 两个 ONNX 权重从构建上下文 COPY（rembg GitHub Releases 国内不稳，
#      预下载放 weights/，与上游 URL 同源：v0.0.0 release 资产，Apache-2.0）；
#   3) 本文件只服务 CLIP worker，无 INSTALL_CLIP 开关。
# 上游 engine/Dockerfile 变更（版本/依赖/COPY 路径）时应同步回灌本文件。
# 构建上下文 = 仓根等价目录树（含 weights/）：
#   docker build -f deploy/china/build/clip.Dockerfile -t yujee/clip:china .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8001

WORKDIR /app

# 依赖层只用 pyproject+uv.lock(2026-11-05 P1 配置漂移修复):engine 源码/模板/
# 价格表变动不再触发下面的 pip 层重跑(此前 COPY src 在 pip 之前,改一行代码重装全部)。
COPY engine/pyproject.toml engine/uv.lock ./

# 权重 COPY 必须放在 pip 层之后：权重文件 ~540MB 常变（增删/校验），放前面会让
# 每次换权重都重跑下面的 pip 层（torch 190MB 重新下载，2026-10-25 实测多花 5 分钟）。
# 权重选型：u2netp 320² 建档 / isnet 1024² 抠图（上游 engine/Dockerfile:24-33）；
# ViT-B-32.pt 是 OpenAI 原版 CLIP 权重（openaipublic azureedge，文件名内嵌的
# sha256 = 40d36571…eba950af 即校验值）：open_clip 3.x 的 pretrained="openai" 走
# HuggingFace Hub，国内不通，因此烤进镜像并用 GROUPING_CLIP_MODEL_PATH 本地加载。

# 2026-11-08: 远程 ADD 已不可用 —— BuildKit 走阿里 CDN 会挂死(两次部署各 15/30
# 分钟零进度后超时),同期服务器 curl --http2 实测 13MB/s。改为容器内 curl 下载:
# 仍然走 HTTP/2(避开 HTTP/1.1 的 ~80KB/s 限速),带重试;apt 源换清华以求 curl 装得快。
# pip 层引用 /tmp/torch-*.whl 的文件名保持不变。
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update -qq && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL --http2 --retry 5 --retry-delay 3 -o /tmp/torch-2.12.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl \
      https://mirrors.aliyun.com/pytorch-wheels/cpu/torch-2.12.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl \
 && curl -fsSL --http2 --retry 5 --retry-delay 3 -o /tmp/torchvision-0.27.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl \
      https://mirrors.aliyun.com/pytorch-wheels/cpu/torchvision-0.27.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl

# torch/torchvision 走阿里 pytorch-wheels 固定 URL wheel(见文件头差异 1);
# 其余 PyPI 依赖(fastapi/uvicorn/httpx/pillow/psycopg/pydantic 及 clip extra 的
# onnxruntime/numpy,含全部传递依赖)一律由 engine/uv.lock 导出钉版,替换原来的
# >= 区间/内联钉版——与 CI `uv sync` 同一份 lock,构建可复现。
# open_clip_torch 不在 engine/pyproject.toml(上游 engine/Dockerfile 单独 pip 装,
# 属上游分歧,不能进 lockfile),此处显式钉 2.x 末版;升 3.x 前须回归
# ViT-B-32/openai 权重加载路径。
RUN pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple uv \
 && uv export --frozen --no-dev --extra clip --no-emit-project \
      --format requirements-txt -o /tmp/requirements.lock.txt \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      /tmp/torch-2.12.1+cpu-*.whl /tmp/torchvision-0.27.1+cpu-*.whl \
 && rm -f /tmp/torch-*.whl /tmp/torchvision-*.whl \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      -r /tmp/requirements.lock.txt \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      "open_clip_torch==2.32.0"

# 源码层在 pip 之后:装的是本包自身,用 --no-deps 免得再解析一遍依赖
# (依赖已在上面装好;src 变动只重跑这一层,秒级)。
COPY engine/src ./src
COPY packages/contracts/templates ./packages/contracts/templates
COPY packages/contracts/pricing ./packages/contracts/pricing
RUN pip install --no-deps --index-url https://pypi.tuna.tsinghua.edu.cn/simple .

COPY weights/u2netp.onnx weights/isnet-general-use.onnx weights/ViT-B-32.pt /app/models/

EXPOSE 8001

# 与上游一致：单进程 uvicorn（进程内并发原语纪律，见 deploy/china/README.md）。
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT}"]
