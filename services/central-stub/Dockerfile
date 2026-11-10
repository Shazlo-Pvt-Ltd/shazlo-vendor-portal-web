# Build from the repository root: the image includes packages/py-security and the contract schemas.
#   docker build -f services/central-stub/Dockerfile -t central-stub .
FROM python:3.12-slim AS builder
WORKDIR /build
COPY packages/py-security ./packages/py-security
COPY services/central-stub/pyproject.toml ./services/central-stub/
COPY services/central-stub/central_stub ./services/central-stub/central_stub
RUN pip wheel --no-cache-dir --wheel-dir /wheels ./packages/py-security ./services/central-stub

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 CONTRACT_DIR=/app/contract
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels
WORKDIR /app
# The one source of truth for the event schemas is docs/adr/0003-contract (not a copy in the repo).
COPY docs/adr/0003-contract/schemas /app/contract/schemas
USER app
EXPOSE 8003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8003/health')"
CMD ["uvicorn", "central_stub.main:app", "--host", "0.0.0.0", "--port", "8003"]
