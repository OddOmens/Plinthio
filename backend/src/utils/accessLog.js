import { normalizeIp } from '../services/network.js';

// One line per request in the container's output: who asked, for what, and how it ended.
// The address comes first so a scan or a run of wrong passwords can be traced to its source,
// and so a log watcher that blocks repeat offenders has something to act on. It is the visitor's own
// address when TRUST_PROXY covers the proxy in front, and the proxy's address otherwise.
export const ACCESS_LOG_FORMAT = ':client :method :url :status :response-time ms - :res[content-length] ":user-agent"';

export function clientAddress(req) {
  return normalizeIp(req?.ip || req?.socket?.remoteAddress || '') || '-';
}

// Paths that scanners ask every web server for and that are never a page of the app:
// dot-files at the top level (/.env, /.git/config), WordPress paths (/wp-login.php, /wp-json/…)
// and server scripts (/info.php, /login.action). The app's page fallback answers these with
// "not found" instead of the app itself, so a scan reads as a run of misses, in the log and to
// the scanner. The two routes that carry a free-text name (/series/…, /manga/series/…) are
// left alone, whatever the name ends in.
const SCRIPT_EXTENSION = /\.(?:php\d?|phtml|aspx?|jspx?|cgi|action)$/i;
const FREE_TEXT_ROUTE = /^\/(?:series|manga\/series)\//i;

export function isScannerPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const first = pathname.split('/')[1] || '';
  if (first.startsWith('.') || /^wp-/i.test(first)) return true;
  return SCRIPT_EXTENSION.test(pathname) && !FREE_TEXT_ROUTE.test(pathname);
}
