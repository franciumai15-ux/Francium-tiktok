#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
const ITEM_SELECTOR = '[data-e2e="search_top-item"], [data-e2e="search_video-item"]';
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const USAGE = `Usage: node tiktok-search.mjs "search terms" [options]

Search TikTok and print structured JSON: result cards, featured users,
tabs and page context.

Options:
  --cookie <cookies>   logged-in TikTok cookies as "name=value; name=value; ..."
                       (or set the TIKTOK_COOKIE environment variable)
  --tab top|video      search tab (default: video)
  --scroll N           scroll rounds in browser mode, 0-10 (default: 5)
  --raw                include the full rehydration JSON in context
  --debug              include a debug object (final URL, title, counts)
  --browser            render the page in a real browser (needs puppeteer)
  --html <file>        parse a saved TikTok search page instead of fetching
  -h, --help           show this help`;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; }
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0" }[n]));
}

function parseCompound(part) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let rest = part;
  const tagMatch = rest.match(/^(\*|[a-zA-Z][a-zA-Z0-9-]*)/);
  if (tagMatch) {
    out.tag = tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest[0] === "#") {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m) break;
      out.id = m[1];
      rest = rest.slice(m[0].length);
    } else if (rest[0] === ".") {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m) break;
      out.classes.push(m[1]);
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "[") {
      const m = rest.match(/^\[([a-zA-Z0-9_-]+)(?:(\^?=)(?:"([^"]*)"|'([^']*)'))?\]/);
      if (!m) break;
      out.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] !== undefined ? m[3] : m[4] || null });
      rest = rest.slice(m[0].length);
    } else {
      break;
    }
  }
  return out;
}

function parseSelector(selector) {
  return selector.trim().split(/\s+/).map(parseCompound);
}

function matchCompound(el, c) {
  if (c.tag && c.tag !== "*" && el.tagName !== c.tag) return false;
  if (c.id && el.attrs.get("id") !== c.id) return false;
  for (const cls of c.classes) {
    if (!el.classes.has(cls)) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs.get(a.name);
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "^=" && !v.startsWith(a.value)) return false;
  }
  return true;
}

function matchSelector(stack, parts) {
  if (stack.length === 0) return false;
  if (!matchCompound(stack[stack.length - 1], parts[parts.length - 1])) return false;
  let idx = parts.length - 2;
  for (let i = stack.length - 2; i >= 0 && idx >= 0; i--) {
    if (matchCompound(stack[i], parts[idx])) idx--;
  }
  return idx < 0;
}

class HTMLRewriter {
  constructor() {
    this.handlers = [];
  }
  on(selector, handlers) {
    this.handlers.push({ parts: parseSelector(selector), handlers });
    return this;
  }
  transform(response) {
    const done = (async () => {
      const html = await response.text();
      this.run(html);
      return html;
    })();
    return { text: () => done };
  }
  run(html) {
    const stack = [];
    const elementHandlers = this.handlers.filter((h) => h.handlers.element);
    const textHandlers = this.handlers.filter((h) => h.handlers.text);
    const fireEnd = (entry) => {
      for (const fn of entry.endTagHandlers) fn({ name: entry.tagName });
    };
    const emitText = (raw) => {
      if (!raw) return;
      const text = decodeEntities(raw);
      if (!text) return;
      for (const h of textHandlers) {
        if (matchSelector(stack, h.parts)) {
          h.handlers.text({ text, lastInTextNode: true, removed: false });
        }
      }
    };
    const openTag = (tagName, attrs, selfClosing) => {
      const entry = {
        tagName,
        attrs,
        classes: new Set((attrs.get("class") || "").split(/\s+/).filter(Boolean)),
        endTagHandlers: [],
      };
      entry.el = {
        tagName,
        getAttribute(name) {
          const v = attrs.get(String(name).toLowerCase());
          return v === undefined ? null : v;
        },
        onEndTag(fn) { entry.endTagHandlers.push(fn); },
      };
      const isVoid = VOID_TAGS.has(tagName);
      if (!isVoid && !selfClosing) stack.push(entry);
      const checkStack = isVoid || selfClosing ? [...stack, entry] : stack;
      for (const h of elementHandlers) {
        if (matchSelector(checkStack, h.parts)) {
          h.handlers.element(entry.el);
        }
      }
    };
    const closeTag = (tagName) => {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tagName) { idx = i; break; }
      }
      if (idx === -1) return;
      while (stack.length > idx) fireEnd(stack.pop());
    };
    let pos = 0;
    const len = html.length;
    while (pos < len) {
      const lt = html.indexOf("<", pos);
      if (lt === -1) {
        emitText(html.slice(pos));
        pos = len;
        break;
      }
      if (lt > pos) emitText(html.slice(pos, lt));
      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        pos = end === -1 ? len : end + 3;
        continue;
      }
      if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
        const end = html.indexOf(">", lt + 2);
        pos = end === -1 ? len : end + 1;
        continue;
      }
      if (html.startsWith("</", lt)) {
        const m = html.slice(lt).match(/^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>/);
        if (!m) { pos = lt + 2; continue; }
        pos = lt + m[0].length;
        closeTag(m[1].toLowerCase());
        continue;
      }
      const m = html.slice(lt).match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/);
      if (!m) { pos = lt + 1; continue; }
      const tagName = m[1].toLowerCase();
      let p = lt + m[0].length;
      const attrs = new Map();
      let selfClosing = false;
      while (p < len) {
        while (p < len && /\s/.test(html[p])) p++;
        if (p >= len) break;
        if (html[p] === ">") { p++; break; }
        if (html[p] === "/" && html[p + 1] === ">") { selfClosing = true; p += 2; break; }
        if (html[p] === "/") { p++; continue; }
        const am = html.slice(p).match(/^([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/);
        if (!am) { p++; continue; }
        const name = am[1].toLowerCase();
        const value = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
        attrs.set(name, decodeEntities(value));
        p += am[0].length;
      }
      openTag(tagName, attrs, selfClosing);
      if ((tagName === "script" || tagName === "style") && !selfClosing) {
        const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
        const rest = html.slice(p);
        const cm = rest.search(closeRe);
        if (cm === -1) {
          emitText(rest);
          pos = len;
        } else {
          emitText(rest.slice(0, cm));
          pos = p + cm;
        }
      } else {
        pos = p;
      }
    }
    while (stack.length > 0) fireEnd(stack.pop());
  }
}

