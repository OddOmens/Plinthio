// Server-wide key/value settings (the `settings` table).

export async function getSetting(db, key) {
  return (await db.get('SELECT value FROM settings WHERE key = ?', [key]))?.value;
}

export async function setSetting(db, key, value) {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}
