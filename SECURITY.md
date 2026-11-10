# Security policy

## Supported versions

Security fixes go into the latest release. Stay on `latest` (or on the major version, e.g.
`PLINTHIO_TAG=1`) to receive them; the admin update banner tells you when one is out.

| Version | Supported |
| --- | --- |
| 1.x (latest) | ✅ |
| older | ❌ |

## Checking an image is genuine

Release images are built by this repository's Release workflow and signed with a record of
the commit and workflow run that produced them. With the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify oci://ghcr.io/oddomens/plinthio:latest --owner OddOmens
```

It passes only for an image built here, unchanged since. Images published before
attestations were added (1.9.0 and earlier) have none.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through
GitHub: the repository's **Security** tab → **Report a vulnerability**. Include the version
(Admin → Overview, or `GET /api/health`), what an attacker needs (an account? which
role? network access only?), and steps to reproduce.

You'll get an acknowledgement within a week. Fixes ship as a patch release, and the release
notes credit the reporter unless you'd rather not be named.

## Scope

Plinthio is built for self-hosting on a trusted network: your home and the people you
invite. The security model, and what it does and doesn't protect against, is described in
the README's Security section and in [docs/accounts-and-access.md](docs/accounts-and-access.md).
