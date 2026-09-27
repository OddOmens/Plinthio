import { spawn } from 'child_process';

const PROBE_TIMEOUT_MS = 15000;

// Chapter markers embedded in the file (m4b/m4a chapter atoms, MP3 CHAP frames, Matroska
// chapters). ffprobe reads all of those with one flag, and it's already a hard dependency
// for video, so there's no second parser to keep in sync. Resolves [] on any failure — a
// book without chapter data just plays as one long track.
export function probeChapters(filePath) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let proc;
    const timer = setTimeout(() => {
      try { proc?.kill('SIGKILL'); } catch (e) { /* already gone */ }
      done([]);
    }, PROBE_TIMEOUT_MS);

    try {
      proc = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', filePath]);
    } catch (e) {
      return done([]);
    }

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', () => { /* ignore */ });
    proc.on('error', () => done([]));
    proc.on('close', (code) => {
      if (code !== 0) return done([]);
      try {
        const parsed = JSON.parse(stdout);
        done(normalizeChapters(parsed.chapters || []));
      } catch (e) {
        done([]);
      }
    });
  });
}

export function normalizeChapters(raw) {
  const chapters = raw
    .map((c, index) => ({
      index,
      title: (c.tags?.title || c.tags?.TITLE || '').trim() || `Chapter ${index + 1}`,
      start: Number(c.start_time),
      end: Number(c.end_time)
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  chapters.forEach((c, i) => { c.index = i; });
  // A single "chapter" spanning the whole file carries no navigation value.
  return chapters.length > 1 ? chapters : [];
}
