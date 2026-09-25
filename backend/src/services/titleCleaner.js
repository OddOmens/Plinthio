/**
 * Media title cleanup and metadata parsing utilities.
 * Extracts clean human-readable titles, release years, and TV season/episode numbers
 * from release filenames or dirty library titles.
 */

// Matches common technical markers used in scene releases and web rips.
// Everything from the first marker onward is release metadata rather than part of the title.
export const TECH_MARKERS = /\b(?:\d{3,4}p|4k|uhd|hdr\d*|dovi|dv|imax|remux|bluray|blu-ray|brrip|bdrip|webrip|web[- ]?dl|web|hdtv|dvdrip|hdrip|tvrip|x26[45]|h ?26[45]|hevc|avc|xvid|divx|aac\d?(?:\.\d)?|ac3|eac3|dts(?:[- ]?hd)?|truehd|atmos|ddp?\d?(?:\.1)?|\d{1,2}\.\d(?:ch)?|10bit|8bit|proper|repack|extended|remastered|unrated|criterion|directors\.?cut|theatrical|multi|dual|subbed|dubbed|amzn|nf|dsnp|atvp|itunes|hmax|peacock)\b/i;

// Video file extensions
export const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|flv|ts)$/i;

// All media extensions handled by Plinthio
export const ALL_MEDIA_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|flv|ts|cbz|cbr|epub|pdf|m4b|mp3)$/i;

/**
 * Parse a raw filename or existing title into structured components:
 * { cleanTitle, year, isTv, series, season, episode, episodeTitle, original }
 */
export function parseMediaTitle(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { cleanTitle: '', year: null, isTv: false, series: null, season: null, episode: null, episodeTitle: null, original: '' };
  }

  const original = rawInput.trim();
  let str = original;

  // Take only filename if a full path was passed
  if (str.includes('/') || str.includes('\\')) {
    str = str.split(/[/\\]/).pop();
  }

  // Strip media extension
  str = str.replace(ALL_MEDIA_EXTENSIONS, '');

  // Strip anime/fansub group tags at start: e.g. [SubsPlease], [Erai-raws], [Judas]
  str = str.replace(/^\[[^\]]+\]\s*/, '');

  // Strip 8-character CRC32 checksums common in anime: e.g. [98E7B12C]
  str = str.replace(/\[[0-9a-fA-F]{8}\]/g, '');

  // Replace dots and underscores with spaces, but preserve hyphens/colons
  let working = str.replace(/[._]/g, ' ');

  // Check for TV / Episode patterns: S01E02, 1x02, Ep 02, Episode 2
  const tvPattern = /(?:s(\d+)\s*e(\d+)|(\d+)x(\d+)|(?:ep|episode)\.?\s*(\d+))/i;
  const tvMatch = working.match(tvPattern);

  if (tvMatch) {
    const season = parseInt(tvMatch[1] || tvMatch[3] || '1', 10);
    const episode = parseInt(tvMatch[2] || tvMatch[4] || tvMatch[5] || '1', 10);

    let seriesPart = working.slice(0, tvMatch.index).trim();
    let epPart = working.slice(tvMatch.index + tvMatch[0].length).trim();

    // Clean technical markers from episode title part
    const epMarker = epPart.match(TECH_MARKERS);
    if (epMarker && epMarker.index !== undefined) {
      epPart = epPart.slice(0, epMarker.index);
    }
    epPart = epPart.replace(/\[[^\]]*\]/g, ' ').replace(/[()[\]]/g, ' ').trim();
    epPart = epPart.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();

    // Extract year from series part if present e.g. "Doctor Who 2005"
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

  // Not a TV episode — process as movie / feature film

  // Remove bracketed technical metadata like [1080p], [BluRay], [YTS.MX], [EXTENDED REMASTERED]
  working = working.replace(/\[[^\]]*\]/g, ' ');

  // Cut off at the first technical release marker
  const marker = working.match(TECH_MARKERS);
  if (marker && marker.index !== undefined) {
    working = working.slice(0, marker.index);
  }

  // Cut off trailing release group formatted as "-Group" e.g. "-RDNYB" or "-YTS"
  working = working.replace(/\s-[A-Za-z0-9_]+$/i, '');

  let cleanTitle = working.trim();
  let year = null;

  // Case 1: Release year in parentheses: e.g. "Resident Evil (2002)" or "Blade Runner 2049 (2017)"
  const parenYearMatch = cleanTitle.match(/\((19\d\d|20\d\d)\)/);
  if (parenYearMatch) {
    year = parenYearMatch[1];
    cleanTitle = cleanTitle.replace(/\((19\d\d|20\d\d)\)/g, '').trim();
  } else {
    // Case 2: 4-digit year delimited by spaces
    const allYears = [...cleanTitle.matchAll(/\b(19\d\d|20\d\d)\b/g)];
    if (allYears.length > 0) {
      const lastYearMatch = allYears[allYears.length - 1];
      const yearStr = lastYearMatch[0];
      const yearIdx = lastYearMatch.index;

      const before = cleanTitle.slice(0, yearIdx).trim();
      const after = cleanTitle.slice(yearIdx + 4).trim();

      // Only extract as release year if there is title text before it
      // (prevents turning "1917" into an empty title with year 1917, or breaking "2001: A Space Odyssey")
      if (before.length > 0) {
        year = yearStr;
        cleanTitle = `${before} ${after}`.trim();
      } else if (after.length === 0) {
        // Sole word is the year e.g. "1917"
        cleanTitle = yearStr;
        year = null;
      }
    }
  }

  // Cleanup residual punctuation, trailing hyphens, double spaces, empty brackets
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

/**
 * Clean a search title for external provider queries (e.g. TMDB search query).
 * Strips technical noise and trailing years.
 */
export function cleanSearchTitle(title) {
  if (!title) return '';
  const parsed = parseMediaTitle(title);
  return parsed.isTv ? (parsed.series || parsed.cleanTitle) : parsed.cleanTitle;
}
