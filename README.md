# BWF Local Time

A TypeScript/React web app that fetches BWF (Badminton World Federation) tournament schedules or pages and re-renders match times in **your local browser timezone**.

BWF tournament results pages (for example `https://bwfworldtour.bwfbadminton.com/tournament/5273/hylo-open-2026/results/2026-10-29`) display times in the **venue/stadium timezone** rather than the visitor's local timezone.

## Features

- **URL input & query parameter support** – enter any HTTP(S) BWF results URL ending with a `YYYY-MM-DD` date, pass `?url=...` in the browser query string, or pass an initial URL on startup via CLI (`--url` / positional arg) or `BWF_INPUT_URL` (starts empty if omitted).
- **Current-month tournament directory** – automatically fetches the BWF corporate calendar for the current year and lists the current month's tournaments (with dates, city/country, and category) in a collapsible list for one-click loading.
- **Current-week date selector** – Monday–Sunday date strip for the current week (highlighting today) that updates the trailing `YYYY-MM-DD` date on the active results URL and reloads the schedule.
- **Automatic & manual source timezone handling** – infers the tournament's source timezone from match UTC offsets (`matchTime` vs `matchTimeUtc`) and tournament metadata (falling back to `Europe/Berlin`), with a manual IANA timezone input and datalist of common zones.
- **Live schedule estimates & court view** – groups matches by court with a sticky court navigation sidebar, displays live scores, match statuses, and estimated remaining minutes (`~Nm left`) for in-progress matches, and adjusts downstream court start times (`Est. · was ...`) when a live match is running.
- **Schedule filtering** – filter matches by **In progress only** or by **Country** (with live and total match counts).
- **Pinned matches & start alerts** – pin matches (persisted in `localStorage`) to track upcoming status in the sidebar and receive persistent in-app toast notifications, optional Web Audio sound alerts, and optional browser `Notification` alerts when a pinned first match is within 10 minutes of starting or when the preceding match on court finishes.
- **Player profile hovercards** – hover or focus any player name to view their BWF bio (age, playing hand, height, residence/birthplace, prize money) and current/career-high world ranking, with a link to their official `bwfbadminton.com` profile.
- **Auto refresh & manual refresh** – configurable auto-refresh (enabled by default at 60s, selectable across 30s / 1m / 5m / 15m / 30m / 1h) with a live countdown, plus **Refresh** / **Refresh now** buttons.
- **Theme switcher** – Light, Dark, and System (`light` / `dark` / `system`) preference persisted in `localStorage`.

## How it works

- **Tournament schedule mode**: When the URL matches `/tournament/<id>/<slug>/...`, the app queries the BWF Extranet API through the Vite dev/preview proxy:
  - `GET /proxy/extranet/api/match-center/vue-tournament-detail?tmtId=<id>`
  - `GET /proxy/extranet/api/tournaments/day-matches?tournamentCode=<code>&date=<yyyy-mm-dd>&order=2&court=0`
  - Player hovercards also query `/proxy/extranet/api/vue-player-bio`, `vue-player-ranking-events`, `vue-player-ranking-current`, and `vue-player-ranking-highest`.
- **Calendar discovery**: Fetches `/proxy/corporate/events/calendar/<year>/remaining/0/-1/` and parses the current month's events.
- **HTML fallback mode**: For non-tournament URLs, fetches the page HTML through the proxy (`/proxy/bwfworldtour/...`, `/proxy/bwfbadminton/...`, `/proxy/match-centre/...`, `/proxy/extranet/...`) and converts time strings (`YYYY-MM-DD HH:MM(:SS)` and `HH:MM AM/PM`) in text nodes to the local timezone.
- **Cloudflare-compatible proxy**: Because BWF hosts sit behind Cloudflare bot management, `vite.config.ts` proxies requests using `curl` under the hood.

## Run

```bash
npm install
npm run dev
```

Optionally pass an initial BWF page URL as a command line argument (starts empty if omitted):

```bash
npm run dev -- https://bwfworldtour.bwfbadminton.com/tournament/5273/hylo-open-2026/results/2026-10-29
```

You can also run `npm run build` (`tsc -b && vite build`), `npm run preview`, or `npm run lint` (`oxlint`).

## Test

A headless-Chrome (`puppeteer-core`) smoke script is available (expects the app running on `http://127.0.0.1:5199/`):

```bash
node scripts/smoke.cjs
```
