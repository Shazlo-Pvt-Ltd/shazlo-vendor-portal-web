# Build from the repository root: the image includes packages/py-auth and packages/py-security.
#   docker build -f services/vendor-api/Dockerfile -t vendor-api .
# Shared packages are built from the repository copy, never fetched from an index (see ADR 0010):
# vendor-api's pyproject does not list them (see requirements-shared.txt).
FROM python:3.12-slim AS builder
WORKDIR /build
COPY packages/py-auth ./packages/py-auth
COPY packages/py-security ./packages/py-security
COPY services/vendor-api/pyproject.toml ./services/vendor-api/
COPY services/vendor-api/vendor_api ./services/vendor-api/vendor_api
RUN pip wheel --no-cache-dir --wheel-dir /wheels ./packages/py-auth ./packages/py-security ./services/vendor-api

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels
WORKDIR /app
# Lets `alembic upgrade head` run in the container; migrations ship inside the package.
COPY services/vendor-api/alembic.ini ./
USER app
EXPOSE 8002
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8002/health')"
CMD ["uvicorn", "vendor_api.main:app", "--host", "0.0.0.0", "--port", "8002"]
