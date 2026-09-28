# Contributing

Suggestions and fixes are welcome.

1. **Fork** the repository and make your change on a branch in your fork.
2. Run the checks locally: `npm test` in `backend/`, and `npm run build` in `frontend/`.
3. Open a **pull request** against `main`, saying what it changes and why. Add a line to
   `CHANGELOG.md` under **Unreleased** for anything a user would notice.

How it's reviewed:

- Only the maintainer can merge. Every pull request needs their approval, and the CI
  checks (backend tests, frontend build, Docker image) must pass.
- CI doesn't run on a contributor's pull request until the maintainer approves the run.
- Pushing new commits after an approval needs a fresh approval.

For a bug or an idea you'd rather not code yourself, open an issue. For a **security
problem**, don't open an issue or pull request; see [SECURITY.md](SECURITY.md).
