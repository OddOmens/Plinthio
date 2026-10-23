# Live TV

Live channels with a programme guide, next to your own library. Live TV is **off** until an
admin turns it on in **Admin → Live TV**.

## Where the channels come from

- **Public lists.** One click adds a ready-made list from the [iptv-org](https://github.com/iptv-org/iptv)
  project: by country, language or category. These are public, free channels (about 11,000
  of them, updated daily), each list with its programme guide. Plinthio stores only the list's
  address and downloads it again every 12 hours, so channels that move or close drop out on
  their own. Adult channels are never added. Some public channels go offline now and then, and
  some only play in their home country (marked *Geo-blocked*; hidden unless you choose to show
  them). The first time a public list is added, Plinthio asks you to confirm a short note about
  public channels, once per server.
- **Your own playlist.** Any M3U playlist address, with an optional XMLTV programme guide
  (`.xml` or `.xml.gz`). If the playlist names its own guide (`x-tvg-url`), that's used when
  you leave the guide address empty. A playlist on your home network works: use its IP
  address or a local name (`tuner.local`, `iptvbox`).

Channels that stream in **HLS** (`.m3u8`) play. Others are listed in Admin as *Not playable*
and hidden from viewers.

## Choosing what to show

Public lists can hold thousands of channels. **Admin → Live TV → Choose what to show** hides
whole sets of them at once. These are rules rather than deletions: they still apply after every
reload, and new channels that match are hidden too. The card shows how many channels get
through (*Showing 1,240 of 3,512 channels*).

- **Region-locked channels** are hidden to start with, since they usually only play in their
  home country. Switch off **Hide region-locked channels** to list them.
- **Categories, Languages, Countries, Stream hosts.** Each tab lists what your channels have,
  biggest first, with a count. Tap a row to show or hide it, search for one, or use
  **Show all** / **Hide all** (on what the search leaves in view). To keep just a few, press
  **Hide all**, then switch those back on.
- A channel in several **languages** is hidden only when all of them are hidden. Channels with
  no language or country listed aren't affected by those tabs. A channel in several
  **categories** is hidden when any of them is.
- **Stream hosts.** Some public channels aren't streamed by the broadcaster but re-routed
  through a third-party service. Hiding a host drops every channel streamed from it (and its
  subdomains). Plinthio hides one such service, `jmp2.uk`, until you show it; only show it if
  you're sure you may watch those channels.

Country and language names come from the public iptv-org data for public lists, and from a
playlist's own `tvg-country` / `tvg-language` for yours.

### One channel at a time

In **Admin → Live TV → Channels**, search and filter the channels and:

- **Hide** the ones you don't want. Hidden channels stay hidden when the list reloads.
- **Always show** a channel that a filter hides. Choose **Hidden by filter** to see them; each
  says which filter hides it. A channel you hide by hand stays hidden either way.
- **Allow for kids.** Kids accounts see only the channels allowed here (or in a line-up that
  allows kids), and none are allowed until you pick them, since live channels have no age
  ratings.
- **Number, name and logo.** The pencil on a channel gives it its own channel number
  (1–9999, each used once), a different name, or a logo address (http or https). Leave a field
  empty to go back to what the list gives. These stay when the list reloads.

The same stream offered by two lists appears once.

## Line-ups and channel numbers

**Admin → Live TV → Line-ups** lets you make your own sets of channels, such as *News*,
*Sport* or *For the kids*. Each line-up is a tab on the Live TV page, in the order you put
them.

- **New line-up** asks for a name, then opens it. Add channels by **Search** (one at a time,
  or every match at once) or by **Whole category**, which adds all of a category's channels in
  one go. Under **Channels** you can also tick channels and press **Add to line-up**.
- The up and down arrows put the line-ups, and the channels inside each one, in order.
  **A–Z** and **By number** sort a whole line-up at once.
- **Allow for kids** on a line-up lets kids accounts watch every channel in it, on top of the
  channels allowed one by one.
- A line-up doesn't bring back a channel you've hidden or one that's offline, and the filters
  still apply unless the channel is set to **Always show**. Removing a channel from a line-up
  doesn't hide it anywhere else; deleting a line-up keeps its channels.

**Numbering.** Channels with a number you gave them use it. The others follow on after your
highest number, in their usual order (so with numbers up to 20, the first unnumbered channel
is 21). Viewers change channel up and down, or type a number in the player, using these
numbers.

## Channel health

Public channels stop working now and then. **Admin → Live TV → Channel health** finds the ones
that have stopped.

- With **Check channels in the background** on (the default), Plinthio checks about 20
  channels every 10 minutes while Live TV is on, two at a time, oldest check first. About
  1,500 channels are each checked roughly once a day.
- A check is deliberately light and network-only: the server fetches the channel's playlist
  (following it to the first video playlist) and asks for the first 2 KB of one segment.
  Nothing is played, decoded or converted, and each step gives up after 10 seconds.
- A channel that fails **two checks in a row** is marked **Offline**; one good check marks it
  working again. Offline channels are checked again about once a day.
- With **Hide offline channels** on (the default), viewers don't see offline channels until
  they play again.
- The card shows how many channels are working, offline and not checked yet, and when the
  last check ran. Press the offline count to list them under **Channels**, where **Check now**
  on a channel looks straight away.

## Your responsibility

Plinthio plays the channels you give it. It doesn't host, check or endorse any channel, and it
comes with none. You choose which lists and channels to add, and you're responsible for having
the right to watch them where you are: public lists link to streams run by others, and some
may not be licensed in your country.

## Watching

**Live TV** appears in the menu once there are channels someone may watch.

- **Channels** shows every channel with what's on now (and how long is left) and what's next.
  Filter by group or search.
- **Guide** is the programme grid, six hours at a time, from two hours ago to a day and a
  half ahead. Tap a programme for its details.
- The **player** has channel up/down (or the ↑/↓ keys, or type a channel number),
  picture-in-picture where the browser supports it, fullscreen, and *Go live* when you've
  fallen behind.

The Channels view has tabs, each shown only when it has something in it: **Favourites**,
**Recent**, one per **line-up**, and **All channels** (with its categories). It opens on
Favourites if you have any, else the first line-up, and remembers the last tab on each device.

### Each viewer's own choices

These belong to each account and don't change anything for anyone else.

- **Favourites.** The star on a channel adds it to **Favourites**. Favourites also show in a
  **Live now** row on Home, with what's on; the row can be hidden.
- **Recent.** The last ten channels watched. In the player, **Last channel** (or the `L` key)
  jumps back to the one you watched before.
- **Hide for me.** A channel's menu hides that channel, or its whole group, just for you.
  **Hidden for me** on the Live TV page lists what you've hidden, with a way to bring each
  back, and turns the Home row on or off.
- **Search** finds channels by name and programmes by title over the next day and a half. In
  the guide, **Now**, **Tonight** (8 pm) and **Tomorrow** (8 am) jump to that time.

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

## Troubleshooting

- **A channel is marked Offline.** It failed its last two checks. It comes back by itself once
  a check succeeds; **Check now** looks straight away. To list it anyway, switch off **Hide
  offline channels**.
- **A channel number won't save.** Each number can belong to one channel only. Clear it on
  the other channel first.
- **A channel is missing for one person.** They may have hidden it, or its group, for
  themselves; it's listed under **Hidden for me** on their Live TV page.

## Not yet

Recording, pausing live TV, antenna tuners and non-HLS streams aren't supported yet. A few
channels only allow IPv6 connections. If Plinthio's container has no IPv6 (Docker's default),
those can fail through Plinthio even though they open in a browser.
