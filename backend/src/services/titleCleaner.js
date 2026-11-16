// Parses release filenames and messy titles into clean titles, years and season/episode numbers.

// Release markers: everything from the first one onward is not part of the title.
export const TECH_MARKERS = /\b(?:\d{3,4}p|4k|uhd|hdr\d*|dovi|dv|imax|remux|bluray|blu-ray|brrip|bdrip|webrip|web[- ]?dl|web|hdtv|dvdrip|hdrip|tvrip|x26[45]|h ?26[45]|hevc|avc|xvid|divx|aac\d?(?:\.\d)?|ac3|eac3|dts(?:[- ]?hd)?|truehd|atmos|ddp?\d?(?:\.1)?|\d{1,2}\.\d(?:ch)?|10bit|8bit|proper|repack|extended|remastered|unrated|criterion|directors\.?cut|theatrical|multi|dual|subbed|dubbed|amzn|nf|dsnp|atvp|itunes|hmax|peacock)\b/i;

export const ALL_MEDIA_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|flv|ts|cbz|cbr|epub|pdf|m4b|mp3)$/i;

// "｜" (fullwidth, what YouTube titles use in file names) or a spaced "|".
const BAR_SPLIT = /\s*[｜|]\s+|\s+[｜|]\s*/;

function cutBarTail(str) {
  const [head] = str.split(BAR_SPLIT);
  return head && head.trim() ? head : str;
}

// Narrower than TECH_MARKERS (no real words like "Web" or "Proper"), safe for existing titles.
const RELEASE_JUNK = /\b(?:\d{3,4}p|x26[45]|h ?26[45]|hevc|blu-?ray|brrip|bdrip|webrip|web-?dl|hdtv|dvdrip|hdrip|10bit|yts(?:\.mx)?)\b/i;
const EPISODE_TITLE = /^(S\d+E\d+(?:-?E\d+)?):\s*(.*)$/i;

/** Dots-for-spaces, underscores, [tags], release markers, (year), extensions or a "｜" tail. */
export function looksLikeFileName(title) {
  const t = String(title || '');
  return /_/.test(t) ||
    /\p{L}{2,}\.\p{L}{2,}\.\p{L}/u.test(t) ||
    /\[[^\]]*\]/.test(t) ||
    RELEASE_JUNK.test(t) ||
    /\((?:19|20)\d\d\)/.test(t) ||
    ALL_MEDIA_EXTENSIONS.test(t) ||
    BAR_SPLIT.test(t);
}

// Strips bar tails, [ids], release markers and the series name repeated at either end.
function cleanEpisodeName(name, series) {
  let out = cutBarTail(String(name || ''));
  out = out.replace(/\[[^\]]*\]/g, ' ');
  const junk = out.match(RELEASE_JUNK);
  if (junk && junk.index > 0) out = out.slice(0, junk.index);
  if (series) {
    const s = String(series).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`^(?:the\\s+)?${s}\\s*[-–—:]\\s+`, 'i'), '')
      .replace(new RegExp(`\\s+[-–—:]\\s*(?:the\\s+)?${s}$`, 'i'), '');
  }
  return out.replace(/\s+/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();
}

/**
 * Proposed `{ title, year }` or null. Works from the current title, not the file name, so
 * matched or edited titles are left alone and cleaning is idempotent.
 */
export function suggestCleanTitle({ title, path: filePath, series } = {}) {
  const current = String(title || '').trim();
  if (!current) {
    const fromFile = parseMediaTitle(String(filePath || '').split(/[/\\]/).pop());
    return fromFile.cleanTitle ? { title: fromFile.cleanTitle, year: fromFile.year } : null;
  }

  const episode = current.match(EPISODE_TITLE);
  if (episode) {
    const name = cleanEpisodeName(episode[2], series);
    const cleaned = name ? `${episode[1].toUpperCase()}: ${name}` : current;
    return cleaned !== current ? { title: cleaned, year: null } : null;
  }

  if (!looksLikeFileName(current)) return null;

  // Drop trailing "(…)" tags, keeping a year if one is among them.
  let rest = cutBarTail(current);
  let tagYear = null;
  for (let m; (m = rest.match(/\s*\(([^()]*)\)\s*$/)) && m.index > 0;) {
    if (/^(?:19|20)\d\d$/.test(m[1].trim())) tagYear = m[1].trim();
    rest = rest.slice(0, m.index);
  }
  rest = rest.trim();
  if (rest && rest !== current && !looksLikeFileName(rest)) return { title: rest, year: tagYear };

  const parsed = parseMediaTitle(rest || current);
  const cleaned = parsed.cleanTitle && parsed.cleanTitle !== parsed.original ? parsed.cleanTitle : rest;
  return cleaned && cleaned !== current ? { title: cleaned, year: parsed.year || tagYear } : null;
}

