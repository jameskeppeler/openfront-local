# LAN multiplayer

Play OpenFront with friends on the same local network (home Wi-Fi, office LAN, a
phone hotspot, etc.) with no openfront.io account and no internet connection.
One machine **hosts** (runs the server) and everyone else **joins** from a
browser. You can fill the rest of the map with AI opponents.

## Quick start

On the **host** machine:

```bash
npm run inst # first time only
npm run lan
```

You'll see a banner like:

```
  Tell friends on the same Wi-Fi / network to open:

      http://192.168.1.42:9000
```

Non-developers can instead double-click **`Play-OpenFront.command`** (macOS/Linux)
or **`Play-OpenFront.bat`** (Windows), which run the same thing.

Then:

1. On the host, the browser opens automatically to the LAN address. Pick a
   username and click **LAN Game → Host a LAN Game**.
2. Configure the lobby (map, number of **AI bots**, nations, team mode, etc.) and
   copy the lobby link the host screen shows.
3. **Friends** open the `http://<host-ip>:9000` address from the banner, enter a
   username, and click **LAN Game → Join a LAN Game** (or just open the lobby
   link the host shared). Start the game when everyone's in.

Everyone must be on the **same network**, and the host's firewall must allow
incoming connections on port **9000**.

## Playing with computers (AI)

AI players come in two flavors and are configured in the Host lobby screen:

- **Bots** — roaming tribes. Set the **Bots** slider (0–400).
- **Nations** — map-anchored NPC nations. Set the **Nations** slider, and use
  **Difficulty** (Easy → Impossible) to scale their strength.

A solo human + bots/nations is a perfectly valid LAN game, so the host can start
even before anyone else joins.

## How it works

LAN mode reuses OpenFront's normal client/server multiplayer — the server just
relays intents and every client runs the deterministic simulation locally. The
only LAN-specific pieces are:

- **`npm run lan`** sets `VITE_HOST=lan` so the dev client binds to `0.0.0.0`
  (reachable across the network) and prints/opens the shareable address
  (`scripts/lan-info.mjs`).
- **Guest identity.** When a browser is on a private LAN address
  (`192.168.x`, `10.x`, `172.16–31.x`, `*.local`, …), the client treats the
  player as a local guest: it skips the external auth API and CAPTCHA entirely
  and joins with a locally generated id, which the dev server accepts. See
  `src/client/Lan.ts`, `Auth.ts`, and `Api.ts`. Plain `localhost` keeps its
  normal behavior so `npm run dev` is unaffected.
- **`GET /api/lan_info`** (dev only) reports the host's private IPv4 addresses so
  the in-game **LAN Game** screen can show the exact URL to share, even if the
  host opened `localhost`.

## Troubleshooting

- **Friends can't connect.** Confirm they're on the same network, you shared the
  `192.168.x`/`10.x` address (not `localhost`), and the host firewall allows
  inbound TCP on port 9000.
- **"Couldn't detect a network address."** The host isn't connected to a network
  interface with a private IP. Connect to Wi-Fi/Ethernet and restart `npm run lan`.
- **Wrong address shown.** If the host opened `localhost` manually, the LAN Game
  screen lists the detected network addresses to share instead.
