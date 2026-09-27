# Plinthio error codes

<!-- Generated from backend/src/errors.js by `npm run docs:errors`. Do not edit by hand. -->

Every error from the Plinthio API carries a code, and the web app shows it next to the message, e.g. "The media file is missing from disk (P301)". API responses look like this:

```json
{ "error": "The media file is missing from disk", "code": "P301" }
```

Admins also get a `detail` field with the underlying cause (the ffmpeg error, the filesystem error, and so on). The same list is in the app under **Docs → Error codes**, and served as JSON at `GET /api/errors`.

Codes marked *app* are raised by the web app itself rather than returned by the server.

## General

### P000: Unexpected server error

*HTTP 500.* The server hit an error it has no specific code for.

**What to do:** Check Admin → Logs (or `docker logs plinthio`) for the full error. Admins also see the cause in the error message itself.

### P001: Invalid request

*HTTP 400.* A required field was missing or a value was out of range.

**What to do:** The message says which field. If the web app sent it, reload the page. An old cached version can send outdated requests.

### P002: Not found

*HTTP 404.* The thing asked for does not exist, or is hidden from this account.

**What to do:** It may have been deleted or moved by a rescan. Refresh the page.

### P003: Not allowed

*HTTP 403.* The account is signed in but not permitted to perform this action.

**What to do:** Ask an admin to change your role or access if you need this.

### P004: Conflict

*HTTP 409.* The action clashes with existing data, such as a duplicate name.

**What to do:** The message says what clashed. Rename or remove the existing item first.

### P005: Too many requests

*HTTP 429.* A rate limit was hit.

**What to do:** Wait a minute and try again. If many people share one IP behind a reverse proxy, set TRUST_PROXY=1 so they are limited separately.

### P006: Temporarily unavailable

*HTTP 503.* The server could not handle the request right now.

**What to do:** Try again in a few seconds.

### P007: Upload rejected

*HTTP 400.* An uploaded file was too large or of the wrong type.

**What to do:** Images must be under 15 MB. Backups must be Plinthio backup files.

## Sign-in & permissions

### P100: Sign-in required

*HTTP 401.* The request carried no session, media token or API key.

**What to do:** Sign in again. For scripts, send an X-API-Key header.

### P101: Session expired

*HTTP 401.* The session token is expired, malformed, or was revoked by a password change or "sign out everywhere".

**What to do:** Sign in again.

### P102: Token used in the wrong place

*HTTP 401.* A media token was sent as an Authorization header, or used outside /api/media. Or a session token was put in a URL. Media tokens only work as ?token= on media URLs, and session tokens only work in the Authorization header.

**What to do:** This is a bug in the client that made the request. In the web app, reload the page. If it persists, report it with this code.

### P103: Account expired

*HTTP 403.* The account has an expiry date that has passed.

**What to do:** An admin can extend or clear the expiry in Admin → Users.

### P104: Invalid API key

*HTTP 401.* The X-API-Key (or HTTP Basic password) does not match any key.

**What to do:** Create a new key in Settings → API Keys. Keys are shown only once, when created.

### P105: Admin only

*HTTP 403.* This action needs the admin role.

**What to do:** Ask an admin to do it, or to promote your account.

### P106: Editor or admin only

*HTTP 403.* This action needs the editor or admin role.

**What to do:** Ask an admin to make your account an editor.

### P107: Wrong username or password

*HTTP 401.* The sign-in details did not match an account.

**What to do:** Check the username and password. An admin can reset a password in Admin → Users.

### P108: Too many sign-in attempts

*HTTP 429.* Sign-in is rate limited to slow down password guessing.

**What to do:** Wait 15 minutes and try again.

## Libraries & scanning

### P200: Library folder not found

*HTTP 400.* The folder a library points at does not exist inside the server (or container).

**What to do:** In Docker, your media is mounted at /media, so library paths look like /media/Movies. Check MEDIA_DIR in docker/.env points at the right host folder.

### P201: Library folder unreadable (I/O error)

*HTTP 500.* Reading the folder failed with EIO. Almost always the drive behind it disconnected or was remounted, leaving a stale mount. A remounted USB drive can come back under a new path such as /media/you/Drive1.

**What to do:** Check the drive is connected and mounted (`mount | grep media`). Point MEDIA_DIR at its current mount path and recreate the container. Mounting the drive by UUID in /etc/fstab keeps the path stable.

### P202: Library folder permission denied

*HTTP 403.* The folder exists but the Plinthio process cannot read it (EACCES).

