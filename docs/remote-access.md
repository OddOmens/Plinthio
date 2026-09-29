# Using Plinthio away from home

Out of the box, Plinthio is for your home network: phones, tablets and computers on your
Wi-Fi open `http://<server>:8088`. This page covers using it anywhere else, and letting other
people in. All of it is optional.

## Which do I need?

| You want | Use | Devices need | Router changes |
| --- | --- | --- | --- |
| Just home | Nothing to do | A browser | None |
| You (and a few people you trust), anywhere | [Tailscale](#tailscale) | The free Tailscale app, signed in | None |
| Friends and family, no apps, **no domain** | [Tailscale Funnel](#tailscale-funnel-a-link-for-anyone-no-domain) | A browser | None |
| Friends and family, no apps, full speed | [A web address](#a-web-address-for-guests) | A browser | Two ports forwarded, and a domain |

Tailscale is private: nothing is reachable from the internet, and it works with any internet
connection. Funnel and a web address both put your sign-in page on the internet, so read
[Keeping it safe](#keeping-it-safe) first. **Funnel** is the easiest: a permanent link with no
domain and no router changes, and it works even where your provider blocks incoming
connections, but it goes through Tailscale's servers, which limit bandwidth. That's fine for
books, comics and audiobooks; video may stutter. **A web address** goes straight to your
server at full speed, but needs a domain and router access. You can combine them: Tailscale
for you, Funnel or a web address for everyone else.

Whichever you pick, **Admin → Network** decides who's allowed in from where (below), and shows
where the device you're using is connecting from, so you can check it works. For Tailscale
and Funnel it also has a step-by-step guide that writes your `.env` lines, and tells you when
it sees Tailscale and Funnel working. The setup wizard offers the same guide.

## Who's allowed in from where

**Admin → Network**:

- **Allow access from outside the home network.** Off: only home devices (and Tailscale,
  below) can sign in or use anything, and the internet gets "available at home only". On:
  anyone whose account is allowed away from home can sign in from anywhere. New servers
  choose this in the setup wizard; servers upgraded from before 1.4.0 keep working the way
  they did, which is on.
- **Tailscale devices count as home.** On by default.
- **Require two-factor away from home.** Optional. Sign-ins from outside then need a code
  from a phone app; at home a password is enough, so anyone can sign in there and set
  two-factor up.

**Admin → Users**, per person: **Can use Plinthio away from home**. Turn it off for, say, the
kids' accounts. Every request is checked, not just sign-in, so a phone that signed in at home
can't keep using a home-only account once it leaves. The reading apps (OPDS, Mihon, KOReader)
and API keys follow their owner's setting.

"Home" means the addresses a home network uses: `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`,
link-local, and their IPv6 equivalents. Tailscale is `100.64–127.x.x`. Everything else is
outside. First-run setup can only ever be done from home.

> **Docker Desktop (Mac, Windows):** containers there never see visitors' real addresses, so
> everyone looks like they're at home and these controls can't tell anyone apart. On Docker
> Desktop, use Tailscale rather than opening Plinthio to the internet.

## Tailscale

[Tailscale](https://tailscale.com) connects your devices over an encrypted private network,
through any internet connection, without opening anything on your router. It's free for
personal use. Plinthio gets a trusted `https://plinthio.<your-tailnet>.ts.net` address, so
there are no certificates to install and the installed app works offline.

1. Make a Tailscale account, then in the [admin console](https://login.tailscale.com/admin):
   **DNS** → turn on **MagicDNS** and **HTTPS Certificates**.
2. **With Docker:** get the add-on next to `docker-compose.yml`:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.tailscale.yml
   ```
   In the admin console, **Settings → Keys → Generate auth key**, then add to `.env`:
   ```ini
   TS_AUTHKEY=tskey-auth-…
   COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml
   ```
   and run `docker compose up -d`. (No key? Leave it out and sign in with the link
   `docker logs plinthio-tailscale` prints.)

   **Tailscale already on the server, or no Docker:** run `sudo tailscale serve --bg 8088`
   (8088 being the port Plinthio is on). Without Docker, also set `TRUST_PROXY=loopback`. With
   Docker and Tailscale on the host, use the add-on instead: requests don't reach Plinthio
   from loopback there, so it can't tell Tailscale devices apart.
3. On each phone or computer: install Tailscale, sign in, open
   `https://plinthio.<your-tailnet>.ts.net` (listed under **Machines** in the admin console),
   and add it to the home screen from there.

**Letting someone else in:** in the admin console, open the Plinthio machine's **⋯ → Share**
and send them the link. They sign in to Tailscale with their own account and see only
Plinthio, not your other devices. Then make them a Plinthio account. Or, so they don't need
Tailscale at all, use Funnel (next).

## Tailscale Funnel: a link for anyone, no domain

Funnel opens the same `https://plinthio.<your-tailnet>.ts.net` address to the whole internet.
Friends just open the link in a browser and sign in: no Tailscale, no app, nothing to install.
You don't need a domain or any router changes, and it works even behind CGNAT (5G home
internet, Starlink and so on). Only you need a Tailscale account.

**The trade-off:** Funnel traffic goes through Tailscale's servers, and Tailscale limits its
bandwidth (the limit isn't published or adjustable). Reading and listening are fine; video
may buffer, especially in HD or with several people watching. For full-speed video, use
[a web address](#a-web-address-for-guests) instead.

1. Set up [Tailscale](#tailscale) with the Docker add-on first.
2. **Admin → Network → Allow access from outside the home network.** Funnel visitors come from
   the internet, so without this they get "available at home only". While you're there,
   consider **Require two-factor away from home**, and set up two-factor for yourself.
3. Add to `.env` (exactly `true`):
   ```ini
   TS_FUNNEL=true
   ```
   and run `docker compose up -d --force-recreate`. (`--force-recreate` matters when
   Tailscale is already running: Compose doesn't notice a changed `TS_FUNNEL` on its own.)
4. The first time, Tailscale may need Funnel allowed for your tailnet. If
   `docker logs plinthio-tailscale` mentions Funnel not being enabled, follow the link it
   gives, or in the admin console open **Access controls** and allow the `funnel` attribute
   (Tailscale's [Funnel docs](https://tailscale.com/kb/1223/funnel) show the exact lines).
5. Check it: on a phone with **Wi-Fi off** and **without Tailscale running**, open
   `https://plinthio.<your-tailnet>.ts.net`. You should get the sign-in page. Sign in as an
   admin and open Admin → Network: it should say you're connecting from outside.

Send friends that link, and make them Plinthio accounts (Admin → Users). To close it again,
set `TS_FUNNEL=false` (or remove the line) and run `docker compose up -d --force-recreate`. Your own Tailscale
devices keep working either way.

## A web address for guests

Guests open something like `https://media.yourdomain.com`, sign in, and add it to their home
screen. Nothing to install, and the reading apps work with a normal address. Plinthio's
public-address add-on runs [Caddy](https://caddyserver.com), which gets and renews a free
[Let's Encrypt](https://letsencrypt.org) certificate by itself.

Budget half an hour. Most of it is your router and your domain's DNS settings, which look
different for everyone.

### 1. Check your internet connection allows it

Some providers don't let anything in from the internet at all ("CGNAT"). That's common with
5G and 4G home internet, Starlink, and some fibre and cable providers. Check first:

1. Open your router's status page and find its **WAN** or **internet IP address**.
2. On any device at home, visit a "what is my IP" site.
3. If the two **match**, you're fine. If the router's starts with `100.64`–`100.127`, `10.`,
   `172.16`–`172.31` or `192.168.`, or they differ, you're behind CGNAT: a web address won't
   work. Use Tailscale, or ask your provider for a public IP (some offer one for free or a
   small fee).

Also note whether your address changes over time (most home ones do). If it does, you'll need
dynamic DNS in step 3.

### 2. Get a domain

Any registrar works (Cloudflare, Porkbun, Namecheap…); a year costs about the price of a
coffee or two. You can use a subdomain like `media.yourdomain.com` and keep the main domain
for other things.

### 3. Point the name at your home

In your domain's DNS settings, add an **A record**: name `media` (or whatever you chose),
value your home's public IP from step 1. If your IP changes, set up dynamic DNS so the record
follows it: many routers have it built in, or use your DNS provider's own updater.

### 4. Forward two ports on your router

Forward **TCP 80** and **TCP 443** (and UDP 443, optional, for HTTP/3) to the machine running
Plinthio. It's usually under "Port forwarding", "Virtual servers" or "NAT". Give the machine a
fixed address on your network first (a "DHCP reservation"), so the forward keeps pointing at
it. Don't forward 8088: Caddy on 443 is the way in.

### 5. Turn on outside access

**Admin → Network → Allow access from outside the home network.** While you're there, consider
**Require two-factor away from home**, and set up two-factor for your own account
(Settings → Security).

### 6. Start the add-on

```bash
curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.public.yml
```

Add to `.env`:

```ini
PLINTHIO_DOMAIN=media.yourdomain.com
COMPOSE_FILE=docker-compose.yml:docker-compose.public.yml
# With Tailscale too:
# COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml:docker-compose.public.yml
```

and run `docker compose up -d`. Caddy's certificate usually arrives within a minute:
`docker logs plinthio-caddy` says "certificate obtained successfully".

### 7. Check it

On a phone with **Wi-Fi off** (so it's really outside), open `https://media.yourdomain.com`.
You should get Plinthio's sign-in page with a padlock. Sign in as an admin and open
**Admin → Network**: it should say "connecting from outside the home network" with your
phone's mobile address. If it says "home" instead, see [Troubleshooting](#troubleshooting).

### Already have a reverse proxy?

Nginx Proxy Manager, Traefik, SWAG or your own nginx work too. Point it at Plinthio's port
8088 (or 8080 inside Docker), and set `TRUST_PROXY` to the proxy's address as Plinthio sees it
(for example `TRUST_PROXY=172.18.0.5`, or a subnet like `172.18.0.0/16`), never to `1` or
`true` unless Plinthio is reachable **only** through the proxy. Admin → Network warns you if a
proxy is sending forwarded addresses that Plinthio isn't trusting. Watch parties and the
reading apps need nothing extra.

## Keeping it safe

Funnel and a web address both put your sign-in page on the internet. Plinthio is built for
that to be reasonable, but it's worth a few minutes:

- **Nobody can sign up.** Only an admin makes accounts.
- **Strong passwords**, especially for admins. Longer beats clever.
- **Two-factor** for admins at least (Settings → Security), and consider requiring it away
  from home (Admin → Network).
- **Home-only accounts** for anyone who doesn't need outside access (Admin → Users).
- **Guest passes:** accounts can expire (Admin → Users), handy for a visitor.
- **Keep Plinthio updated.** Admins get a banner when there's a new version.
- **Look at who's signing in:** Admin → Network lists recent sign-ins from outside, and
  Admin → Logs has every attempt.

What Plinthio does on its own: sign-in attempts are rate limited per address (ten failures in
fifteen minutes), response timing doesn't reveal which usernames exist, sessions can be ended
everywhere at once (Settings → Security), and HTTPS is handled by Caddy with modern settings.
Plinthio hasn't had an independent security audit; the [security policy](../SECURITY.md) says
how to report a problem.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The Funnel link doesn't load for friends | `docker exec plinthio-tailscale tailscale funnel status` should say "Funnel on". If it says "tailnet only", check `TS_FUNNEL=true` (exactly) and run `docker compose up -d --force-recreate`. Also check that Funnel is allowed for your tailnet (`docker logs plinthio-tailscale`), and test with Tailscale turned off on the phone. Funnel can take a minute to start after `docker compose up -d` |
| Video buffers over Funnel | Tailscale limits Funnel's bandwidth. Try a lower quality in the player, or use [a web address](#a-web-address-for-guests) for full speed |
| The web address doesn't load from outside | Check step 1 (CGNAT), that the A record shows your current IP (`nslookup media.yourdomain.com`), and that ports 80 and 443 are forwarded to the right machine. Some providers block port 80 or 443: ask them, or use Tailscale |
| It works from outside but not at home | Some routers can't loop back to your own public address ("NAT loopback"). At home, keep using `http://<server>:8088`, or add the name to your router's local DNS pointing at the server's home address |
| Caddy says it can't get a certificate | Port 80 or 443 isn't reaching Caddy, or the DNS record is wrong or new (wait a few minutes). `docker logs plinthio-caddy` says which |
| Admin → Network says "home" from a phone on mobile data | Plinthio can't see the real address. Docker Desktop never can (use Tailscale); with your own proxy, set `TRUST_PROXY` (above) |
| "Available at home only" from outside | Outside access is off: Admin → Network |
| "This account is for home use only" (P110) | Admin → Users → the account → allow it away from home |
| "Two-factor needed away from home" (P112) | Sign in at home once and turn on two-factor in Settings → Security |
| Lost the phone with the authenticator app | Use a backup code. None left? An admin can reset two-factor in Admin → Users |
