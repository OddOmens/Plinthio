import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { escapeXml } from '../utils/xml.js';
import { ratingSql } from '../services/visibility.js';

const router = express.Router();

const ITEM_ID_RE = /^[a-f0-9]{32}$/;
const COMIC_MEDIA_TYPES = ['manga', 'book'];

/**
 * OPDS readers (Chunky, Panels, Moon+ Reader, KyBook…) authenticate with HTTP Basic, which
 * authenticateToken accepts using an API key as the password. The only extra piece needed
 * here is the WWW-Authenticate challenge, without which a reader never prompts for
 * credentials — it just shows an error.
 */
router.use((req, res, next) => {
  if (!req.headers.authorization && !req.headers['x-api-key']) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Plinthio OPDS"');
    return res.status(401).send('Sign in with your username and a Plinthio API key as the password.');
  }
  next();
}, authenticateToken);

function feedUrl(req, suffix = '') {
  return `${req.protocol}://${req.get('host')}/api/opds${suffix}`;
}

function mediaUrl(req, suffix) {
  return `${req.protocol}://${req.get('host')}/api/media${suffix}`;
}

function sendFeed(res, xml) {
  res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
}

function feedWrapper({ id, title, selfUrl, startUrl, entries }) {
  return `<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:pse="http://vaemendis.net/opds-pse/ns">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" href="${escapeXml(selfUrl)}" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="start" href="${escapeXml(startUrl)}" type="application/atom+xml;profile=opds-catalog"/>
${entries.join('\n')}
</feed>`;
}

function navigationEntry({ id, title, href, summary }) {
  return `  <entry>
    <id>${escapeXml(id)}</id>
    <title>${escapeXml(title)}</title>
    <updated>${new Date().toISOString()}</updated>
    ${summary ? `<content type="text">${escapeXml(summary)}</content>` : ''}
    <link rel="subsection" href="${escapeXml(href)}" type="application/atom+xml;profile=opds-catalog"/>
  </entry>`;
}

// Root catalog: one navigation entry per library holding comics/books, plus read lists.
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const libraries = await db.all(
      `SELECT DISTINCT l.id, l.name
       FROM libraries l
       JOIN items i ON i.library_id = l.id
       WHERE i.media_type IN (${COMIC_MEDIA_TYPES.map(() => '?').join(',')})
       ORDER BY l.name ASC`,
      COMIC_MEDIA_TYPES
    );

    const entries = libraries.map((lib) => navigationEntry({
      id: `plinthio:library:${lib.id}`,
      title: lib.name,
      href: feedUrl(req, `/library/${lib.id}`)
    }));

    entries.push(navigationEntry({
      id: 'plinthio:readlists',
      title: 'Read Lists',
      summary: 'Your ordered reading lists',
      href: feedUrl(req, '/readlists')
    }));

    sendFeed(res, feedWrapper({
      id: 'plinthio:root',
      title: 'Plinthio',
      selfUrl: feedUrl(req),
      startUrl: feedUrl(req),
      entries
    }));
  } catch (err) {
    res.status(500).send('Could not build catalog');
  }
});

// One library: a navigation entry per series, plus standalone items with no series.
router.get('/library/:libraryId', async (req, res) => {
  try {
    const db = await getDb();
    const { libraryId } = req.params;

    const seriesRows = await db.all(
      `SELECT series, COUNT(*) as count
       FROM items
       WHERE library_id = ? AND series IS NOT NULL AND series != ''
       AND media_type IN (${COMIC_MEDIA_TYPES.map(() => '?').join(',')})
       AND id NOT IN (SELECT item_id FROM item_visibility WHERE user_id = ? OR user_id IS NULL)${ratingSql(req.user, 'items')}
       GROUP BY series ORDER BY series ASC`,
      [libraryId, ...COMIC_MEDIA_TYPES, req.user.id]
    );

    const standalone = await db.all(
      `SELECT * FROM items
       WHERE library_id = ? AND (series IS NULL OR series = '')
       AND media_type IN (${COMIC_MEDIA_TYPES.map(() => '?').join(',')})
       AND id NOT IN (SELECT item_id FROM item_visibility WHERE user_id = ? OR user_id IS NULL)${ratingSql(req.user, 'items')}
       ORDER BY title ASC`,
      [libraryId, ...COMIC_MEDIA_TYPES, req.user.id]
    );

    const entries = seriesRows.map((row) => navigationEntry({
      id: `plinthio:series:${libraryId}:${row.series}`,
      title: row.series,
      summary: `${row.count} issue${row.count === 1 ? '' : 's'}`,
      href: feedUrl(req, `/library/${libraryId}/series/${encodeURIComponent(row.series)}`)
    }));

    entries.push(...standalone.map((item) => acquisitionEntry(req, item)));

    sendFeed(res, feedWrapper({
      id: `plinthio:library:${libraryId}`,
      title: 'Library',
      selfUrl: feedUrl(req, `/library/${libraryId}`),
      startUrl: feedUrl(req),
      entries
    }));
  } catch (err) {
    res.status(500).send('Could not build library feed');
  }
});

