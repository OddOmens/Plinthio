# Libraries

A library is a folder plus a type. The type decides which files are picked up and how
they're shown. You can have as many libraries as you like, including several of the same
type. Add them in **Admin → Libraries** (admins only). Plinthio only reads your folders. It
never renames, moves or writes into them.

## Types and formats

| Library type | Picks up | Shown as |
| --- | --- | --- |
| Audiobooks | `.m4b` `.mp3` `.m4a` `.flac` `.aac` `.ogg` | Audiobooks, played in the app's audio player |
| Manga | `.cbz` `.zip` `.cbr` `.rar` `.cb7` `.7z` | Manga, read right-to-left by default |
| Books | `.epub` `.pdf`, plus audiobook and comic files | Books. EPUBs open in the book reader; PDFs and comic archives open in the page reader, left-to-right |
| Movies | `.mp4` `.mkv` `.webm` `.avi` `.mov` | Movies, grouped into collections where TMDB has one |
| Shows | the same video formats | TV shows, by season and episode |
| Anime | the same video formats | Anime, laid out like shows |

Comic archives are identified by their contents, not their extension. A `.cbr` that's
really a zip, which is very common, opens fine. Pages inside archives are sorted naturally
(`2.jpg` before `10.jpg`) and `__MACOSX` junk is ignored.

## Laying out folders

Plinthio follows the common media-server naming conventions, so a library already laid out
for another server usually needs no changes. None of them are strictly required, but
following them gets the grouping right first time.

### Manga and comics

```text
Manga/
  One Piece/
    One Piece v01.cbz
    One Piece v02.cbz
  Standalone One-Shot.cbz
```

- **Series:** the folder, when it holds more than one archive or the file has a number.
  A `<Series>` in `ComicInfo.xml` always wins.
- **Volume number:** from the file name (`v01`, `Vol 1`, `Volume 1.5`, `ch 12`, `#3`), else
  ComicInfo's `<Number>`.
- **From `ComicInfo.xml`:** `<Title>`, `<Writer>`, and `<Manga>` (`YesAndRightToLeft` sets
  right-to-left, anything else left-to-right). `<AgeRating>` seeds the series' age rating.
- **Cover:** the first page.

### Books and PDFs

- **EPUB:** title, author and cover come from the book's own metadata.
- **PDF:** the page count, and the author when the PDF names one. The cover is a
  `cover.jpg`/`folder.jpg` next to it, else its first page. Pages are rendered on the server
  when first read and then cached.

### Audiobooks

One file per book works best (`.m4b` with chapters). Title, author and series come from the
file's tags: album becomes the series when it differs from the title. Embedded artwork, or a
`cover`/`folder`/`poster`/`front` image in the folder, becomes the cover.

### Movies

```text
Movies/
  Blade Runner (1982)/
    Blade Runner (1982).mkv
    Featurettes/
      Designing the Future.mkv
    Blade Runner-trailer.mp4
  Arrival (2016).mp4
```

- **Title and year:** from the file name, with scene junk (`1080p`, `x264`, release groups)
  stripped.
- **Collections:** with a TMDB key, films are grouped into their TMDB collection (Shrek,
  Star Wars…) once the library has **two or more** of it. The Movies shelf has a
  **Collections / All movies** switch.
- **Extras:** see below.
- **Poster:** a `poster.jpg`/`cover.jpg`/`folder.jpg` in the film's folder, else TMDB (with
  a key), else a frame from about 20% into the film.

### Shows and anime

```text
Shows/
  Severance/
    Season 01/
      Severance - S01E01 - Good News About Hell.mkv
    Season 02/
      Severance - S02E01.mkv
    Specials/
      Severance - S00E01.mkv
```

- **Episode numbers:** `S01E02`, `1x02`, `Ep 02` or `Episode 2` in the file name.
  Specials are season 0 and listed last.
- **Series:** the show name in the file name, else the folder.
- A show split into season folders appears once, under the show.
- Episode stills are grabbed from the video (about 30% in) the first time the list shows
  them, two at a time at most, then cached.

### Extras

Trailers, featurettes and the like are kept off the shelf, out of search and out of
Continue. They're listed in an **Extras** row on their film's or show's page. A video counts
as an extra when it is:

- in a folder named `Extras`, `Featurettes`, `Behind The Scenes`, `Making Of`,
  `Deleted Scenes`, `Interviews`, `Scenes`, `Shorts`, `Trailers`, `Bonus Features`,
  `Special Features` or `Other`, or