**What to do:** Give the container user read access to the media folder, e.g. with `chmod -R o+rX` on the host folder or matching PUID/PGID.

### P203: Not a folder

*HTTP 400.* The library path points at a file rather than a directory.

**What to do:** Choose the folder that contains your media.

## Playback

### P300: Media not found

*HTTP 404.* No item with that id exists, or it is hidden from this account by an admin or parental controls.

**What to do:** Refresh the library. A rescan may have replaced the item.

### P301: Media file missing

*HTTP 404.* The item is in the library but its file is gone. It was moved, renamed or deleted, or the drive is not mounted.

**What to do:** Check the drive is mounted, then rescan the library.

### P302: Media file unreadable

*HTTP 500.* Reading the file failed. Usually a disconnected drive (EIO), a permissions problem, or a corrupt file.

**What to do:** See P201/P202 for drive and permission problems. Check Admin → Logs for the underlying error.

### P303: ffmpeg not available

*HTTP 500.* ffmpeg or ffprobe is missing or failed to launch, so videos that need converting cannot play.

**What to do:** The Docker image includes ffmpeg. On a bare-metal install, install ffmpeg and make sure it is on PATH. Check Admin → Logs.

### P304: Conversion failed

*HTTP 500.* ffmpeg started but exited with an error while converting the video. Usually a corrupt file, an unsupported codec, or a hardware transcoding problem.

**What to do:** Admin → Logs shows the ffmpeg error. If it mentions VAAPI/QSV/NVENC, turn hardware transcoding off in Admin → Server Settings and try again.

### P305: Still preparing

*HTTP 503.* The conversion is running but has not produced the requested part yet.

**What to do:** The player retries this on its own. If it never finishes, the server may be too slow for real-time transcoding at this quality. Pick a lower quality.

### P306: Invalid stream request

*HTTP 400.* The stream URL named an unknown quality, audio track, segment or preview sheet.

**What to do:** Reload the player. This usually means a stale URL after the video was rescanned.

### P307: Subtitle track not found

*HTTP 404.* The requested subtitle track does not exist or could not be extracted.

**What to do:** Pick another track. Image-based subtitles (PGS/VobSub) cannot be shown as text.

### P350: Browser cannot play this format

*app.* The browser rejected the stream even after the server converted it.

**What to do:** Try another browser (Chrome, Edge or Safari). If this happens on every browser, the file itself may be damaged.

### P351: Connection lost during playback

*app.* The player could not reach the server to load the next part of the video.

**What to do:** Check your network connection, then press Retry.

### P352: Media link could not be renewed

*app.* Media URLs carry a short-lived token. It expired and the app could not get a new one.

**What to do:** Reload the page. If that does not help, sign out and back in.

## Metadata providers

### P400: TMDB key not configured

*HTTP 409.* Movie, show and anime metadata comes from TMDB, which needs a free API key.

**What to do:** Create a key at themoviedb.org → Settings → API and paste it into Admin → Server Settings.

### P401: Provider rejected the API key

*HTTP 502.* The server reached the provider, but the provider refused the key.

**What to do:** For TMDB, paste either the "API Key" or the "API Read Access Token" from your TMDB account into Server Settings.

### P402: Provider rate limit

*HTTP 502.* The provider is refusing requests because too many were sent.

**What to do:** Wait a minute. Batch matching large libraries can trigger this.

### P403: Provider unreachable

*HTTP 502.* The request to the provider timed out or failed at the network level.

**What to do:** Check the server (container) has outbound internet access and DNS.

## Lists & requests

### P500: List not found

*HTTP 404.* The list or folder does not exist or belongs to someone else.

**What to do:** Refresh the Lists page.

### P501: Wrong kind of title for this list

*HTTP 400.* Each list holds one category: Movies, Shows, Anime, Read or Listen.

**What to do:** Add it to a list in the matching category.

### P502: Already in list

*HTTP 409.* The title was added to this list before.

**What to do:** Nothing to do.

### P503: Already requested

*HTTP 409.* Someone has an open request for this title.

**What to do:** Its status is shown on the Requests page.

### P504: Already in the library

*HTTP 409.* A request for this title was accepted and marked as added.

**What to do:** Search the library for it.

### P505: Request can no longer be withdrawn

*HTTP 403.* An admin or editor has already acted on this request.

**What to do:** Ask an admin or editor if you want it removed.

### P506: Request not found

*HTTP 404.* The request was deleted or never existed.

**What to do:** Refresh the Requests page.