router.get('/library/:libraryId/series/:seriesName', async (req, res) => {
  try {
    const db = await getDb();
    const { libraryId } = req.params;
    const seriesName = decodeURIComponent(req.params.seriesName);

    const items = await db.all(
      `SELECT * FROM items
       WHERE library_id = ? AND series = ?
       AND id NOT IN (SELECT item_id FROM item_visibility WHERE user_id = ? OR user_id IS NULL)${ratingSql(req.user, 'items')}
       ORDER BY volume ASC, title ASC`,
      [libraryId, seriesName, req.user.id]
    );

    sendFeed(res, feedWrapper({
      id: `plinthio:series:${libraryId}:${seriesName}`,
      title: seriesName,
      selfUrl: feedUrl(req, `/library/${libraryId}/series/${encodeURIComponent(seriesName)}`),
      startUrl: feedUrl(req),
      entries: items.map((item) => acquisitionEntry(req, item))
    }));
  } catch (err) {
    res.status(500).send('Could not build series feed');
  }
});

router.get('/readlists', async (req, res) => {
  try {
    const db = await getDb();
    const lists = await db.all(
      "SELECT * FROM collections WHERE user_id = ? AND COALESCE(type, 'collection') = 'readlist' AND COALESCE(category, 'read') = 'read' ORDER BY name ASC",
      [req.user.id]
    );

    sendFeed(res, feedWrapper({
      id: 'plinthio:readlists',
      title: 'Read Lists',
      selfUrl: feedUrl(req, '/readlists'),
      startUrl: feedUrl(req),
      entries: lists.map((list) => navigationEntry({
        id: `plinthio:readlist:${list.id}`,
        title: list.name,
        summary: list.description,
        href: feedUrl(req, `/readlists/${list.id}`)
      }))
    }));
  } catch (err) {
    res.status(500).send('Could not build read list feed');
  }
});

router.get('/readlists/:id', async (req, res) => {
  try {
    const db = await getDb();
    const list = await db.get(
      'SELECT * FROM collections WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!list) return res.status(404).send('Read list not found');

    const items = await db.all(`
      SELECT i.* FROM collection_items ci
      JOIN items i ON ci.item_id = i.id
      WHERE ci.collection_id = ?
      AND i.id NOT IN (SELECT item_id FROM item_visibility WHERE user_id = ? OR user_id IS NULL)${ratingSql(req.user, 'i')}
      ORDER BY ci.position ASC, ci.added_at ASC
    `, [req.params.id, req.user.id]);

    sendFeed(res, feedWrapper({
      id: `plinthio:readlist:${list.id}`,
      title: list.name,
      selfUrl: feedUrl(req, `/readlists/${list.id}`),
      startUrl: feedUrl(req),
      entries: items.map((item) => acquisitionEntry(req, item))
    }));
  } catch (err) {
    res.status(500).send('Could not build read list feed');
  }
});

/**
 * An acquisition entry is one readable item. Comics also advertise an OPDS-PSE stream link,
 * which is how page-streaming readers fetch individual pages instead of downloading the
 * whole archive up front — it points at the same page route the web reader uses.
 */
function acquisitionEntry(req, item) {
  if (!ITEM_ID_RE.test(item.id)) return '';

  const links = [];

  if (item.cover_path) {
    links.push(`    <link rel="http://opds-spec.org/image" href="${escapeXml(mediaUrl(req, `/cover/${item.id}`))}" type="image/jpeg"/>`);
    links.push(`    <link rel="http://opds-spec.org/image/thumbnail" href="${escapeXml(mediaUrl(req, `/cover/${item.id}?w=360`))}" type="image/jpeg"/>`);
  }

  links.push(`    <link rel="http://opds-spec.org/acquisition" href="${escapeXml(mediaUrl(req, `/book/${item.id}/file`))}" type="${escapeXml(mimeForFormat(item.format))}"/>`);

  if (item.media_type === 'manga' && item.total_pages > 0) {
    // {pageNumber} is substituted by the reader. Plinthio's page route is zero-indexed,
    // while OPDS-PSE counts from zero too, so the value passes through unchanged.
    links.push(`    <link rel="http://vaemendis.net/opds-pse/stream" href="${escapeXml(mediaUrl(req, `/manga/${item.id}/page/{pageNumber}`))}" type="image/jpeg" pse:count="${item.total_pages}"/>`);
  }

  return `  <entry>
    <id>plinthio:item:${escapeXml(item.id)}</id>
    <title>${escapeXml(item.title)}</title>
    <updated>${escapeXml(item.updated_at || new Date().toISOString())}</updated>
    ${item.author ? `<author><name>${escapeXml(item.author)}</name></author>` : ''}
    ${item.description ? `<summary type="text">${escapeXml(item.description)}</summary>` : ''}
${links.join('\n')}
  </entry>`;
}

function mimeForFormat(format) {
  switch ((format || '').toLowerCase()) {
    case 'cbz': return 'application/vnd.comicbook+zip';
    case 'cbr': return 'application/vnd.comicbook-rar';
    case 'epub': return 'application/epub+zip';
    case 'pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

export default router;