function parseArgs(argv) {
  const args = {
    query: null,
    cookie: process.env.TIKTOK_COOKIE || null,
    tab: "video",
    scroll: 5,
    raw: false,
    debug: false,
    browser: false,
    html: null,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cookie") args.cookie = argv[++i] ?? null;
    else if (a === "--tab") args.tab = argv[++i] === "top" ? "top" : "video";
    else if (a === "--scroll") args.scroll = Math.max(0, Math.min(10, parseInt(argv[++i] || "5", 10) || 5));
    else if (a === "--raw") args.raw = true;
    else if (a === "--debug") args.debug = true;
    else if (a === "--browser") args.browser = true;
    else if (a === "--html") args.html = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--cookie=")) args.cookie = a.slice("--cookie=".length);
    else if (a.startsWith("--tab=")) args.tab = a.slice("--tab=".length) === "top" ? "top" : "video";
    else if (a.startsWith("--scroll=")) args.scroll = Math.max(0, Math.min(10, parseInt(a.slice("--scroll=".length), 10) || 5));
    else if (a.startsWith("--html=")) args.html = a.slice("--html=".length);
    else if (!a.startsWith("-")) rest.push(a);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (rest.length > 0) args.query = rest.join(" ");
  return args;
}

async function fetchDirect(query, cookie, tab = "video") {
  const targetUrl = searchUrl(query, tab);
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(targetUrl, { headers });
  if (!res.ok) {
    throw new Error(`TikTok returned HTTP ${res.status}`);
  }
  return await res.text();
}

async function fetchWithBrowser(query, cookie, scrolls = 5, tab = "video", debug = false) {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    throw new Error("Browser mode needs puppeteer: run `npm install puppeteer` first");
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      window.chrome = window.chrome || { runtime: {} };
    });
    if (cookie) {
      const cookies = cookie.split(";").map((pair) => {
        const [name, ...rest] = pair.trim().split("=");
        return { name, value: rest.join("="), domain: ".tiktok.com", path: "/" };
      });
      await page.setCookie(...cookies);
    }
    const targetUrl = searchUrl(query, tab);
    await page.goto(searchUrl(query, "top"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    if (tab === "video") {
      const clicked = await page
        .evaluate(() => {
          const btns = Array.from(
            document.querySelectorAll(
              '#search-tabs button[data-testid="tux-web-tab-bar"]'
            )
          );
          const videos = btns.find(
            (b) => (b.textContent || "").trim().toLowerCase() === "videos"
          );
          if (!videos) return false;
          videos.click();
          return true;
        })
        .catch(() => false);
      if (!clicked) {
        await page
          .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    await page.waitForSelector(ITEM_SELECTOR, { timeout: 20000 }).catch(() => {});
    let scrollRounds = 0;
    let noGrowth = 0;
    for (let round = 0; round < scrolls; round++) {
      const before = await page
        .$$eval(ITEM_SELECTOR, (els) => els.length)
        .catch(() => 0);
      await page
        .evaluate(async () => {
          const height = document.body.scrollHeight;
          const step = Math.max(400, Math.floor(height / 3));
          for (let y = 0; y < height; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 250));
          }
          window.scrollTo(0, document.body.scrollHeight);
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const after = await page
        .$$eval(ITEM_SELECTOR, (els) => els.length)
        .catch(() => 0);
      scrollRounds++;
      if (after > before) noGrowth = 0;
      else if (++noGrowth >= 2) break;
    }
    let debugInfo = null;
    if (debug) {
      debugInfo = await page
        .evaluate(() => {
          const e2e = {};
          document.querySelectorAll("[data-e2e]").forEach((el) => {
            const v = el.getAttribute("data-e2e");
            e2e[v] = (e2e[v] || 0) + 1;
          });
          return {
            url: location.href,
            title: document.title,
            e2e,
            videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
            photoLinks: document.querySelectorAll('a[href*="/photo/"]').length,
            bodyText: (document.body.innerText || "").slice(0, 400),
          };
        })
        .catch(() => null);
    }
    const html = await page.content();
    const cookies = await page.cookies().catch(() => []);
    return { html, cookiesKept: cookies.length, sessionReused: false, scrollsDone: scrollRounds, debug: debugInfo };
  } finally {
    await browser.close().catch(() => {});
  }
}

function searchUrl(query, tab) {
  const q = encodeURIComponent(query);
  return tab === "top"
    ? `https://www.tiktok.com/search?q=${q}`
    : `https://www.tiktok.com/search/video?q=${q}`;
}

async function parseTikTokSearchHtml(html, fallbackQuery, includeRawMeta) {
  const items = [];
  const featuredUsersMap = new Map();
  const userPosts = [];
  const tabs = [];
  let pageQuery = fallbackQuery || "";
  let universalDataRaw = "";

  let currentItem = null;
  let currentUserPost = null;
  let readingCount = false;
  let countBuffer = "";
  let readingTabText = false;
  let tabBuffer = "";

  const registerItemHandlers = (rw, cardSelector) => {
    rw.on(cardSelector, {
      element(el) {
        currentItem = {
          index: items.length,
          id: null,
          type: "video",
          url: null,
          authorHandle: null,
          authorName: null,
          caption: null,
          hashtags: [],
          sound: null,
          rawAlt: null,
          thumbnail: null,
          likesOrViewsText: null,
          likesOrViewsCount: null,
          isTopLiked: false,
        };
        el.onEndTag(() => {
          if (currentItem) {
            items.push(currentItem);
            currentItem = null;
          }
        });
      },
    })
      .on(`${cardSelector} a[href]`, {
        element(el) {
          if (!currentItem) return;
          const href = el.getAttribute("href");
          currentItem.url = href;
          const meta = parseItemUrl(href);
          if (meta) {
            currentItem.authorHandle = meta.authorHandle;
            currentItem.type = meta.type;
            currentItem.id = meta.id;
          }
        },
      })
      .on(`${cardSelector} img`, {
        element(el) {
          if (!currentItem) return;
          const alt = el.getAttribute("alt") || "";
          const src = el.getAttribute("src") || "";

          currentItem.rawAlt = alt;
          const parsedAlt = parseAltText(alt);
          currentItem.caption = parsedAlt.caption;
          currentItem.authorName = parsedAlt.authorName;
          currentItem.sound = parsedAlt.sound;
          currentItem.hashtags = extractHashtags(parsedAlt.caption);

          if (src && !src.startsWith("data:image/")) {
            currentItem.thumbnail = src;
          }
        },
      })
      .on(`${cardSelector} .top-liked-label`, {
        element() {
          if (currentItem) currentItem.isTopLiked = true;
        },
      })
      .on(`${cardSelector} [data-e2e="video-views"]`, {
        element() {
          readingCount = true;
          countBuffer = "";
        },
        text(chunk) {
          if (readingCount) countBuffer += chunk.text;
          if (chunk.lastInTextNode && readingCount) {
            if (currentItem) {
              const text = countBuffer.trim();
              currentItem.likesOrViewsText = text;
              currentItem.likesOrViewsCount = parseCompactNumber(text);
            }
            readingCount = false;
          }
        },
      });
  };

  const rewriter = new HTMLRewriter()

    .on('input[name="q"]', {
      element(el) {
        const val = el.getAttribute("value");
        if (val) pageQuery = val;
      },
    })

    .on('#search-tabs button[data-testid="tux-web-tab-bar"] span', {
      element() {
        readingTabText = true;
        tabBuffer = "";
      },
      text(chunk) {
        if (readingTabText) tabBuffer += chunk.text;
        if (chunk.lastInTextNode && readingTabText) {
          const label = tabBuffer.trim();
          if (label) tabs.push(label);
          readingTabText = false;
        }
      },
    })

    .on('div[data-e2e="search_top-item"]', {
      element(el) {
        currentItem = {
          index: items.length,
          id: null,
          type: "video",
          url: null,
          authorHandle: null,
          authorName: null,
          caption: null,
          hashtags: [],
          sound: null,
          rawAlt: null,
          thumbnail: null,
          likesOrViewsText: null,
          likesOrViewsCount: null,
          isTopLiked: false,
        };
        el.onEndTag(() => {
          if (currentItem) {
            items.push(currentItem);
            currentItem = null;
          }
        });
      },
    })
    .on('div[data-e2e="search_top-item"] a[href]', {
      element(el) {
        if (!currentItem) return;
        const href = el.getAttribute("href");
        currentItem.url = href;
        const meta = parseItemUrl(href);
        if (meta) {
          currentItem.authorHandle = meta.authorHandle;
          currentItem.type = meta.type;
          currentItem.id = meta.id;
        }
      },
    })
    .on('div[data-e2e="search_top-item"] img', {
      element(el) {
        if (!currentItem) return;
        const alt = el.getAttribute("alt") || "";
        const src = el.getAttribute("src") || "";

        currentItem.rawAlt = alt;
        const parsedAlt = parseAltText(alt);
        currentItem.caption = parsedAlt.caption;
        currentItem.authorName = parsedAlt.authorName;
        currentItem.sound = parsedAlt.sound;
        currentItem.hashtags = extractHashtags(parsedAlt.caption);

        if (src && !src.startsWith("data:image/")) {
          currentItem.thumbnail = src;
        }
      },
    })
    .on('div[data-e2e="search_top-item"] .top-liked-label', {
      element() {
        if (currentItem) currentItem.isTopLiked = true;
      },
    })
    .on('div[data-e2e="search_top-item"] [data-e2e="video-views"]', {
      element() {
        readingCount = true;
        countBuffer = "";
      },
      text(chunk) {
        if (readingCount) countBuffer += chunk.text;
        if (chunk.lastInTextNode && readingCount) {
          if (currentItem) {
            const text = countBuffer.trim();
            currentItem.likesOrViewsText = text;
            currentItem.likesOrViewsCount = parseCompactNumber(text);
          }
          readingCount = false;
        }
      },
    })

    .on('#search_top-item-list a[href^="/@"]', {
      element(el) {
        const href = el.getAttribute("href");
        if (!href) return;
        const handle = href.replace(/^\/@/, "").split(/[/?#]/)[0];
        if (handle && !featuredUsersMap.has(handle)) {
          featuredUsersMap.set(handle, {
            handle,
            profileUrl: `https://www.tiktok.com/@${handle}`,
            posts: [],
          });
        }
      },
    })

    .on('div[data-e2e="user-post-item"]', {
      element(el) {
        currentUserPost = {
          id: null,
          type: "video",
          url: null,
          authorHandle: null,
          authorName: null,
          caption: null,
          hashtags: [],
          sound: null,
          rawAlt: null,
          thumbnail: null,
        };
        el.onEndTag(() => {
          if (currentUserPost) {
            userPosts.push(currentUserPost);
            currentUserPost = null;
          }
        });
      },
    })
    .on('div[data-e2e="user-post-item"] a[href]', {
      element(el) {
        if (!currentUserPost) return;
        const href = el.getAttribute("href");
        currentUserPost.url = href;
        const meta = parseItemUrl(href);
        if (meta) {
          currentUserPost.authorHandle = meta.authorHandle;
          currentUserPost.type = meta.type;
          currentUserPost.id = meta.id;
        }
      },
    })
    .on('div[data-e2e="user-post-item"] img', {
      element(el) {
        if (!currentUserPost) return;
        const alt = el.getAttribute("alt") || "";
        const src = el.getAttribute("src") || "";

        currentUserPost.rawAlt = alt;
        const parsedAlt = parseAltText(alt);
        currentUserPost.caption = parsedAlt.caption;
        currentUserPost.authorName = parsedAlt.authorName;
        currentUserPost.sound = parsedAlt.sound;
        currentUserPost.hashtags = extractHashtags(parsedAlt.caption);

        if (src && !src.startsWith("data:image/")) {
          currentUserPost.thumbnail = src;
        }
      },
    })

    .on("script#__UNIVERSAL_DATA_FOR_REHYDRATION__", {
      text(chunk) {
        universalDataRaw += chunk.text;
      },
    });

  registerItemHandlers(rewriter, 'div[data-e2e="search_video-item"]');

  await rewriter.transform(new Response(html)).text();

  for (const post of userPosts) {
    if (post.authorHandle) {
      if (!featuredUsersMap.has(post.authorHandle)) {
        featuredUsersMap.set(post.authorHandle, {
          handle: post.authorHandle,
          profileUrl: `https://www.tiktok.com/@${post.authorHandle}`,
          posts: [],
        });
      }
      featuredUsersMap.get(post.authorHandle).posts.push(post);
    }
  }

  let context = null;
  if (universalDataRaw) {
    try {
      const json = JSON.parse(universalDataRaw);
      const scope = json?.__DEFAULT_SCOPE__ || {};
      const appCtx = scope["webapp.app-context"] || {};
      const bizCtx = scope["webapp.biz-context"] || {};

      context = includeRawMeta
        ? json
        : {
            language: appCtx.language,
            region: appCtx.region,
            clusterRegion: appCtx.clusterRegion,
            geoCity: bizCtx.geoCity || null,
            vregion: bizCtx.vregion || null,
            os: bizCtx.os || null,
            user: appCtx.user
              ? {
                  uid: appCtx.user.uid,
                  uniqueId: appCtx.user.uniqueId,
                  nickName: appCtx.user.nickName,
                  region: appCtx.user.region,
                }
              : null,
          };
    } catch {
      context = null;
    }
  }

  return {
    query: pageQuery,
    tabs,
    items,
    featuredUsers: Array.from(featuredUsersMap.values()),
    context,
  };
}

function parseItemUrl(href) {
  if (!href) return null;
  const match = href.match(/tiktok\.com\/@([^/]+)\/(video|photo)\/(\d+)/i);
  if (!match) return null;
  return {
    authorHandle: match[1],
    type: match[2].toLowerCase(),
    id: match[3],
  };
}

function parseAltText(alt) {
  const match = alt.match(/^(.*?)\s+created by\s+(.+?)\s+with\s+(.+)$/s);
  if (!match) {
    return { caption: alt.trim(), authorName: null, sound: null };
  }
  return {
    caption: match[1].trim(),
    authorName: match[2].trim(),
    sound: match[3].trim(),
  };
}

function extractHashtags(text) {
  if (!text) return [];
  return [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]);
}

function parseCompactNumber(str) {
  if (!str) return null;
  const match = str.trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const suffix = (match[2] || "").toUpperCase();
  const multipliers = { "": 1, K: 1e3, M: 1e6, B: 1e9 };
  return Math.round(num * (multipliers[suffix] || 1));
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || (!args.query && !args.html)) {
      process.stdout.write(USAGE + "\n");
      process.exit(args.help ? 0 : 1);
    }
    let html = "";
    let source = "direct-fetch";
    let cookiesKept = null;
    let sessionReused = null;
    let scrollsDone = null;
    let debugInfo = null;
    if (args.html) {
      html = await readFile(args.html, "utf8");
      source = "file-html";
    } else if (args.browser) {
      const rendered = await fetchWithBrowser(args.query, args.cookie, args.scroll, args.tab, args.debug);
      html = rendered.html;
      source = "browser-rendering";
      cookiesKept = rendered.cookiesKept;
      sessionReused = rendered.sessionReused;
      scrollsDone = rendered.scrollsDone;
      debugInfo = rendered.debug;
    } else {
      html = await fetchDirect(args.query, args.cookie, args.tab);
    }
    const parsed = await parseTikTokSearchHtml(html, args.query, args.raw);
    const response = {
      success: true,
      source,
      query: parsed.query || args.query || null,
      totalItems: parsed.items.length,
      totalFeaturedUsers: parsed.featuredUsers.length,
      tab: args.tab,
      ...(cookiesKept !== null ? { cookiesKept, sessionReused, scrolls: scrollsDone } : {}),
      ...(debugInfo ? { debug: debugInfo } : {}),
      ...parsed,
    };
    if (parsed.items.length === 0) {
      response.warning = "TikTok served no results (bot detection / login wall — a real browser gets results even logged out). Set TIKTOK_COOKIE or pass --cookie with a logged-in cookie, or parse a saved search page with --html.";
    }
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, null, 2) + "\n");
    process.exit(1);
  }
}

main();