- named with a suffix: `-trailer`, `-featurette`, `-behindthescenes`, `-deleted`,
  `-interview`, `-scene`, `-short`, `-other` or `-extra`, or
- (movies only) in a subfolder of a film's own folder, or a loose file next to the film that
  is less than 40% of its size.

A folder holding several full-length films isn't collapsed. They stay films.

## Scanning

- **When:** on adding a library; on **Scan**; every 60 minutes by default; and about
  30 seconds after the file watcher sees a change. Admins set the schedule in **Admin →
  Libraries → Automatic scanning**. The periodic scan is the dependable one for network
  shares, which often send no change events.
- **Unchanged files** (same path and size) are skipped, so rescans are quick.
- **Moved files:** a file with the same name and size that turns up in another folder is the
  same title, so progress, ratings, bookmarks and list entries follow it. A renamed file
  counts as a new title, and the old name goes missing (see below).
- **Artwork pass:** every scan retries titles that still have no cover, so adding a TMDB key
  later fills in posters without a rescan from scratch.
- **Safety:** if a library's folder is missing (P200), or is suddenly empty while the catalog
  has titles in it (P201, usually an unmounted drive), the scan stops rather than treating
  everything as gone.

## Missing files

When a file disappears, its title is **kept but hidden from everyone**. Its progress,
ratings, bookmarks and list entries stay. This covers a drive that didn't mount, a share
that dropped, or a folder mid-reorganisation. If the file comes back, the title reappears on
the next scan with everything intact.

**Admin → Health → Missing files** lists them by film, book, series or season. For each,
choose:

- **Keep as history** if you deleted the files on purpose, to free space. The title becomes
  *offloaded* (see below).
- **Remove for good** once you're sure it's not coming back. This deletes it from the
  catalog along with its covers and thumbnails. Anything whose file has come back is kept.
  Reading progress and ratings are keyed to the title's id, so if exactly the same file is
  scanned again later they re-attach.

## Offloaded titles

When space runs short, you can remove files and keep the history: say you've watched five
seasons of a show and only want to keep the sixth on disk. Offloaded titles are:

- **Hidden** from shelves, search, Continue Watching and the reading apps, like missing ones.
- **Shown on their title page**, greyed, with everyone's progress, ratings and watched
  marks. Their artwork keeps its colour, dimmed, with an **Offloaded** badge. Titles the
  server never had (a film missing from a collection, a list entry) go grey with a dashed
  outline and a **Not in library** badge instead, so the two are easy to tell apart.
- **Not playable.** Opening one says it was offloaded. "Up next" skips them.
- **Restored by themselves** if the files come back. A re-download under a different
  file name counts too: a new file for the same show, season and episode (or a film with the
  same title) takes over the offloaded entry, so its history comes back with it.

Two ways to offload, both for admins:

1. **Delete the files first**, then in **Admin → Health → Missing files** choose **Keep as
   history** (or **Keep all as history**).
2. **Offload first**, from the title page's **Keep as History** action (the film, the season
   on screen, or a whole series), then delete the files. Until you do, Admin → Health lists
   them as still on disk.

**Admin → Health → Offloaded** lists everything kept as history, with **Undo** (it's back on
the shelves if the files are still there, or missing again if not) and **Remove for good**.
"Remove all" for missing files never removes offloaded titles.

## Metadata and artwork

Editors and admins can fix titles from the title page (**Edit Metadata**) or in bulk
(**Admin → Metadata**).

| Media | Providers |
| --- | --- |
| Manga | MangaDex |
| Books, audiobooks | Google Books, Open Library |
| Movies, shows, anime | TMDB (needs a key) |

- **Auto Match** on a row matches that title and shows the result inline. You can click
  down a list without a pop-up in the way.
- **Batch match** works through the selected titles in the browser, one at a time, with a
  running summary.
- **Clean titles** strips scene junk from file-name titles.
- **Cover upload:** any image, for one title or a whole series.
- **Cast, crew, studios, tagline and TMDB facts** for movies and shows are fetched the first
  time a title page opens (with a key), and cached for 30 days.
- **Series settings** (title page, editors): display name, reading direction and age rating
  for a whole series.

Without a TMDB key, video still gets titles from file names and covers from folders or
frames. Metadata searches that need the key fail with P400.

## Library Health

**Admin → Health** checks the catalog and lists what needs attention:

- unreachable libraries (folder missing or unreadable)
- missing files (see above)
- likely duplicates (the same title twice)
- clashing volume numbers in a series
- titles with no cover, no description or no author
- titles with no age rating (relevant when content limits are in use)
- recent video conversion failures

Each list links to the titles, with a rescan or fix action where one applies.
