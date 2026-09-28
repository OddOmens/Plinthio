# Movies and shows

## Title pages

- **Movies** get a single page: poster, year · runtime · rating, tagline, overview, genres,
  director, writers and studios, a **Cast & Crew** row, Media Info (resolution, codecs,
  audio and subtitle tracks, size), and an **Extras** row when it has any.
- **Shows and anime** list their episodes **by season**, each with a still from the episode
  and its synopsis. You can mark a season watched. Specials come last, and **Start
  Watching** begins at S1 E1, not a special. The season you're up to opens first.
- **Collections** (Shrek, Star Wars…) list their films in release order. With **Movie
  Collections** on, films the server doesn't have are shown greyed out with a **Request**
  button, or "Coming 2027" for one not yet out. A film in a collection opens its own page,
  with a "More in …" row and a link back to the collection.

Cast, crew, studios, tagline and facts come from TMDB (needs a key), fetched when a page
first opens and cached for 30 days.

## How playback works

Plinthio always tries the cheapest way first. It asks the browser what it can decode,
including HEVC/H.265, which Chrome, Edge and Safari can play.

| Mode | When | Server cost |
| --- | --- | --- |
| **Direct play** | The browser can play the file as it is (for example H.264/HEVC + AAC in MP4, or WebM) | None: the file is streamed with byte ranges |
| **Direct stream (remux)** | The video is fine but the container (MKV) or audio (AC3, EAC3, DTS, TrueHD) isn't | Tiny. The video is copied untouched, the audio is converted to AAC, and it's delivered as HLS |
| **Transcode** | The video itself can't be decoded (10-bit H.264, say) | Real work. The GPU does it when one is available |

- **Seeking** works normally in every mode, because remuxes and transcodes are segmented HLS
  rather than one long stream.
- **Transcode quality:** a ladder of 1080p, 720p and 480p, never taller than the source.
  The player adapts to bandwidth, or you can pin a quality in the settings menu (⚙).
- **Limits:** one software transcode at a time, or two with hardware encoding, so a small
  server isn't overwhelmed.
- **Caching:** converted segments are kept on disk and reused until unused for
  `HLS_CACHE_MAX_AGE_HOURS` (24 h). Closing the player stops its conversion.
- **Fallback:** if the browser rejects a file it was expected to play, the player switches
  to transcoding by itself.
- **Errors:** a failed playback shows the real reason with a code (P3xx), not a generic
  failure. See [Error codes](error-codes.md) and [Troubleshooting](troubleshooting.md).

## Audio tracks and subtitles

- **Audio:** every track is listed by language, title and channel count, and can be switched
  mid-film, keeping your position. Useful for dual-audio anime and commentary tracks.
- **Subtitles from inside the file:** text subtitles are extracted on demand and converted
  to WebVTT. Picture-based ones (PGS, VobSub from discs) can't be shown, so they aren't
  listed.
- **Subtitles from files next to the video:** `Movie.en.srt`, `Movie.en.forced.srt`,
  `.vtt`, `.ass` and `.ssa`. Language and "forced" are read from the name, and a new file is
  picked up without a rescan.
- A **forced** track, used for foreign-language signs, is turned on automatically.

## The player

- **Resume:** it continues where you stopped, unless you'd reached the last 2%. **Start
  over** in the toast restarts. A title counts as watched at 98%.
- **Skip buttons:** back and forward, by amounts each person picks: 5 s, 10 s, 15 s, 30 s,
  1 min or 5 min. The defaults are back 10 s and forward 30 s. To change them, open the
  player's settings menu (⚙), or right-click a skip button. They follow you to every device.
  - On a computer they sit in the control bar.
  - On phones and tablets they're large buttons either side of the play button.
- **Keys:** Space plays/pauses, ← → use your skip amounts, Esc closes.
- **Scrub previews:** on a computer, hovering the timeline shows thumbnails. They're
  generated in the background the first time a video is opened, so the first viewing may not
  have them.
- **Up next:** at the end of an episode the next one starts after a 10-second countdown,
  which you can cancel.
- **Casting:** Chromecast (Chrome, including Google TV) and AirPlay (Safari) buttons appear
  when a device is available. Chromecast needs Plinthio opened over HTTPS.
- On phones the browser's own controls are used, because they handle full screen,
  picture-in-picture and AirPlay best.

## Pause screens

What appears after a couple of seconds paused is chosen by an admin in **Admin → Server
Config → Pause Screen**. Moving the mouse, touching the screen or pressing a key hides it,
and it never blocks the controls. It is sized to the player, so on a TV the poster and text
fill the screen. **Hover** each style in that card to see it in the live preview.

| Style | Shows |
| --- | --- |
| **Simple** | Nothing: just the player controls |
| **Details** (default) | Poster, title (or show, episode code and name), year · runtime · rating · genres, tagline, synopsis, director or creators, the first four cast members, and time left with the time it will end |
| **Cinematic** | The picture blurs and dims behind a centred title card: tagline, cast photos with their characters, and facts TMDB keeps (director, original title and language, budget, box office and how many times its budget it made, seasons and episodes, years on air, collection, studio or network, composer, cinematographer), plus keywords |
| **Bedtime** | A dim, large clock, time left and the time it ends. For an episode, when the rest of the season would end if you kept going |

TMDB has no trivia as such; the facts above are what it does keep. Without a TMDB key the
screens use the file's own details: title, year, runtime, genres, description.

## Opening sequence

A short clip plays full-screen when someone presses Play on a movie or episode, before the
title starts. Plinthio comes with its own, switched on. An admin can replace it with their
own clip (a logo sting, say), limit it to movies or to shows and anime, or switch it off:
**Admin → Server Config → Opening Sequence**.

- The title loads behind the clip, so it starts as soon as the clip ends.
- Your own clip must be an **MP4 with H.264 video**, **1–10 seconds** long and **under 20 MB**. The
  server checks it when uploaded. 1080p at around 8 Mbps is plenty.
- It never plays before an autoplayed next episode, a trailer or other extra, or in a watch
  party.
- Anyone can skip it (the Skip button, Esc, Enter or a tap). If it can't play, the title
  starts straight away.
- Your own clip is kept in the data folder (`/config/intro/intro.mp4`), so it survives
  updates. Removing it goes back to the built-in one.

## Skip intro and credits

While playback is inside an intro or credits range, viewers get a **Skip Intro** or **Skip
Credits** button. Ranges are set per episode by editors and admins. There's no screen for it
yet, so it's done through the API:

```bash
curl -X PUT -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"markers":[{"type":"intro","startSeconds":62,"endSeconds":152},{"type":"credits","startSeconds":2580,"endSeconds":2640}]}' \
  http://plinthio:8088/api/media/video/<itemId>/markers
```

The request replaces all of that episode's markers. Types are `intro` and `credits`.

## Watch parties

Watch a movie or show with people in other places, in sync. See [Together](together.md).
