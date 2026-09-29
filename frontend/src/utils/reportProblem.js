// "Report a problem": opens a new GitHub issue on the bug-report form, with what the app
// already knows filled in (version, browser, the page it was on), so a report arrives with
// enough to act on. Nothing is sent anywhere until the person submits it on GitHub.
const ISSUE_URL = 'https://github.com/OddOmens/Plinthio/issues/new';

let versionPromise = null;
// The running server's version, fetched once per page load.
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
    // Only the kind of page (/series, /docs …): the host is the person's own server address,
    // and the rest of the path can hold titles from their library — neither belongs in a
    // public issue.
    what: `\n\n(Reported from the ${window.location.pathname.split('/')[1] || 'home'} page)`
  });
  return `${ISSUE_URL}?${params}`;
}
