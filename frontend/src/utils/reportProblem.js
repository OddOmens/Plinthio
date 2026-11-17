// Prefilled GitHub bug-report link. Nothing is sent until the person submits it on GitHub.
const ISSUE_URL = 'https://github.com/OddOmens/Plinthio/issues/new';

let versionPromise = null;
// Fetched once per page load.
export function serverVersion() {
  versionPromise ||= fetch('/api/health')
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => data.version || '')
    .catch(() => '');
  return versionPromise;
}

function clientDescription() {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
  const screen = `${window.innerWidth}×${window.innerHeight}`;
  return `${ua}${standalone ? ' (installed app)' : ''}, ${screen}${window.isSecureContext ? '' : ', over http://'}`;
}

// A plain link (not window.open) so it also works from the installed iPhone app.
export function reportProblemUrl(version = '') {
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    version,
    client: clientDescription(),
    // Only the first path segment: the host and the rest of the path are private.
    what: `\n\n(Reported from the ${window.location.pathname.split('/')[1] || 'home'} page)`
  });
  return `${ISSUE_URL}?${params}`;
}
