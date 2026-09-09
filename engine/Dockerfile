# Yujee Agent (FastAPI) — deployed to Fly.io.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8001

ARG INSTALL_CLIP=false

WORKDIR /app

# Install runtime deps from pyproject. Source is needed at build time because the
# package (src/) is built and installed; deps come from [project.dependencies].
# Build from repo root:
#   docker build -f engine/Dockerfile .
COPY engine/pyproject.toml ./
COPY engine/src ./src
COPY packages/contracts/templates ./packages/contracts/templates
# 模型单价表(成本估算的单一真相)。providers/pricing.py 在运行时读它 —— 漏 COPY
# 的话镜像里就找不到,成本一律记为 null。
COPY packages/contracts/pricing ./packages/contracts/pricing

# CLIP is only installed for the dedicated 2GB analyze worker. The normal Agent
# service is kept lightweight and cannot run /v3/analyze in production.
#
# 同一个 if 块里还装照片档案的两个分割模型(ONNX)。**两个都是 Apache-2.0** ——
# 刻意不用 RMBG-1.4:它的 bria-rmbg-1.4 许可写明 "source-available model for
# non-commercial use",而 Yujee 是收费产品,烘进镜像就是拿非商用许可的模型商用。
#   u2netp  (4MB   / 320²)  建档:只要主体包围盒,320² 足够,实测内存几乎白嫖
#   isnet   (170MB / 1024²) 真抠图:要精细边缘;320² 的糙边啃人像正是 2026-08-29
#                                   否决自动抠图的那个病
# 权重 URL 固定在 rembg 的 v0.0.0 release 资产上,不用会漂的分支链接。
# (注:注释一律放在 RUN 之外 —— 续行里夹 # 依赖 parser 的注释剥离,不值得赌。)
RUN if [ "$INSTALL_CLIP" = "true" ]; then \
      pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.12.1 \
        torchvision==0.27.1 && \
      pip install "open_clip_torch>=2.26.0" && \
      pip install "onnxruntime==1.20.1" "numpy>=1.26" && \
      mkdir -p /app/models && \
      python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx', '/app/models/u2netp.onnx')" && \
      python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx', '/app/models/isnet-general-use.onnx')"; \
    fi
RUN pip install .

EXPOSE 8001

# Listen on $PORT (Fly's internal_port) on all interfaces. Settings are read from
# the environment (Fly secrets), not a .env file, in production.
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT}"]
