# Security policy

## Supported versions

Security fixes go into the latest release. Stay on `latest` (or on the major version, e.g.
`PLINTHIO_TAG=1`) to receive them; the admin update banner tells you when one is out.

| Version | Supported |
| --- | --- |
| 1.x (latest) | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through
GitHub: the repository's **Security** tab → **Report a vulnerability**. Include the version
(Admin → Server Config, or `GET /api/health`), what an attacker needs (an account? which
role? network access only?), and steps to reproduce.

You'll get an acknowledgement within a week. Fixes ship as a patch release, and the release
notes credit the reporter unless you'd rather not be named.

## Scope

Plinthio is built for self-hosting on a trusted network: your home and the people you
invite. The security model, and what it does and doesn't protect against, is described in
the README's Security section and in [docs/accounts-and-access.md](docs/accounts-and-access.md).
