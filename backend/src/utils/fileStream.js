import fs from 'fs';
import { pipeline } from 'stream';

// For res.sendFile/res.download on server-built paths. Express 5 refuses dot segments by
// default, which breaks a data directory like ~/.local/share.
export const SEND_OPTS = { dotfiles: 'allow' };

// Parses a single `Range: bytes=…` header (`a-b`, `a-`, `-n`). Returns { start, end }
// (inclusive), null for no usable range (whole file), or false when unsatisfiable (416).
// An `end` past EOF is clamped, or Content-Length would promise bytes that never come.
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

// Streams a file so a read error (file removed mid-send) can't become an unhandled 'error'
// event, which with a bare `.pipe()` crashes the process.
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

// 206 for a satisfiable range, 416 for an unsatisfiable one, 200 with the whole file otherwise.
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
