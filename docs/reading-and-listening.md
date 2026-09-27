# Reading and listening

Every title opens its page first: the series with its volumes or books, or the single
title's own page. You read or listen from there. **Start Reading** or **Continue Reading ·
Page 42** always picks up at the right place.

## The shelf

Each media type has four views, and every one shows one card per series (or per standalone
title), never loose volumes:

- **Alphabetical**
- **Creator:** labelled Author, Director or Studio to suit what you're browsing.
- **Disk Folders:** how the files sit on disk.
- **Custom Folders:** your own folders, independent of the disk. Anything not sorted yet is
  under "Unorganized".

Admins can turn off Disk Folders and Custom Folders for everyone (**Admin → Server Config →
Shelf Views**). Each person picks which of the allowed views they use under **Settings →
Preferences**.

Filters and sorting work across views: progress (unread, in progress, finished, skipped),
genre, date added, and sort by title, newest, recently opened or release date. Search covers
titles, authors, descriptions, genres, cast and publishers.

## Comics, manga and PDFs: the page reader

- **Direction:** right-to-left (manga), left-to-right (comics, PDFs, books) or **Scroll**
  (webtoon, continuous vertical). The direction is saved per series on the server, so a
  series always opens the right way. Manga libraries start right-to-left; everything else
  starts left-to-right.
- **Single or double-page spreads.** Double is the default on a tablet in landscape.
- **Page turn:** fade, or a page-flip animation.
- **Zoom:** pinch on touch screens.
- **Keys:** ← → turn pages (mirrored for right-to-left), ↓ or Space next, ↑ previous,
  Esc closes.
- **Next volume:** the last page offers the next volume, skipping any you've marked skipped.
- **Bookmarks and notes** on any page.

**PDFs** read here too, page by page. The server turns each page into an image the first
time it's read and keeps it, so later reads, other devices, Mihon and OPDS apps get it
instantly. This needs poppler, which the Docker image has (P308 without it, P309 for a
damaged or password-protected PDF).

## EPUBs: the book reader

- Paged or scrolling layout.
- Font family and size (12–28 px).
- Default, Sepia or Dark page theme.
- **Search inside the book** (Ctrl+F).
- Bookmarks and notes.
- Your place is saved precisely and follows you between devices.

When KOReader was the last to read a book, the reader opens at KOReader's percentage (see
[Reading apps](sync-apps.md)).

## Audiobooks

The player stays at the bottom of the screen while you browse. Tap it for the full
**Now Playing** view.

- **Chapters:** chapter list, previous and next chapter. Headphone and lock-screen skip
  buttons move by chapter when there are chapters, and by 30 seconds otherwise.
- **±15 s** buttons in the player.
- **Speed:** 0.75× to 2.5×, remembered per book and across devices.
- **Sleep timer:** 15, 30, 45 or 60 minutes, or the end of the chapter. It fades out over
  the last 10 seconds.
- **Lock screen and Control Center:** cover, title and controls on phones.

## Progress

- Everything saves as you go, per person, and follows you to other devices.
- **Mark as read** on any volume, book or episode.
- **Mark read up to here:** marking one finished when there are unfinished ones before it
  offers to mark those too, with one tap. Ignore it and it goes away. For shows, specials
  aren't included unless you're marking a special.
- **Mark a whole series** read or unread from its page.
- **Mark as not started** clears the position.

## Skipped volumes

For manga, say because you watched the anime: skip volumes one at a time, or with **Skip →
"I've covered everything through Vol N"**.

- Skipped volumes count towards series progress.
- Continue and the reader's next-volume jump step over them.
- They're left out of "Download remaining".
- Your read history isn't changed.
- Opening a skipped volume un-skips it.

The shelf's progress filter has a **Skipped** option, and **Unskip all** undoes the lot.

## Offline downloads

Download books, comics, manga, PDFs and audiobooks to read or listen with no connection:

- **Download** on a volume, or **Download Remaining** for everything unfinished in a series.
- The **Downloads** page opens with no connection at all, and lists what's stored and how
  much space it uses.
- Progress made offline syncs when you're back online.
- Downloads are per device and per browser. On iPhone, install the app to the home screen
  first. Safari may clear data for sites that aren't installed.
- Video isn't offered for download. Files are often several gigabytes, more than browsers
  reliably allow, and many need converting as they play.

## Bookmarks and notes

Bookmark any page, EPUB location or audiobook timestamp, with an optional note. **Bookmarks
& Notes** on the title page lists them and jumps straight to each.
