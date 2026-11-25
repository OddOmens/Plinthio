# Together: watch parties, lists, requests and ratings

## Watch parties

Watch a movie or show with people in other places, in sync. Watch parties are **off** until
an admin turns them on in **Admin → Features → Watch parties** (or in the setup
wizard).

### Using them

1. On any movie or episode, press **Watch Together**.
2. Share the invite link, or the six-letter code. Codes avoid 0/O and 1/I/L so they can be
   read out loud.
3. Anyone with an account on the server opens the link, signs in if needed, and joins.
   Signing in returns them to the party.

In a party:

- **Play, pause and seeking** stay in step for everyone. Each person streams from the
  server as they would alone; only the playback state is shared.
- **Who's in control:** the host chooses **host only** (the default) or **everyone**. Guests
  without control can still pause for themselves, and are put back in step.
- **Buffering:** if someone's connection stalls, the party waits for them, for up to 15
  seconds.
- **Next episode:** starts for everyone together.
- **Chat** and a member list. The last 50 messages are kept.
- **End party:** the host ends it for everyone.

### Limits and behaviour

- Up to 20 parties at once, with 20 people each.
- Parties live in the server's memory. A restart ends them, and the host shares a new link.
- A party everyone has left is kept for a minute, so a refresh or dropped connection can
  rejoin.
- **Content limits and Kids Mode still apply.** Nobody can join something their account
  can't open, and the host can't move the party to something a member can't watch (P603,
  P604).
- Turning watch parties off ends every party in progress.
- Friends outside your home network need to reach the server. See
  [Using Plinthio away from home](remote-access.md).

Error codes P600–P605 cover parties; see [Error codes](error-codes.md).

## Lists

**Lists** are ordered collections anyone can make, grouped into **Movies**, **Shows**,
**Anime**, **Read** and **Listen** tabs. They're in the top bar, after the media types (or
at the end of the sidebar).

- Lists show as cards with their first few covers, and a list's titles as a poster grid,
  like the shelf.
- Add titles from the library, or titles found by searching TMDB, MangaDex, Google Books and
  Open Library, all in one list. That makes a list a **watchlist** for things the server
  doesn't have: they're grey with a dashed outline and **Not in library**, and turn into
  normal posters (linking to their page) once the library has them.
- A film missing from a collection has an **Add to list** button next to **Request**.
- Move titles earlier or later with the arrows on each poster.
- A searched title you don't have can be **requested** straight from the list.
- The old `/read-lists` address redirects to the Read tab.

## Requests

Anyone can ask for a title the server doesn't have, from search results, a list, or a
collection's missing films.

- There's **one open request per title** across all users. Asking for something already
  requested says so (P503), or says it's been added (P504), rather than making a duplicate.
- **Editors and admins** get a review queue with three answers, and a note the requester
  sees:
  - **Approve:** yes, we'll get it. The request shows as **Approved** until the title is in
    the library. With a Seerr server connected, the button reads **Approve · Send to Seerr**
    on a movie or show, and pressing it asks Seerr for the title.
  - **Mark as added:** it's already in the library, so the request is done. Nothing is sent
    anywhere. A library scan does this for you when the title arrives (see below).
  - **Reject.**
- Requesters can withdraw a request while it's pending.
- The user menu shows how many requests are waiting for review.

### Requests that handle themselves

Two steps need no one to press anything.

**Accepting.** In **Admin → Features → Requests**, choose who has their requests accepted as
they make them:

- **Nobody** (the default): every request waits in the review queue.
- **Admins and editors:** their own requests are accepted on the spot.
- **Everyone:** every request is accepted on the spot. An account with Kids Mode or an age
  rating limit still waits for a reviewer.

A request accepted this way shows **Accepted automatically** in the review queue, and a movie
or show goes on to Seerr just as if a reviewer had pressed **Approve** (see
below). If the title is already in the library, the request is marked as added instead and
nothing is sent.

**Marking it added.** After every library scan, Plinthio checks open requests against the
library and marks a request **Added** once its title is there. This is always on.

- A movie or show is found by its TMDB id where the library knows it, otherwise by name. A
  movie's year must also match to within a year, so a remake doesn't count for the original.
- Books, manga and audiobooks are found by name.
- A request still waiting for review is marked too: the title is here, so there's nothing
  left to decide.
- Each request is only marked this way once. If a reviewer moves it back, later scans leave
  it alone.
- How soon it happens depends on when the library is next scanned (Admin → Libraries).

### Sending accepted requests to Seerr

If you run a [Seerr](https://github.com/seerr-team/seerr) server, Plinthio can pass accepted
requests on to it, so nobody has to add the title there by hand. Plinthio only tells Seerr
that the title was approved. It never searches for or downloads anything itself. Seerr is a
separate project with its own maintainers; Plinthio isn't affiliated with it.

**Set it up** in **Admin → Features → Requests**: the Seerr address (for example
`http://seerr:5055`) and its API key, found in Seerr's general settings. Plinthio checks
both before saving. The key is stored on the server and never shown again.

- **When it sends:** when an admin or editor presses **Approve · Send to Seerr**, or when a
  request is approved automatically. **Reject** and **Mark as added** (it's already in the
  library) send nothing.
- **What it sends:** the title's TMDB id. A show is requested with all its seasons. The
  request is made by the account the API key belongs to, so with the Seerr owner's key it
  is approved there straight away.
- **What stays in Plinthio:** books, manga and audiobooks, and any title found somewhere
  other than TMDB (TVmaze, AniList). They're handled in the review queue as before.
- **In the review queue:** each request shows **Sent to Seerr**, **Already in Seerr**, or why
  it couldn't be sent, with **Send again**. A failure never undoes the accept. Requests
  accepted before Seerr was set up get a **Send to Seerr** button.
- **The address** must be one the Plinthio server itself can reach. Inside Docker,
  `localhost` is the Plinthio container, so use the Seerr container's name on a shared
  network, or the machine's own address.
- Once the title arrives and the library is scanned, the request is marked **Added** by
  itself (see [Requests that handle themselves](#requests-that-handle-themselves)).

## Ratings

- **Your stars:** give any title 1–5 stars from its page. On a series page you rate one
  volume or episode at a time, chosen in the header. Your rating shows as a badge on cards.
- **Community:** the average of everyone on the server.
- **World:** TMDB's score for movies, shows and anime (needs a TMDB key). It's refreshed
  from time to time, not on every view.

Admins choose which of the three are shown in **Admin → Features → Ratings**. A
switched-off rating isn't sent by the API either, not just hidden.
