# Qteco Website Health

A live dashboard that checks all your websites, shows how fast they respond, keeps a history, and tells you when something goes down. It is built to run on a Raspberry Pi on a wall display, but works in any browser.

![Live view](docs/live.png)

## Features

- **Live wall display.** One card per site with status code, response time, a sparkline and a heatmap of the last 24 checks. Sites that are down get a red overlay and a toast message.
- **Analytics.** Uptime, average response time, number of checks and incidents over 24 hours, 7 days or 30 days, with a response-time chart and a searchable list of sites (worst first).
- **Incidents.** Every outage with its status code, start time and duration, and whether it is still ongoing. A red badge in the sidebar counts sites that are down right now.
- **Always fullscreen.** The frosted-glass sidebar stays hidden. Move the cursor to the left edge of the screen and it slides in.
- **Light and dark theme**, remembered per browser.
- **Pi friendly.** Plain HTML, CSS and JavaScript with no frameworks. Animations only use transform and opacity, and are switched off when the system asks for reduced motion.

## Screenshots

| Analytics | Incidents |
| --- | --- |
| ![Analytics](docs/analytics.png) | ![Incidents](docs/incidents.png) |

Move the cursor to the left edge to open the sidebar:

![Sidebar](docs/sidebar.png)

## How it works

```
Browser (index.html, app.js, analytics.js)
   │  every 30 s
   ▼
api.php ── checks all sites in parallel (cURL) ── cached for 60 s
   ├── health_history.json   short history for the cards, wiped every 8 hours
   └── health.sqlite         long history for Analytics and Incidents, kept 30 days
```

A site counts as **up** when it answers with a status between 200 and 399. It counts as **slow** when it takes 1 second or longer, and as **down** for anything else, including timeouts.

Data is stored while someone has the Live page open, because that is what triggers the checks. For a history without gaps, call `api.php` from a cron job every minute.

## Requirements

- PHP 7.4 or newer with the `curl` and `pdo_sqlite` extensions
- A web server such as Apache or Nginx, with the project folder writable by PHP
- Optional: `mysqli` and access to a Plesk server, to read the list of domains automatically

## Setup

1. Copy the project to your web root, for example `/var/www/html/health/`.
2. Make sure PHP can write to that folder. It creates `health_history.json`, `last_history_reset.txt` and `health.sqlite` by itself.
3. Put your logo at `images/logo.png`. If it is missing, the page falls back to `images/logo.webp`.
4. Open `index.html` in a browser, or start it fullscreen on the Pi.

Block direct downloads of the data files in your web server. For Apache, add this to `.htaccess`:

```apache
<FilesMatch "\.(sqlite|json)$">
    Require all denied
</FilesMatch>
```

## Configuration

| Setting | File | What it does |
| --- | --- | --- |
| `REFRESH_MS` | `app.js` | How often the browser asks for new data (default 30 s) |
| `SCROLL_PPS` | `app.js` | Scroll speed of the wall display |
| `CACHE_TTL` | `api.php` | How long the server reuses one round of checks (default 60 s) |
| `BLOCKED_DOMAINS` | `api.php` | Domains that are never shown. A blocked domain also blocks its subdomains |
| `RANGES` | `api.php` | The time ranges Analytics offers |
| `CURL_TIMEOUT` | `api.php` | How long to wait for a site before marking it as down |

By default the domain list comes from Plesk. If Plesk cannot be read, `api.php` falls back to the remote list set in `FALLBACK_SOURCE`.

## API

| Request | Returns |
| --- | --- |
| `api.php` | Current status of all sites, their short history and RAM and disk usage |
| `api.php?reset=example.nl` | Forces a fresh check of one site from the list |
| `api.php?action=stats&range=24h` | Summary, per-site uptime, timeline and incidents. Range is `24h`, `7d` or `30d` |

## Project structure

```
index.html      page layout and sidebar
style.css       design, themes and animations
app.js          live view: cards, toasts, theme, fullscreen
analytics.js    sidebar navigation, Analytics and Incidents
api.php         checks, history and statistics
docs/           screenshots used in this README
```

## Good to know

- The cursor parked in the top-left corner keeps the sidebar open. On a kiosk, park it somewhere else or hide it.
- There is no login yet and `api.php` allows requests from any origin. Keep the dashboard on an internal network.
- The data files are in `.gitignore`. If they were committed earlier, remove them from Git with `git rm --cached health_history.json last_history_reset.txt`.
