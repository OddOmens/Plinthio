# Troubleshooting

Most errors in Plinthio carry a code like **P301**, shown after the message. Look it up in
[Error codes](error-codes.md), in the app under **Docs → Error Codes**, or at
`GET /api/errors`. Admins also get the underlying cause in the error, and in **Admin → Logs**.

This page starts from what you see instead.

## First checks

1. **Admin → Health.** It catches unreachable libraries, missing files and conversion
   failures.
2. **Admin → Logs**, filtered to errors.
3. The container's own output: `docker logs plinthio --tail 200`.
4. `curl http://<server>:8088/api/health` should return `{"status":"healthy",…}` with the
   version. Docker also reports the container as unhealthy if it stops answering.

## Libraries and scanning

| Symptom | Cause and fix |
| --- | --- |
| A library shows nothing after adding it | Scanning takes a while on a big library, so watch Admin → Logs. Check the folder is visible inside the container. The path is under `/media`, not your host path. Check the library type matches the files: a Movies library ignores `.cbz` |
| P200 "Library folder not found" | The folder doesn't exist inside the container. Check the volume mount in `docker-compose.yml` |
| P201 on scan, "folder is empty but the catalog has N items" | The drive or share isn't mounted, so the mount point is an empty folder. Plinthio refuses to treat that as "everything was deleted". Mount it and scan again |
| P202 "permission denied" | The container user (`PUID`/`PGID`, default 1000) can't read the folder. Fix ownership or permissions on the host, or set `PUID`/`PGID` |
| New files don't appear | The watcher can miss events on network shares. The periodic scan (every 60 min by default) picks them up, or press Scan. Check automatic scanning is on (Admin → Libraries) |
| A title vanished | Its file is missing: renamed, moved to another library, or its drive dropped. It's in Admin → Health → Missing files. Put the file back and it returns with progress intact |
| Series split in two, or volumes in the wrong series | File names or `ComicInfo.xml` disagree. Admin → Health → Clashing volume numbers helps. Fix the names, or set the series in Edit Metadata |
| Episodes in the wrong order, or specials mixed in | Use `S01E02`-style names. Specials are season 0 (`S00E01`) |
| Trailers on the Movies shelf | Put them in a `Trailers/` folder or name them `-trailer`. See [Libraries → Extras](libraries.md#extras) |
| Movies not grouped into a collection | Collections need a TMDB key, and at least two films of the collection in the library. Grouping happens when a film's page is first opened or after a scan |

## Covers and metadata

| Symptom | Cause and fix |
| --- | --- |
| Blank covers | Add a `cover.jpg`/`folder.jpg`/`poster.jpg` next to the files, or match metadata. Every scan retries titles with no cover |
| A cover won't update | Hard-refresh. Covers are versioned, but an installed app may hold the old one until it reloads |
| P400 on metadata search | Add a TMDB key in Admin → Metadata |
| P401 | The provider refused the key. For TMDB, paste either the "API Key" or the "API Read Access Token" |
| P402, P403 | Rate-limited or unreachable. Wait and retry, and check the server has internet access |
| No cast, crew or facts on title pages | Needs a TMDB key. They're fetched when a page first opens and cached for 30 days |

## Video

| Symptom | Cause and fix |
| --- | --- |
| "Starting playback…" forever | Check Admin → Logs for ffmpeg errors. On a slow CPU, a transcode may not keep up. Pick a lower quality, or enable hardware transcoding |
| P303 | ffmpeg is missing (bare-metal install). Install ffmpeg |
| P304 "Conversion failed" | ffmpeg failed on this file. The log has its error. If it mentions VAAPI, QSV or NVENC, set Video Transcoding to software and test again |
| P350 "This browser cannot play this video" | Even the converted stream was rejected. Try Chrome, Edge or Safari. If every browser fails, the file may be damaged |
| P351 | The connection to the server dropped. Press Retry |
| P352 | The media link expired and couldn't be renewed. Reload the page, or sign out and in |
| Hardware transcoding not detected | Pass `/dev/dri` through, with the right render group GID, or use the NVIDIA toolkit for NVENC. Use **Test** in Admin → Playback. See [Setup → Hardware transcoding](setup.md#hardware-transcoding) |
| No subtitle track listed | Picture-based subtitles (PGS, VobSub) can't be shown. Add an `.srt` next to the file |
| No scrub previews | They're generated in the background on first play. They're only shown on computers |
| Casting button missing | Chromecast needs Chrome, Plinthio opened over HTTPS, and a Cast device on the same network. AirPlay needs Safari |

## Reading and listening

| Symptom | Cause and fix |
| --- | --- |
| P308 on a PDF | poppler isn't installed (bare-metal). Install `poppler-utils` |
| P309 on a PDF | The PDF is damaged or password-protected. Check it in another reader, and remove the password |
| PDF pages slow the first time | Each page is rendered once, then cached. Later reads are instant |
| An archive won't open | It may be corrupt, or an unusual RAR version. Repack it as CBZ |
| A manga opens left-to-right | Set the direction in the reader. It's saved for the series. `ComicInfo.xml` `<Manga>YesAndRightToLeft</Manga>` sets it on scan |
| Audiobook lock-screen controls missing | Install the app to the home screen (iOS), and start playback from a tap |
| A download disappeared (iPhone) | Safari may clear storage for sites that aren't installed. Install the app to the home screen |

## Accounts and access

| Symptom | Cause and fix |
| --- | --- |
| P107 | Wrong username or password. Admins can reset passwords in Admin → Users |
| P108 | Too many failed sign-in attempts (10 per 15 min per address). Wait. Behind a proxy without `TRUST_PROXY`, everyone shares one limit |
| Everyone is locked out after one person's typos | Set `TRUST_PROXY` behind a reverse proxy or tunnel (the add-ons do). See [Away from home](remote-access.md#already-have-a-reverse-proxy) |
| P109 "can only be used from its home network" | Outside access is off. Use it at home or over Tailscale, or turn it on in Admin → Network |
| P110 "for home use only" | The server allows outside access, but not for this account. Admin → Users → Edit → Can use Plinthio away from home |
| P111 "code is not right" | Use the current code from the app (they change every 30 seconds and work once). Check the phone's clock is set automatically. Or use a backup code |
| P112 "two-factor needed away from home" | Sign in at home once and turn on two-factor in Settings → Security |
| P113 "sign-in step expired" | More than five minutes, or five wrong codes. Enter your password again |
| Lost the phone with the authenticator app | Sign in with a backup code. None left? An admin can reset two-factor in Admin → Users → Edit |
| Admin → Network says "home" from a phone on mobile data | Plinthio can't see real addresses: Docker Desktop never can, and your own proxy needs `TRUST_PROXY`. See [Away from home](remote-access.md#troubleshooting) |
| P103 | The account has expired. An admin can extend it |
| A user can't see a title others can | Their content limit, unrated setting, Kids Mode, or they hid it themselves (Settings → Hidden) |
| A kids account sees nothing | Nothing is kids-safe yet. Turn on Kids for a library, or add series from their pages |
| Signed out on every device | A password change or "Sign out of all devices", or `jwt.secret` was deleted or changed |

## Reading apps

See [Reading apps → Troubleshooting](sync-apps.md#troubleshooting).

## Watch parties

| Symptom | Cause and fix |
| --- | --- |
| No Watch Together button | Watch parties are off: Admin → Features → Watch parties |
| P601 "Party not found" | The party ended, or the server restarted. Ask the host for a new link |
| P603, P604 | A member's content limit or Kids Mode blocks that title |
| P605 | 20 people is the limit |
| Friends outside can't join | They need to reach the server. See [Using Plinthio away from home](remote-access.md) |

## Updates and data

| Symptom | Cause and fix |
| --- | --- |
| No update banner | `UPDATE_CHECK=false`, the server can't reach GitHub, or you dismissed it for this version |
| Something broke after an update | Roll back: [Setup → Rolling back](setup.md#rolling-back) |
| The disk is filling up | `config/cache` (HLS segments, thumbnails, PDF pages) can be deleted safely at any time. Old backups in `config/backups` can go too |
