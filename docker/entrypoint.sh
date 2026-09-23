#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

mkdir -p /config/cache /config/covers
chown -R "$PUID:$PGID" /config 2>/dev/null || true

exec gosu "$PUID:$PGID" "$@"
