import fs from 'fs';
import { pipeline } from 'stream';

// Parses a single-range `Range: bytes=…` header against a file of `size` bytes. Returns
// { start, end } (inclusive), `null` when there's no usable range header (serve the whole
// file), or `false` when the range can't be satisfied (416).
//
// Handles the three forms clients actually send: `a-b`, open-ended `a-`, and suffix `-n`
// (last n bytes) — and clamps an `end` past EOF, which the spec allows and which previously
// produced a Content-Length the stream could never fill, hanging the client.
export function parseRange(header, size) {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice(6).split(',')[0].trim();
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffix = parseInt(match[2], 10);
    if (suffix === 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  }

  if (start >= size || end < start) return false;
  return { start, end };
}

// Streams a file into the response without letting a read error (file deleted or unreadable
// between the existence check and the read, a cache sweep removing a segment mid-send) become
// an unhandled 'error' event — which, with a bare `.pipe()`, takes down the whole process.
export function streamFile(res, filePath, options) {
  pipeline(fs.createReadStream(filePath, options), res, (err) => {
    if (!err) return;
    if (!res.headersSent) {
      res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Could not read file' });
    } else {
      res.destroy();
    }
  });
}

// Shared by the audio and direct-play video routes: 206 for a satisfiable range, 416 for an
// unsatisfiable one, 200 with the whole file otherwise.
export function sendRangedFile(req, res, filePath, fileSize, contentType) {
  const range = parseRange(req.headers.range, fileSize);

  if (range === false) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    return res.end();
  }

  if (range) {
    res.writeHead(206, {
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': range.end - range.start + 1,
      'Content-Type': contentType
    });
    return streamFile(res, filePath, range);
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes'
  });
  streamFile(res, filePath);
}
