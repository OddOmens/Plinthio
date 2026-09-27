# ==========================================
# Stage 1: Build Frontend
# ==========================================
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Server
# ==========================================
FROM node:20-slim AS runner
WORKDIR /app

# Set by `docker buildx` per platform, and by the release workflow for the version.
ARG TARGETARCH
ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Plinthio" \
      org.opencontainers.image.description="Self-hosted media server & PWA for audiobooks, manga, comics, books, movies, TV and anime" \
      org.opencontainers.image.source="https://github.com/OddOmens/Plinthio" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

# VAAPI/QSV drivers ship in the default image so Intel and AMD GPUs transcode out of the box
# once /dev/dri is passed through (see docker-compose.yml). NVENC needs no extra packages
# here — it needs the NVIDIA container runtime on the host instead.
# intel-media-va-driver-non-free lives in Debian's non-free component, which the slim base
# image doesn't enable — without this the build fails with "no installation candidate".
RUN sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list

# The Intel iHD driver only exists for x86-64; ARM images (Raspberry Pi, Apple Silicon,
# most NAS boxes) get ffmpeg's software encoders plus Mesa, which is all that's usable there.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
    tzdata \
    ffmpeg \
    mesa-va-drivers \
    vainfo \
    $( [ "$TARGETARCH" = "amd64" ] || [ -z "$TARGETARCH" ] && echo intel-media-va-driver-non-free ) \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/config

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

# Lets `docker ps` and orchestrators see a wedged server, not just a running process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://127.0.0.1:8080/api/health > /dev/null || exit 1

VOLUME ["/config"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/index.js"]
