# Live TV

Live channels with a programme guide, next to your own library. Live TV is **off** until an
admin turns it on in **Admin → Live TV**.

## Where the channels come from

- **Public lists.** One click adds a ready-made list from the [iptv-org](https://github.com/iptv-org/iptv)
  project: by country, language or category. These are public, free channels (about 11,000
  of them, updated daily), each list with its programme guide. Plinthio stores only the list's
  address and downloads it again every 12 hours, so channels that move or close drop out on
  their own. Adult channels are never added. Some public channels go offline now and then, and
  some only play in their home country (marked *Region-locked*).
- **Your own playlist.** Any M3U playlist address, with an optional XMLTV programme guide
  (`.xml` or `.xml.gz`). If the playlist names its own guide (`x-tvg-url`), that's used when
  you leave the guide address empty. A playlist on your home network works: use its IP
  address or a local name (`tuner.local`, `iptvbox`).

Channels that stream in **HLS** (`.m3u8`) play. Others are listed in Admin as *Not playable*
and hidden from viewers.

## Choosing what people see

In **Admin → Live TV → Channels**, search and filter the channels and:

- **Hide** the ones you don't want. Hidden channels stay hidden when the list reloads.
- **Allow for kids.** Kids accounts see only the channels allowed here, and none are allowed
  until you pick them, since live channels have no age ratings.

The same stream offered by two lists appears once.

## Watching

**Live TV** appears in the menu once there are channels someone may watch.

- **Channels** shows every channel with what's on now (and how long is left) and what's next.
  Filter by group or search.
- **Guide** is the programme grid, six hours at a time, from two hours ago to a day and a
  half ahead. Tap a programme for its details.
- The **player** has channel up/down (or the ↑/↓ keys, or type a channel number),
  picture-in-picture where the browser supports it, fullscreen, and *Go live* when you've
  fallen behind.

## How playback works (and why it's safe)

Streams play through your Plinthio server rather than straight from the channel: most stream
servers don't allow browsers on other sites to read them, some need particular headers, and a
channel on your home network isn't reachable from a phone outside it. Channel logos come the
same way.

Because the server fetches addresses that come from public playlists, it guards them:

- It only fetches links it wrote and signed itself, for that channel.
- It won't connect to private, loopback, link-local or cloud-metadata addresses. This is
  checked at the moment of connecting, so a name can't be re-pointed in between. The one
  exception is your own playlist on a home-network host, and then only that host.
- Responses are size- and time-limited and can't run as pages on Plinthio's address.

Each viewer streams separately, so a household watching three channels uses three streams of
your server's internet connection.

## Errors

| Code | Meaning |
| --- | --- |
| P700 | Live TV is switched off on this server. |
| P701 | The channel's stream couldn't be reached or played. The channel may be offline or region-locked; try another. |
| P702 | A channel list couldn't be loaded. Admin → Live TV shows the reason under the list. |

See [Error codes](error-codes.md) for every code.

## Not yet

Recording, pausing live TV, antenna tuners and non-HLS streams aren't supported yet. A few
channels only allow IPv6 connections. If Plinthio's container has no IPv6 (Docker's default),
those can fail through Plinthio even though they open in a browser.
