# Releasing Plinthio

Releases are driven by git tags. Pushing `vX.Y.Z` builds and publishes the Docker image
(`ghcr.io/oddomens/plinthio`) for x86-64 and ARM, creates the GitHub Release, and — through
the update check — puts the "new version available" banner in front of every admin.

## Day to day

- Work on a branch, open a pull request into `main`. CI runs the backend tests, the
  frontend build and a Docker build on every PR.
- As part of each PR, add a line to **`## [Unreleased]`** in `CHANGELOG.md` under
  *Added*, *Changed* or *Fixed*, written for users rather than developers.
- Merge with **Squash and merge** so `main` reads as one commit per change.
- `main` should always be releasable. Nothing reaches users until you tag.

## Picking the version

| Change since the last release | Bump | Example |
| --- | --- | --- |
| Only bug fixes | patch | 1.2.0 → 1.2.1 |
| New features, nothing users must do | minor | 1.2.1 → 1.3.0 |
| Users must change something (config, volumes, removed feature, an irreversible migration) | major | 1.3.0 → 2.0.0 |

For something you'd like tested first, use a pre-release: `1.3.0-beta.1`. It gets only its
exact image tag — `latest`, `1` and `1.3` don't move — and is marked pre-release on GitHub,
so the update banner ignores it.

## Cutting a release

```bash
git checkout main && git pull
npm run release:version -- 1.3.0   # updates all package.json/lockfiles + dates the changelog
git diff                            # check CHANGELOG.md reads well — it becomes the release notes
git commit -am "Release v1.3.0"
git tag v1.3.0
git push origin main v1.3.0
```

Watch the **Release** workflow in the Actions tab (about 15 minutes, mostly the ARM build).
It refuses to publish if the tag and `package.json` disagree or the changelog has no
section for the version.

## One-time setup

- After the very first release, open the package at
  `github.com/orgs/OddOmens/packages/container/plinthio/settings` and set its visibility to
  **Public** — new GHCR packages start private, and users can't pull a private image.
- Branch protection on `main` (Settings → Branches): require the CI checks to pass and
  require a pull request.

## If a release is bad

Ship a fix as the next patch (1.3.1) — don't delete or move a published tag; people may
already be running it. If you need to stop the banner pointing at it meanwhile, mark the
GitHub Release as a pre-release: the update check skips pre-releases.
