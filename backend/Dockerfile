FROM python:3.12-slim

# Runtime media dependencies (previously railpack deploy.aptPackages)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libheif1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install into the system interpreter: no venv, so no cross-stage symlink to dangle.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
