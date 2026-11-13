FROM python:3.11-slim AS extension
WORKDIR /build
COPY extension/ ./extension/
RUN python extension/scripts/package.py /build/teman-pora-extension.zip

FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY --from=extension /build/teman-pora-extension.zip ./public/teman-pora-extension.zip
ENV STATIC_EXPORT=true NEXT_PUBLIC_API_URL=""
RUN npm run build

FROM node:22-bookworm-slim AS blob
WORKDIR /blob
COPY backend/blob/package*.json ./
RUN npm ci --omit=dev
COPY backend/blob/storage.mjs ./

FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ind tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /frontend/.next-render ./frontend-dist
COPY --from=blob /usr/local/bin/node /usr/local/bin/node
COPY --from=blob /blob ./blob
ENV PYTHONUNBUFFERED=1 FRONTEND_DIST=/app/frontend-dist
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
