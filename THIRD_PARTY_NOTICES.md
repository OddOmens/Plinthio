# Third-party notices

Plinthio itself is licensed under the [GNU Affero General Public License v3.0](LICENSE).
This file lists third-party material that is shipped inside Plinthio as files in their own
right, with the licence each one comes under. The npm packages Plinthio is built from keep
their own licences; see `backend/package.json` and `frontend/package.json`.

## Fonts

Two fonts are bundled with the web app and offered in Settings → Appearance → Font. Both
are under the SIL Open Font License, Version 1.1. They are shipped unmodified, under their
own names, and are not sold on their own. The full licence text for each is shipped with
the app and served at the path shown.

| Font | Copyright | Licence text |
| --- | --- | --- |
| Atkinson Hyperlegible Next | Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) | [`/licenses/AtkinsonHyperlegibleNext-OFL.txt`](frontend/public/licenses/AtkinsonHyperlegibleNext-OFL.txt) |
| OpenDyslexic | Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es), with Reserved Font Name OpenDyslexic. Copyright (c) 12/2012 - 2019 | [`/licenses/OpenDyslexic-OFL.txt`](frontend/public/licenses/OpenDyslexic-OFL.txt) |

The font files come from the [Fontsource](https://fontsource.org) packages
`@fontsource-variable/atkinson-hyperlegible-next` and `@fontsource/opendyslexic`.

## Other software Plinthio can connect to

Plinthio can talk to other self-hosted software over that software's own public API (for
example, sending an accepted request to a Seerr server). No code from those projects is
included in Plinthio. Their names are used only to say what Plinthio works with. Plinthio is
not affiliated with or endorsed by any of them, and their names and marks belong to their
owners.
