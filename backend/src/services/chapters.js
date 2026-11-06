import { runProbe } from './probe.js';

const PROBE_TIMEOUT_MS = 15000;

// Chapter markers embedded in the file (m4b/m4a chapter atoms, MP3 CHAP frames, Matroska
// chapters). ffprobe reads all of those with one flag, and it's already a hard dependency
// for video, so there's no second parser to keep in sync. Resolves [] on any failure — a
// book without chapter data just plays as one long track.
export async function probeChapters(filePath) {
  const result = await runProbe('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', filePath], PROBE_TIMEOUT_MS);
  if (!result || result.code !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return normalizeChapters(parsed.chapters || []);
  } catch (e) {
    return [];
  }
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
