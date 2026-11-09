# Build from the repository root, so shared packages (packages/py-auth, packages/py-security) can
# be added to the image without changing how it is built:
#   docker build -f services/vendor-api/Dockerfile -t vendor-api .
# Shared packages are built from the repository copy, never fetched from an index (see ADR 0010);
# the issue that first imports one adds its COPY line and its path to the `pip wheel` command.
FROM python:3.12-slim AS builder
WORKDIR /build
COPY services/vendor-api/pyproject.toml ./services/vendor-api/
COPY services/vendor-api/vendor_api ./services/vendor-api/vendor_api
RUN pip wheel --no-cache-dir --wheel-dir /wheels ./services/vendor-api

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
