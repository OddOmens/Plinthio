# Together: watch parties, lists, requests and ratings

## Watch parties

Watch a movie or show with people in other places, in sync. Watch parties are **off** until
an admin turns them on in **Admin → Server Config → Watch Parties** (or in the setup
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
  [Setup → Remote access](setup.md#remote-access).

Error codes P600–P605 cover parties; see [Error codes](error-codes.md).

## Lists

**Lists** (the replacement for Read Lists) are ordered collections anyone can make, grouped
into **Movies**, **Shows**, **Anime**, **Read** and **Listen** tabs.

- Add titles from the library, or titles found by searching TMDB, MangaDex, Google Books and
  Open Library, all in one list. Searched titles show **In library** when you already have
  them.
- Drag to reorder.
- A searched title you don't have can be **requested** straight from the list.
- The old `/read-lists` address redirects to the Read tab.

## Requests

Anyone can ask for a title the server doesn't have, from search results, a list, or a
collection's missing films.

- There's **one open request per title** across all users. Asking for something already
  requested says so (P503), or says it's been added (P504), rather than making a duplicate.
- **Editors and admins** get a review queue: accept it (as pending, or as added once it's in
  the library), reject it, and add a note the requester sees.
- Requesters can withdraw a request while it's pending.
- The user menu shows how many requests are waiting for review.

## Ratings

- **Your stars:** give any title 1–5 stars from its page. On a series page you rate one
  volume or episode at a time, chosen in the header. Your rating shows as a badge on cards.
- **Community:** the average of everyone on the server.
- **World:** TMDB's score for movies, shows and anime (needs a TMDB key). It's refreshed
  from time to time, not on every view.

Admins choose which of the three are shown in **Admin → Server Config → Ratings**. A
switched-off rating isn't sent by the API either, not just hidden.
