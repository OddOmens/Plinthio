# Accounts and access

## Roles

Roles are enforced by the server on every request, not only hidden in the app.

| | Viewer | Editor | Admin |
| --- | :-: | :-: | :-: |
| Read, watch, listen; progress, bookmarks, ratings, lists, custom folders | ✓ | ✓ | ✓ |
| Request titles; join watch parties (and start one, when parties are on) | ✓ | ✓ | ✓ |
| Hide titles from their own shelves | ✓ | ✓ | ✓ |
| API keys and reading apps for themselves | ✓ | ✓ | ✓ |
| Edit metadata, upload covers, series settings (name, reading direction, age rating) | | ✓ | ✓ |
| Add series and titles to Kids Mode (the **Kids** button on title pages) | | ✓ | ✓ |
| Review the request queue | | ✓ | ✓ |
| Set intro/credits markers (API) | | ✓ | ✓ |
| The Admin panel: libraries, scans, health, users, logs, stats, activity, server settings, backups | | | ✓ |
| Hide a title from everyone (API) | | | ✓ |

The first account, made in the setup wizard, is an admin. Admins add everyone else in
**Admin → Users**. There's no self sign-up.

Usernames are 1–64 characters: letters and numbers from any language, spaces, and `. _ @ -`.
They must start with a letter or number. Passwords are at least 8 characters.

## Content limits (parental controls)

In **Admin → Users → Edit**, give an account a limit: **Everyone**, **Teen** or **Mature**.
A fourth rating, **Explicit**, is above them all. You can also choose whether the account
sees **unrated** titles.

- A title's rating is its own, if it has one, otherwise its series' rating (set in the
  series settings, or read from `ComicInfo.xml`'s `AgeRating`).
- The limit applies everywhere: shelves, search, Continue, lists, direct links, file and
  page URLs, watch parties, OPDS, Mihon and KOReader.
- **Admin → Health → Unrated** lists titles with no rating, which matters when accounts
  hide unrated titles.

## Kids Mode

A **Kids account** sees only what an admin or editor has made kids-safe. Everything else
disappears, as if it weren't on the server.

1. Make titles kids-safe, either:
   - a whole library: switch it on in **Admin → Kids Mode**, or
   - a series or single title: **Kids** on its page (editors and admins). A series is added
     whole, including volumes or episodes added later.

   **Admin → Kids Mode** also lists the series and titles added one by one, with
   a remove button.
2. Turn on **Kids account** in **Admin → Users** (tap the account) for the child's account.

Rules:

- Admin accounts can't be kids accounts, and you can't make your own account one.
- A content limit still applies on top, so a Teen-rated series added to Kids Mode is still
  hidden from a kids account limited to Everyone.
- Like content limits, it applies everywhere: shelves, search, direct links, files, watch
  parties (a kids account can't join, or be moved to, something outside it) and the reading
  apps.

## Hiding titles

- **Anyone** can hide a title from their own shelves: the ⋯ menu on its card → Hide.
  **Settings → Hidden** brings it back.
- **An admin** can hide a title from everyone. There's no button for this yet; use the API:
  `POST /api/items/<id>/hide` with `{"global": true}`, and undo it with
  `POST /api/items/<id>/unhide` with `{"global": true}`.

A hidden title is also refused when opened by direct link.

## Expiring accounts

For a guest, set an expiry when creating the account (1 day up to 1 year) or later with
**Extend**. An expired account can't sign in or use its API keys (P103) until an admin
extends it.

## Signing in and sessions

- A sign-in lasts 7 days (`JWT_EXPIRES_IN`) and is renewed each time the app opens, so
  regular use never signs you out, while a token on a lost device stops working within the
  week.
- **Changing your password**, or **Settings → Security → Sign out of all devices**, ends
  every other session immediately.
- Failed sign-in attempts are rate limited: 10 per 15 minutes per address (see
  `TRUST_PROXY` in [Configuration](configuration.md)). Successful ones don't count, so a
  household behind one address never locks itself out.
- Image, audio and video URLs carry a separate **media token**. It's valid for 24 hours,
  only opens media, and is never the sign-in token itself, so a copied media link can't be
  used to drive the account.
- **Admin → Activity** shows each person's sign-in history and what they've been reading and
  watching.

## Two-factor sign-in

Optional, for anyone. With it on, signing in asks for a 6-digit code from an authenticator
app as well as the password: Google Authenticator, Microsoft Authenticator, 1Password,
Bitwarden, Aegis, or any other app that does "TOTP".

- **Turning it on:** Settings → Security → Two-factor sign-in (it's also offered at the end
  of onboarding and the setup wizard). Scan the QR code, or copy the key into the app, then
  type the code it shows to confirm.
- **Backup codes:** ten one-time codes for a lost phone, shown once when you turn it on.
  Download or copy them somewhere safe. Each one signs you in instead of a code, once. Make
  new ones any time (Settings → Security → New backup codes).
- **Signing in:** username and password, then the code. Six digits typed (or filled in by
  the phone) and it goes. "Lost your phone?" switches to a backup code.
- **Turning it off**, or making new backup codes, needs your password and a current code
  (or a backup code). API keys can't change it.
- **Locked out?** An admin can reset it: Admin → Users → the account → Two-factor → Reset.
  That signs the account out everywhere; its owner then signs in with just the password and
  can set two-factor up again.
- A code works once, even within its 30 seconds, and a phone clock a little off still works.
  The secret is stored encrypted with a key derived from the server's JWT secret
  (`/config/jwt.secret`), so changing that secret means everyone sets two-factor up again.
- Admins can require it for sign-ins from outside the home network (Admin → Network, see
  below). It's never required at home.

## Away from home

Whether an account can be used outside the home network. See
[Using Plinthio away from home](remote-access.md) for the whole picture.

- **Admin → Network → Allow access from outside the home network** is the server-wide
  switch. Off, only home devices and Tailscale can sign in or use anything. New servers
  choose it in the setup wizard.
- **Admin → Users → Edit → Can use Plinthio away from home**, per account (on by default).
  Off, that account only works at home, including its sessions, its reading apps and its API
  keys. Admins can't switch it off for themselves while away.
- **Admin → Network → Require two-factor away from home**: accounts without two-factor can
  then only sign in at home, where they can set it up.
- Admin → Users shows who has two-factor, who's home-only, and where each person last signed
  in from (home, Tailscale or outside). Admin → Network lists recent sign-ins from outside.

## API keys

Made in **Settings → Apps & API keys**. A key acts as its owner, with their role and limits.

- Shown once, when made. The server stores only a SHA-256 hash, plus an MD5 used by
  KOReader, so a leaked database can't be turned back into working keys.
- Used as `X-API-Key: <key>`, or as the **password** with your username in HTTP Basic sign-in.
  Basic sign-in is how OPDS readers and Mihon connect, so no app ever holds your real
  password.
- Make one key per app. Deleting a key signs that app out, including Mihon's tracker
  session.
- Keys made before 1.0.0 have no MD5 and don't work for KOReader. Make a new one.

See [Reading apps](sync-apps.md) and [API](api.md).
