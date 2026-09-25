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

# VAAPI/QSV drivers ship in the default image so Intel and AMD GPUs transcode out of the box
# once /dev/dri is passed through (see docker-compose.yml). NVENC needs no extra packages
# here — it needs the NVIDIA container runtime on the host instead.
# intel-media-va-driver-non-free lives in Debian's non-free component, which the slim base
# image doesn't enable — without this the build fails with "no installation candidate".
RUN sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
    tzdata \
    ffmpeg \
    intel-media-va-driver-non-free \
    mesa-va-drivers \
    vainfo \
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

VOLUME ["/config"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/index.js"]
