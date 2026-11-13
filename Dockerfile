# One small image: the built map plus the Python feed.
# Final image has no Node, no tests, no source maps.

FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VOZLINIA_HOST=0.0.0.0 \
    VOZLINIA_PORT=5000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY --from=web /src/dist ./web/dist
EXPOSE 5000
USER nobody
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/', timeout=2)"
CMD ["python", "-m", "server.server"]
