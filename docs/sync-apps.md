# Reading apps

Plinthio works with three kinds of outside reader. All of them sign in with your
**username** and a **Plinthio API key as the password**. Make keys in **Settings → API
Keys**, where the **Reading Apps** card shows the exact address for your server. Make one key
per app, so deleting a key signs out just that app.

Everything the web app hides from you — content limits, Kids Mode, hidden titles, missing
files — is hidden in these apps too.

The apps need to reach the server. At home that's its LAN address. Away from home, see
[Using Plinthio away from home](remote-access.md).

## Mihon (Android)

Mihon, and other Tachiyomi forks, read Plinthio through their **Komga** extension. Plinthio
answers the parts of Komga's API that the extension and Mihon's Komga tracker use.

### Set up

1. In Mihon: **Browse → Extensions**, install **Komga**. It's in the Keiyoushi repository,
   so add that first if you haven't.
2. Open the extension's settings (the cog next to it):
   - **Address:** your Plinthio address, e.g. `https://media.example.com` or
     `http://192.168.1.20:8088`. No `/api` on the end.
   - **Username:** your Plinthio username.
   - **Password:** an API key. Alternatively leave username and password empty and put the
     key in **API key**.
3. Restart Mihon if it asks, then browse the source.
4. To sync what you read: **Settings → Tracking → Komga**, turn it on. Open a series in your
   Mihon library → **Tracking → Komga** to link it; Mihon links Komga series automatically.

### What you get

- Your comic, manga and PDF series, with covers, descriptions, genres, tags, authors,
  status and reading direction.
- **Latest** is sorted by last change. Search, and filters for library, status, genre,
  tag, publisher, author and read status, all work.
- The extension's **Books** mode lists single volumes. Plinthio's **Lists** aren't offered as
  Komga read lists or collections; those filters are empty.
- Pages stream one by one. PDFs arrive as images rendered by the server.
- EPUBs aren't offered, because the Komga extension can't read them. Use KOReader or the web
  reader.

### What syncs

Mihon's tracker works in chapters. When you finish a chapter in Mihon, it tells Plinthio
"read up to N", and every volume numbered N or lower is marked read in Plinthio. When Mihon
refreshes tracking, it reads back how far you've got in Plinthio. The count only moves
forward: marking something unread in Mihon doesn't unmark it in Plinthio. Page positions
within a volume don't sync; Komga's tracker doesn't carry them.

### How the sign-in works

The extension sends HTTP Basic credentials, or `X-API-Key`. Plinthio then sets a session
cookie tied to that API key, which Mihon's tracker uses because it sends no credentials of
its own. The cookie lasts 30 days and is renewed on use. Deleting the key ends it at once.

## KOReader (Kobo, Kindle, PocketBook, Android, Linux)

Plinthio is a KOReader **progress sync** server. KOReader keeps your place in each book on
Plinthio, so other KOReader devices, and Plinthio itself, can pick it up.

### Set up

1. Open any book in KOReader, then **Tools (🔧) → Progress sync → Custom sync server**, and
   enter `https://your-server/api/kosync` (the address from the Reading Apps card).
2. **Register / Login → Login.** Don't choose Register: accounts are made in Plinthio, and
   it refuses registration. Enter your Plinthio username, and an API key as the password.
3. Optionally, in the same menu, turn on automatic sync and choose what happens when another
   device is ahead.

Keep **Document matching** on its default, **Binary**. Filename matching works too, but
breaks if the file is renamed.

### What syncs

KOReader identifies a book by a fingerprint of the file. When that matches a book in your
library, the position also moves Plinthio's progress:

| Book | KOReader → Plinthio | Plinthio → KOReader |
| --- | --- | --- |
| PDF, CBZ and other comics | page and percentage | the page, when Plinthio's is newer |
| EPUB | percentage (the web reader opens at that point) | only positions from other KOReader devices |

EPUB positions can't go from Plinthio to KOReader because KOReader records EPUB positions in
its own format (XPointers), which Plinthio can't produce.

Books Plinthio doesn't have (sideloaded onto the e-reader) still sync between your KOReader
devices through Plinthio, like any kosync server.

To read the same file, download it from Plinthio (OPDS works well, see below) or copy it
across. A different copy of the "same" book, such as another edition, has a different
fingerprint and syncs separately.

### Keys

KOReader sends an MD5 of the password rather than the password, so it needs a key made on
Plinthio 1.0.0 or later. Older keys are rejected; make a new one.

## OPDS readers

Any OPDS reader can browse and download: Chunky, Panels, KyBook, Moon+ Reader, KOReader's
own OPDS browser and others.

- **Catalog address:** `https://your-server/api/opds`
- Username and an API key as the password.
- Comics and manga support **OPDS-PSE page streaming**: readers fetch pages one at a time
  instead of the whole archive. PDFs stream page by page as rendered images.

OPDS is read-only: readers don't send progress back. Use KOReader sync or Mihon's tracker for
that.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Mihon "HTTP 401" | Wrong username or key, or the key was deleted. Make a new key |
| Mihon shows nothing | The account can't see any comic, manga or PDF libraries (check content limits and Kids Mode), or the address has `/api` on the end |
| Mihon tracking doesn't update Plinthio | Tracking → Komga isn't on, or the series isn't linked. Tracking only records finished chapters |
| KOReader "Unauthorized" | The key was made before 1.0.0, you chose Register, or the username is wrong |
| KOReader syncs between devices but Plinthio's progress doesn't move | The file on the e-reader differs from the one in the library. Download it from Plinthio so the fingerprint matches |
| OPDS reader never asks for a password | Use `/api/opds`, not the web address. Some readers need the credentials entered in the catalog's settings |
