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
#   docker build -f apps/agent/Dockerfile .
COPY apps/agent/pyproject.toml ./
COPY apps/agent/alembic.ini ./alembic.ini
COPY apps/agent/migrations ./migrations
COPY apps/agent/src ./src
COPY packages/contracts/templates ./packages/contracts/templates
COPY packages/contracts/template-previews ./packages/contracts/template-previews
COPY packages/contracts/copy-examples ./packages/contracts/copy-examples

# CLIP is only installed for the dedicated 2GB analyze worker. The normal Agent
# service is kept lightweight and cannot run /v3/analyze in production.
RUN if [ "$INSTALL_CLIP" = "true" ]; then \
      pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.12.1 \
        torchvision==0.27.1 && \
      pip install "open_clip_torch>=2.26.0"; \
    fi
RUN pip install .

EXPOSE 8001

# Listen on $PORT (Fly's internal_port) on all interfaces. Settings are read from
# the environment (Fly secrets), not a .env file, in production.
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT}"]
