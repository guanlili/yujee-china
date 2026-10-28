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

COPY engine/pyproject.toml ./
COPY engine/src ./src
COPY packages/contracts/templates ./packages/contracts/templates
COPY packages/contracts/pricing ./packages/contracts/pricing

# 权重 COPY 必须放在 pip 层之后：权重文件 ~540MB 常变（增删/校验），放前面会让
# 每次换权重都重跑下面的 pip 层（torch 190MB 重新下载，2026-10-25 实测多花 5 分钟）。
# 权重选型：u2netp 320² 建档 / isnet 1024² 抠图（上游 engine/Dockerfile:24-33）；
# ViT-B-32.pt 是 OpenAI 原版 CLIP 权重（openaipublic azureedge，文件名内嵌的
# sha256 = 40d36571…eba950af 即校验值）：open_clip 3.x 的 pretrained="openai" 走
# HuggingFace Hub，国内不通，因此烤进镜像并用 GROUPING_CLIP_MODEL_PATH 本地加载。

ADD https://mirrors.aliyun.com/pytorch-wheels/cpu/torch-2.12.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl \
    https://mirrors.aliyun.com/pytorch-wheels/cpu/torchvision-0.27.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl \
    /tmp/

RUN pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      /tmp/torch-2.12.1+cpu-*.whl /tmp/torchvision-0.27.1+cpu-*.whl \
 && rm -f /tmp/torch-*.whl /tmp/torchvision-*.whl \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      "open_clip_torch>=2.26.0" \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
      "onnxruntime==1.20.1" "numpy>=1.26" \
 && pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple .

COPY weights/u2netp.onnx weights/isnet-general-use.onnx weights/ViT-B-32.pt /app/models/

EXPOSE 8001

# 与上游一致：单进程 uvicorn（进程内并发原语纪律，见 deploy/china/README.md）。
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT}"]
