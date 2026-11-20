[中文](README.zh-CN.md)

# TikTok Search API

A Node.js script that searches TikTok and prints structured JSON: result
cards (video/photo), featured users, search tabs and page context. Run it on
your own computer, server or phone. No account, no API key and no install
needed for the basic run.

## Requirements

- Node.js 18 or newer (20+ recommended). Check with `node --version`.
- Nothing else for the basic run: zero dependencies, no `npm install`.

## Quick start

```sh
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

No download? Grab the single file instead:

```sh
curl -O https://raw.githubusercontent.com/FAK-LABS/tiktok-search-api/main/tiktok-search.mjs
node tiktok-search.mjs "FAK LABS"
```

## Usage

```sh
node tiktok-search.mjs "search terms" [options]
```

| Option | What it does |
|---|---|
| `--cookie "name=value; ..."` | Logged-in TikTok cookies (or set `TIKTOK_COOKIE`) |
| `--tab top` \| `video` | Search tab (default: `video`) |
| `--scroll N` | Scroll rounds in browser mode, 0-10 (default: 5) |
| `--raw` | Include the full rehydration JSON in `context` |
| `--debug` | Include a debug object (final URL, title, counts) |
| `--browser` | Render the page in a real browser (needs `puppeteer`) |
| `--html <file>` | Parse a saved TikTok search page instead of fetching |
| `-h`, `--help` | Show help |

Examples:

```sh
node tiktok-search.mjs "FAK LABS"
node tiktok-search.mjs "funny cats" --tab top
node tiktok-search.mjs "FAK LABS" --cookie "sessionid=abc123; sid_tt=xyz"
node tiktok-search.mjs "FAK LABS" --browser --scroll 3
node tiktok-search.mjs --html saved-search-page.html "FAK LABS"
TIKTOK_COOKIE="sessionid=abc123; sid_tt=xyz" node tiktok-search.mjs "FAK LABS"
```

Save the output to a file:

```sh
node tiktok-search.mjs "FAK LABS" > results.json
```

## Output

JSON on stdout. Example (shortened — one item shown):

```json
{
  "success": true,
  "source": "direct-fetch",
  "query": "FAK LABS",
  "totalItems": 3,
  "totalFeaturedUsers": 2,
  "tab": "video",
  "tabs": ["Top", "Videos", "Users"],
  "items": [
    {
      "index": 0,
      "id": "7461234567890123456",
      "type": "video",
      "url": "https://www.tiktok.com/@faklabs/video/7461234567890123456",
      "authorHandle": "faklabs",
      "authorName": "FAK LABS",
      "caption": "FAK BOT by FAK LABS #faklabs",
      "hashtags": ["faklabs"],
      "sound": "original sound - faklabs",
      "thumbnail": "https://p16-sign.tiktokcdn.com/thumb.jpg",
      "likesOrViewsText": "12.3K",
      "likesOrViewsCount": 12300,
      "isTopLiked": true
    }
  ],
  "featuredUsers": [
    {
      "handle": "featured_one",
      "profileUrl": "https://www.tiktok.com/@featured_one",
      "posts": []
    }
  ],
  "context": { "language": "en", "region": "US" }
}
```

`source` is `direct-fetch`, `browser-rendering` or `file-html`.
On failure the script prints `{"success": false, "error": "..."}` to
stderr and exits with code 1.

## Getting a TIKTOK_COOKIE (for reliable results)

1. Log in to tiktok.com in your desktop browser.
2. Open DevTools (F12) → Application → Cookies → `https://www.tiktok.com`.
3. Copy the cookies as one string: `name=value; name=value; ...`
4. Use it:

```sh
node tiktok-search.mjs "FAK LABS" --cookie "sessionid=...; sid_tt=..."
```

or set it once per session:

```sh
export TIKTOK_COOKIE="sessionid=...; sid_tt=..."
node tiktok-search.mjs "FAK LABS"
```

Never share your cookie string with anyone and never commit it to a repo.
It logs in as you.

## Why results can be empty

TikTok gates search results behind bot detection. Automated requests,
especially from datacenter IPs (most VPS servers), often get an empty page
even though a real browser gets results while logged out. When that
happens the script still exits 0 and prints valid JSON with
`"totalItems": 0` and a `warning` field explaining it.

What actually helps, in order:

1. A logged-in `TIKTOK_COOKIE` (see above).
2. A residential IP instead of a datacenter IP.
3. `--browser` mode, which renders the page in a real browser.
4. `--html`: open `tiktok.com/search?q=...` in a real browser where
   results show, save the page (Ctrl+S, complete page), and parse it:

```sh
node tiktok-search.mjs --html saved-page.html "FAK LABS"
```

## Host it on your own VPS

Any Ubuntu/Debian VPS works. SSH in and run:

```sh
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

Run a search on a schedule with cron (saves the JSON every hour):

```sh
crontab -e
```

```cron
0 * * * * cd ~/tiktok-search-api && node tiktok-search.mjs "FAK LABS" > ~/fak-labs.json 2> ~/fak-labs.err
```

Note: most VPS IPs are datacenter IPs, so expect empty results without
a logged-in cookie — see "Why results can be empty" above.

## Install Node.js

### Ubuntu / Debian

```sh
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Then:

```sh
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

### Linux (other distros)

```sh
# Fedora / RHEL
sudo dnf install -y nodejs git

# Arch
sudo pacman -S nodejs git
```

Or download Node.js from https://nodejs.org — then clone and run the
script the same way as above.

### Termux (Android)

```sh
pkg update && pkg install -y nodejs git
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

To save output where other apps can see it, give Termux storage access
first (`termux-setup-storage`) and write to `~/storage/downloads`:

```sh
node tiktok-search.mjs "FAK LABS" > ~/storage/downloads/results.json
```

### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close PowerShell, open it again, then:

```powershell
git clone https://github.com/FAK-LABS/tiktok-search-api.git
cd tiktok-search-api
node tiktok-search.mjs "FAK LABS"
```

No git? Download the repo ZIP from GitHub, extract it, and run the
script from that folder in PowerShell.

## How it works

1. Fetches the TikTok search page with a desktop browser User-Agent
   (plain `fetch`, plus your cookie when you pass one).
2. Parses the result cards (`data-e2e="search_video-item"` /
   `search_top-item`, `user-post-item`, `#search-tabs`) and the
   `__UNIVERSAL_DATA_FOR_REHYDRATION__` script for page context.
3. Prints the result as JSON.

`--browser` opens the same page in a real headless browser so the
client-side results load, then parses the rendered page. It needs
`puppeteer`, which is the only optional dependency:

```sh
npm install puppeteer
```

## Files

- `tiktok-search.mjs` — the whole script, zero dependencies
- `package.json` — optional `puppeteer` for `--browser` mode, plus the
  `tiktok-search` command (`npm install -g .` makes it available
  everywhere)
- `README.md` — this file
