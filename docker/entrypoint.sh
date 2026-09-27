#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Started with `user:` / `--user` already: nothing to switch to, just run as that user.
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

mkdir -p /config/cache /config/covers

# Only files not already owned by PUID:PGID — a blanket `chown -R` walked every cached
# thumbnail and video segment on every start, which on a big library slowed each boot.
find /config \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true

exec gosu "$PUID:$PGID" "$@"