/** Returns { cleanTitle, year, isTv, series, season, episode, episodeTitle, original }. */
export function parseMediaTitle(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { cleanTitle: '', year: null, isTv: false, series: null, season: null, episode: null, episodeTitle: null, original: '' };
  }

  const original = rawInput.trim();
  let str = original;

  if (str.includes('/') || str.includes('\\')) {
    str = str.split(/[/\\]/).pop();
  }

  str = str.replace(ALL_MEDIA_EXTENSIONS, '');

  // Downloaded videos append "｜ channel ｜ pitch"; the name is before the first bar.
  str = cutBarTail(str);

  // Leading fansub group tag, e.g. [SubsPlease].
  str = str.replace(/^\[[^\]]+\]\s*/, '');

  // CRC32 checksums, e.g. [98E7B12C].
  str = str.replace(/\[[0-9a-fA-F]{8}\]/g, '');

  let working = str.replace(/[._]/g, ' ');

  // S01E02, 1x02, Ep 02, Episode 2. Word boundaries stop matches inside ids ("6a6x0W") or words ("Sleep 3").
  const tvPattern = /(?:\bs(\d+)\s*e(\d+)|\b(\d+)x(\d+)\b|\b(?:ep|episode)\.?\s*(\d+))/i;
  const tvMatch = working.match(tvPattern);

  if (tvMatch) {
    const season = parseInt(tvMatch[1] || tvMatch[3] || '1', 10);
    const episode = parseInt(tvMatch[2] || tvMatch[4] || tvMatch[5] || '1', 10);

    let seriesPart = working.slice(0, tvMatch.index).trim();
    let epPart = working.slice(tvMatch.index + tvMatch[0].length).trim();

    const epMarker = epPart.match(TECH_MARKERS);
    if (epMarker && epMarker.index !== undefined) {
      epPart = epPart.slice(0, epMarker.index);
    }
    epPart = epPart.replace(/\[[^\]]*\]/g, ' ').replace(/[()[\]]/g, ' ').trim();
    epPart = epPart.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();

    // Series year, e.g. "Doctor Who 2005".
    let seriesYear = null;
    const sYearMatch = seriesPart.match(/\b(19\d\d|20\d\d)\b/);
    if (sYearMatch && sYearMatch.index > 0) {
      seriesYear = sYearMatch[0];
      seriesPart = seriesPart.replace(/\b(19\d\d|20\d\d)\b/, '').replace(/[()[\]]/g, ' ').trim();
    }

    seriesPart = seriesPart.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();

    const cleanTitle = epPart ? `${tvMatch[0].toUpperCase()}: ${epPart}` : `${seriesPart} - ${tvMatch[0].toUpperCase()}`;

    return {
      isTv: true,
      series: seriesPart,
      season,
      episode,
      episodeTitle: epPart || null,
      cleanTitle,
      year: seriesYear,
      original
    };
  }

  // Movie.
  working = working.replace(/\[[^\]]*\]/g, ' ');

  const marker = working.match(TECH_MARKERS);
  if (marker && marker.index !== undefined) {
    working = working.slice(0, marker.index);
  }

  // Trailing "-Group" release tag.
  working = working.replace(/\s-[A-Za-z0-9_]+$/i, '');

  let cleanTitle = working.trim();
  let year = null;

  // "(2002)" wins; otherwise the last bare year.
  const parenYearMatch = cleanTitle.match(/\((19\d\d|20\d\d)\)/);
  if (parenYearMatch) {
    year = parenYearMatch[1];
    cleanTitle = cleanTitle.replace(/\((19\d\d|20\d\d)\)/g, '').trim();
  } else {
    const allYears = [...cleanTitle.matchAll(/\b(19\d\d|20\d\d)\b/g)];
    if (allYears.length > 0) {
      const lastYearMatch = allYears[allYears.length - 1];
      const yearStr = lastYearMatch[0];
      const yearIdx = lastYearMatch.index;

      const before = cleanTitle.slice(0, yearIdx).trim();
      const after = cleanTitle.slice(yearIdx + 4).trim();

      // Only a year with title text before it ("1917", "2001: A Space Odyssey" stay titles).
      if (before.length > 0) {
        year = yearStr;
        cleanTitle = `${before} ${after}`.trim();
      } else if (after.length === 0) {
        cleanTitle = yearStr;
        year = null;
      }
    }
  }

  cleanTitle = cleanTitle
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim();

  return {
    isTv: false,
    series: null,
    season: null,
    episode: null,
    episodeTitle: null,
    cleanTitle: cleanTitle || original,
    year,
    original
  };
}

/** Title for provider searches; the series name for episodes. */
export function cleanSearchTitle(title) {
  if (!title) return '';
  const parsed = parseMediaTitle(title);
  return parsed.isTv ? (parsed.series || parsed.cleanTitle) : parsed.cleanTitle;
}
