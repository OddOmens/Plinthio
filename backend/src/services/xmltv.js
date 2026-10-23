import { StringDecoder } from 'string_decoder';
import sax from 'sax';

// XMLTV programme guides. A country's guide runs to tens of megabytes (hundreds once
// unzipped), so it's parsed as it downloads and never held whole: programmes are handed to
// `onBatch` a few hundred at a time, and the download waits while each batch is written.
//
//   <programme start="20261022140000 +0000" stop="20261022150000 +0000" channel="News.us@SD">
//     <title lang="en">Evening News</title><sub-title>…</sub-title><desc>…</desc><category>News</category>
//   </programme>

/** XMLTV's "YYYYMMDDhhmmss ±hhmm" (seconds and offset optional; no offset means UTC) as epoch ms. */
export function parseXmltvTime(value) {
  const m = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', sign, oh, om] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset = sign ? (sign === '-' ? -1 : 1) * ((+oh * 60) + +om) * 60000 : 0;
  const ms = utc - offset;
  return Number.isFinite(ms) ? ms : null;
}

const FIELDS = { title: 'title', 'sub-title': 'subtitle', desc: 'description', category: 'category' };
const MAX_FIELD = { title: 300, subtitle: 300, description: 2000, category: 100 };
const BATCH = 500;

/**
 * Reads an XMLTV stream (text or bytes, already decompressed).
 *
 *   onChannel(id)       → optional; called for each <channel id="…"> (they come first)
 *   targets(channelId)  → the tvg ids a guide channel's programmes belong to ([] to skip it)
 *   from, to            → only programmes overlapping this window (epoch ms) are kept
 *   onBatch(programmes) → async; receives [{ tvgId, start, stop, title, subtitle, description, category }]
 *
 * Resolves with the number of programmes passed on.
 */
export async function parseXmltv(stream, { onChannel, targets, from, to, onBatch }) {
  const parser = sax.parser(false, { lowercase: true, trim: false, normalize: false });
  const decoder = new StringDecoder('utf8');
  let batch = [];
  let total = 0;
  let current = null; // programme being read, or null when skipping
  let field = null; // which of its fields text is going into
  let depth = 0; // nesting inside the current field (e.g. markup inside <desc>)

  parser.onopentag = (node) => {
    if (node.name === 'channel' && !current) {
      if (onChannel && node.attributes.id) onChannel(node.attributes.id);
      return;
    }
    if (node.name === 'programme') {
      const tvgIds = targets(node.attributes.channel || '');
      const start = parseXmltvTime(node.attributes.start);
      const stop = parseXmltvTime(node.attributes.stop);
      current = tvgIds.length && start !== null && stop !== null && stop > start && stop > from && start < to
        ? { tvgIds, start, stop, title: null, subtitle: null, description: null, category: null }
        : null;
      field = null;
      return;
    }
    if (!current) return;
    if (field) {
      depth++;
      return;
    }
    const key = FIELDS[node.name];
    // Only the first of each (titles in several languages, several categories).
    if (key && current[key] === null) {
      field = key;
      depth = 0;
      current[key] = '';
    }
  };

  const onText = (text) => {
    if (current && field && current[field].length < MAX_FIELD[field]) current[field] += text;
  };
  parser.ontext = onText;
  parser.oncdata = onText;

  parser.onclosetag = (name) => {
    if (name === 'programme') {
      if (current && current.title !== null) {
        const clip = (key) => {
          const value = current[key]?.replace(/\s+/g, ' ').trim();
          return value ? value.slice(0, MAX_FIELD[key]) : null;
        };
        const title = clip('title');
        if (title) {
          for (const tvgId of current.tvgIds) {
            batch.push({
              tvgId,
              start: current.start,
              stop: current.stop,
              title,
              subtitle: clip('subtitle'),
              description: clip('description'),
              category: clip('category')
            });
          }
        }
      }
      current = null;
      field = null;
      return;
    }
    if (field) {
      if (depth > 0) depth--;
      else field = null;
    }
  };

  // Real-world guides have stray ampersands and unknown entities; carry on past them.
  parser.onerror = () => {
    parser.error = null;
    parser.resume();
  };

  const flush = async () => {
    if (!batch.length) return;
    const out = batch;
    batch = [];
    total += out.length;
    await onBatch(out);
  };

  for await (const chunk of stream) {
    parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    if (batch.length >= BATCH) await flush();
  }
  parser.write(decoder.end());
  parser.close();
  await flush();
  return total;
}
