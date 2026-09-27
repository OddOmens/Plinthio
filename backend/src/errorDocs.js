import { errorCatalog } from './errors.js';

const SECTIONS = [
  { prefix: 'P0', title: 'General' },
  { prefix: 'P1', title: 'Sign-in & permissions' },
  { prefix: 'P2', title: 'Libraries & scanning' },
  { prefix: 'P3', title: 'Playback' },
  { prefix: 'P4', title: 'Metadata providers' },
  { prefix: 'P5', title: 'Lists & requests' }
];

// Markdown reference for docs/error-codes.md. Generated, so edit src/errors.js instead.
export function renderErrorDocs() {
  const codes = errorCatalog();
  const lines = [
    '# Plinthio error codes',
    '',
    '<!-- Generated from backend/src/errors.js by `npm run docs:errors`. Do not edit by hand. -->',
    '',
    'Every error from the Plinthio API carries a code, and the web app shows it next to the message, e.g. "The media file is missing from disk (P301)". API responses look like this:',
    '',
    '```json',
    '{ "error": "The media file is missing from disk", "code": "P301" }',
    '```',
    '',
    'Admins also get a `detail` field with the underlying cause (the ffmpeg error, the filesystem error, and so on). The same list is in the app under **Docs → Error codes**, and served as JSON at `GET /api/errors`.',
    '',
    'Codes marked *app* are raised by the web app itself rather than returned by the server.',
    ''
  ];

  for (const section of SECTIONS) {
    const inSection = codes.filter((c) => c.code.startsWith(section.prefix));
    if (!inSection.length) continue;
    lines.push(`## ${section.title}`, '');
    for (const c of inSection) {
      const status = c.side === 'client' ? 'app' : `HTTP ${c.status}`;
      lines.push(`### ${c.code}: ${c.title}`, '');
      lines.push(`*${status}.* ${c.meaning}`, '');
      lines.push(`**What to do:** ${c.fix}`, '');
    }
  }

  return lines.join('\n');
}
