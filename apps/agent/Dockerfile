# Yujee Agent (FastAPI) — deployed to Fly.io.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8001

WORKDIR /app

# Install runtime deps from pyproject. Source is needed at build time because the
# package (src/) is built and installed; deps come from [project.dependencies].
# Build from repo root:
#   docker build -f apps/agent/Dockerfile .
COPY apps/agent/pyproject.toml ./
COPY apps/agent/src ./src
COPY packages/contracts/templates ./packages/contracts/templates
RUN pip install .

EXPOSE 8001

# Listen on $PORT (Fly's internal_port) on all interfaces. Settings are read from
# the environment (Fly secrets), not a .env file, in production.
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT}"]
