import { runProbe } from './probe.js';

const PROBE_TIMEOUT_MS = 15000;

// Embedded chapter markers (m4b/m4a atoms, MP3 CHAP frames, Matroska chapters) via ffprobe.
// Resolves [] on any failure, so the book plays as one long track.
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
