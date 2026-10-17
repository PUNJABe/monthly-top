require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const initSqlJs = require('sql.js'); // pure JavaScript SQLite: nothing to compile, installs everywhere

// ---------- config ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'Monthly Top';
const CURRENCY = (process.env.CURRENCY || 'inr').toLowerCase();
// Amounts are stored in the smallest unit (paise). Boosts are whole rupees: 1000 paise = Rs 10.
const MIN_CENTS = parseInt(process.env.MIN_BOOST_CENTS || '1000', 10);
const MAX_CENTS = parseInt(process.env.MAX_BOOST_CENTS || '99999900', 10);
const money = (cents) => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: CURRENCY.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100); }
  catch (e) { return (cents / 100) + ' ' + CURRENCY.toUpperCase(); }
};
const CREATOR = {
  name: process.env.CREATOR_NAME || '',
  handle: process.env.CREATOR_HANDLE || '',
  url: process.env.CREATOR_URL || '',
  bio: process.env.CREATOR_BIO || '',
};
const DF_ID = process.env.DATAFAST_WEBSITE_ID || '';
const DF_KEY = process.env.DATAFAST_API_KEY || '';
const DF_SHARE = process.env.DATAFAST_SHARE_URL || '';
const SITE_TZ = process.env.SITE_TIMEZONE || 'Asia/Kolkata';
let DF_DOMAIN = process.env.DATAFAST_DOMAIN || '';
try { if (!DF_DOMAIN) DF_DOMAIN = new URL(process.env.BASE_URL || '').hostname; } catch (e) { /* none */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_DATA_DIR = process.env.VERCEL ? '/tmp/monthlytop-data' : path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || (stripe ? 'stripe' : 'demo')).toLowerCase();
const YOUPI_API_URL = (process.env.YOUPI_API_URL || '').replace(/\/+$/, '');
const YOUPI_MERCHANT_ID = process.env.YOUPI_MERCHANT_ID || '';
const YOUPI_WEBHOOK_SECRET = process.env.YOUPI_WEBHOOK_SECRET || '';
if (!['demo', 'stripe', 'youpi'].includes(PAYMENT_PROVIDER)) throw new Error('PAYMENT_PROVIDER must be demo, stripe, or youpi.');
const DEMO = PAYMENT_PROVIDER === 'demo';
function youpiConfigError() {
  if (CURRENCY !== 'inr') return 'YOUPI payments require CURRENCY=inr.';
  if (!YOUPI_API_URL || !YOUPI_MERCHANT_ID || !YOUPI_WEBHOOK_SECRET) return 'YOUPI payments are not fully configured.';
  try {
    const url = new URL(YOUPI_API_URL);
    if (url.protocol !== 'https:' && (process.env.VERCEL || process.env.NODE_ENV === 'production')) return 'YOUPI_API_URL must use HTTPS in production.';
  } catch (e) {
    return 'YOUPI_API_URL must be a valid URL.';
  }
  return null;
}
const MAX_CUSTOM_CATEGORIES = 500;
const BOOST_RATE = parseInt(process.env.BOOST_RATE_LIMIT || '10', 10); // boosts per minute per IP

// Built-in categories. People can add more when they list something (see ensureCategory).
// [slug, name, blurb, icon]
const BUILTIN_CATEGORIES = [
  ['ai-agents', 'AI Agents & Infrastructure', 'Agents, LLM tooling and AI platforms', 'bot'],
  ['ai-models', 'AI Models & LLMs', 'Models, APIs and open weights', 'cpu'],
  ['ai-media', 'AI Media Generation', 'Image, video and voice generation', 'sparkle'],
  ['seo', 'SEO & AI Visibility', 'Search rankings and discovery', 'search'],
  ['marketing', 'Marketing & Advertising', 'Campaigns, email and growth tools', 'megaphone'],
  ['sales', 'Sales & Lead Generation', 'Outreach, CRM and prospecting', 'target'],
  ['analytics', 'Analytics & Data', 'Dashboards, metrics and data tools', 'chart'],
  ['crypto', 'Crypto, Web3 & Investing', 'Tokens, wallets, markets and investing', 'coin'],
  ['dev-tools', 'Developer Tools', 'APIs, hosting and building blocks', 'code'],
  ['open-source', 'Open Source & Repos', 'Repositories, libraries and packages', 'branch'],
  ['business', 'Business, Finance & Legal', 'Accounting, payments and legal', 'scale'],
  ['security', 'Security, Privacy & Compliance', 'Protection, privacy and audits', 'shield'],
  ['health', 'Health, Fitness & Wellness', 'Fitness, nutrition and mental health', 'heart'],
  ['social-tools', 'Social Media & Creator Tools', 'Scheduling, growth and creator software', 'share'],
  ['people', 'People & Profiles', 'GitHub, LinkedIn, X and personal profiles', 'user'],
  ['creators', 'Creators & Channels', 'YouTube, Instagram, TikTok and podcasts', 'play'],
  ['hiring', 'Hiring, Jobs & Careers', 'Job boards, recruiting and career tools', 'briefcase'],
  ['education', 'Education & Learning', 'Courses, tutoring and learning tools', 'book'],
  ['agencies', 'Agencies, Studios & Services', 'Agencies, freelancers and studios', 'users'],
  ['ecommerce', 'Ecommerce & Retail', 'Stores, marketplaces and retail tech', 'cart'],
  ['domains', 'Domains & Web Assets', 'Domains, templates and web assets', 'globe'],
  ['games', 'Games & Entertainment', 'Games, fun and entertainment', 'gamepad'],
  ['productivity', 'Productivity & Personal Tools', 'Notes, tasks and everyday tools', 'list'],
  ['product', 'Product Management', 'Roadmaps, feedback and product tools', 'layout'],
  ['design', 'Design & Creative', 'Design, art and creative software', 'palette'],
  ['writing', 'Writing & Content', 'Writing tools, blogs and newsletters', 'pen'],
  ['directories', 'Directories, Launch & Discovery', 'Directories and launch platforms', 'compass'],
  ['audio', 'Audio, Voice & Podcasting', 'Podcasts, voice and audio tools', 'mic'],
  ['apps', 'Apps & Mobile', 'iOS and Android apps', 'phone'],
  ['travel', 'Travel, Local & Lifestyle', 'Travel, local business and lifestyle', 'pin'],
  ['real-estate', 'Real Estate & Property', 'Property, rentals and home services', 'home'],
  ['media-news', 'Media & News', 'News, publications and media', 'news'],
  ['other', 'Everything Else', 'Anything that fits nowhere else', 'grid'],
];

// ---------- platforms: turn any link into one canonical listing key ----------
const PLATFORM_LABELS = {
  website: 'Website', github: 'GitHub', gitlab: 'GitLab', linkedin: 'LinkedIn', instagram: 'Instagram', x: 'X', youtube: 'YouTube',
  tiktok: 'TikTok', facebook: 'Facebook', threads: 'Threads', reddit: 'Reddit', medium: 'Medium', twitch: 'Twitch',
  producthunt: 'Product Hunt', huggingface: 'Hugging Face', playstore: 'Google Play', appstore: 'App Store', npm: 'npm', pypi: 'PyPI',
};
// Sites where the first path segment is the owner (profile pages): host => [platform id, label]
const PATH1_HOSTS = {
  'linktr.ee': ['linktree', 'Linktree'], 'bio.link': ['biolink', 'Bio.link'], 'beacons.ai': ['beacons', 'Beacons'],
  'behance.net': ['behance', 'Behance'], 'dribbble.com': ['dribbble', 'Dribbble'], 'codepen.io': ['codepen', 'CodePen'],
  'pinterest.com': ['pinterest', 'Pinterest'], 'soundcloud.com': ['soundcloud', 'SoundCloud'], 'kaggle.com': ['kaggle', 'Kaggle'],
  'peerlist.io': ['peerlist', 'Peerlist'],
};
for (const [, [id, label]] of Object.entries(PATH1_HOSTS)) PLATFORM_LABELS[id] = label;

const CHAT_HOSTS = ['t.me', 'telegram.me', 'telegram.dog', 'wa.me', 'whatsapp.com', 'discord.gg', 'discord.com', 'discordapp.com', 'm.me', 'messenger.com', 'signal.me', 'signal.group', 'line.me', 'viber.com'];
const SHORTENERS = ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'lnkd.in', 'youtu.be', 'tiny.cc', 'rb.gy', 'bl.ink', 't.ly', 'v.gd', 'smarturl.it', 'fb.me', 'amzn.to', 'wp.me', 'g.co'];
const ADULT_RE = /(porn|xxx|xvideos|xnxx|xhamster|redtube|youporn|onlyfans|fansly|hentai|nsfw|camgirl|chaturbate|stripchat|livejasmin|escort|erotic|brazzers|rule34)/i;

function normalizeTarget(input) {
  let raw = String(input || '').trim();
  if (!raw) return { error: 'Enter a website link or an @handle.' };
  if (raw.length > 300) return { error: 'That link is too long.' };
  if (raw[0] === '@') {
    if (!/^@[A-Za-z0-9_]{1,15}$/.test(raw)) return { error: 'An @handle is 1 to 15 letters, numbers or underscores. For other platforms, paste the full profile link.' };
    raw = 'https://x.com/' + raw.slice(1);
  } else if (/^(javascript|data|vbscript|file|ftp|mailto|tel|blob|sms):/i.test(raw) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw))) {
    return { error: 'Only web links (https://...) are allowed.' };
  } else if (!/^https?:\/\//i.test(raw)) {
    raw = 'https://' + raw;
  }
  let u;
  try { u = new URL(raw); } catch (e) { return { error: 'That does not look like a valid link.' }; }
  if (u.username || u.password) return { error: 'Links with a username or password are not allowed.' };
  if (u.port && u.port !== '80' && u.port !== '443') return { error: 'Links with a custom port are not allowed.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > 100 || !host.includes('.') || /^[0-9.]+$/.test(host) || host.includes(':') || !/^[a-z0-9.-]+$/.test(host) || /(^|\.)(localhost|local|internal|lan|home|corp|invalid)$/.test(host))
    return { error: 'Use a public website address, not an IP address or a local one.' };
  const h = (d) => host === d || host.endsWith('.' + d);
  if (CHAT_HOSTS.some(h)) return { error: 'Chat and invite links (Telegram, WhatsApp, Discord, Signal and similar) are not allowed. List a product website or a profile instead.' };
  if (SHORTENERS.some(h)) return { error: 'Short links are not accepted. Paste the full link.' };
  if (ADULT_RE.test(host)) return { error: 'Adult content is not allowed on this site.' };

  const segs = u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  const s0 = (segs[0] || '').toLowerCase();
  const mk = (key, url, platform, image) => ({ key, url, platform, image: image || null });
  const bad = (m) => ({ error: m });

  if (h('github.com')) {
    const RES = new Set(['features', 'pricing', 'topics', 'orgs', 'marketplace', 'sponsors', 'about', 'login', 'join', 'settings', 'explore', 'notifications', 'search', 'pulls', 'issues', 'new', 'collections', 'events', 'trending', 'codespaces', 'apps', 'enterprise', 'customer-stories', 'readme', 'security', 'site', 'contact']);
    if (!segs[0] || RES.has(s0) || !/^[a-z0-9-]{1,39}$/i.test(segs[0])) return bad('Paste a GitHub profile or repository link, like github.com/name or github.com/name/repo.');
    const SUB = new Set(['followers', 'following', 'repositories', 'stars', 'projects', 'packages', 'sponsoring', 'tab']);
    let repo = segs[1] && !SUB.has(segs[1].toLowerCase()) ? segs[1].replace(/\.git$/i, '') : null;
    if (repo && !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) repo = null;
    const key = 'github.com/' + s0 + (repo ? '/' + repo.toLowerCase() : '');
    return mk(key, 'https://github.com/' + segs[0] + (repo ? '/' + repo : ''), 'github', `https://github.com/${encodeURIComponent(segs[0])}.png?size=80`);
  }
  if (h('gitlab.com')) {
    if (!segs[0] || !/^[a-z0-9._-]{1,100}$/i.test(segs[0])) return bad('Paste a GitLab profile or project link.');
    const proj = segs[1] && /^[A-Za-z0-9._-]{1,100}$/.test(segs[1]) ? segs[1] : null;
    const key = 'gitlab.com/' + s0 + (proj ? '/' + proj.toLowerCase() : '');
    return mk(key, 'https://gitlab.com/' + segs[0] + (proj ? '/' + proj : ''), 'gitlab');
  }
  if (h('linkedin.com')) {
    if (['in', 'company', 'school', 'showcase'].includes(s0) && segs[1] && /^[A-Za-z0-9%._-]{1,100}$/.test(segs[1])) {
      const key = `linkedin.com/${s0}/${segs[1].toLowerCase()}`;
      return mk(key, 'https://www.' + key, 'linkedin');
    }
    return bad('Paste a LinkedIn profile or company link, like linkedin.com/in/name or linkedin.com/company/name.');
  }
  if (h('instagram.com')) {
    const RES = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv', 'about', 'legal', 'developer']);
    if (!segs[0] || RES.has(s0) || !/^[a-z0-9._]{1,30}$/i.test(segs[0])) return bad('Paste an Instagram profile link, like instagram.com/name.');
    return mk('instagram.com/' + s0, `https://www.instagram.com/${segs[0]}/`, 'instagram');
  }
  if (h('x.com') || h('twitter.com')) {
    const RES = new Set(['i', 'home', 'explore', 'search', 'settings', 'intent', 'share', 'hashtag', 'messages', 'notifications', 'login', 'compose', 'tos', 'privacy', 'about']);
    if (!segs[0] || RES.has(s0) || !/^[A-Za-z0-9_]{1,15}$/.test(segs[0])) return bad('Paste an X profile link (x.com/name) or type an @handle.');
    return mk('x.com/' + s0, 'https://x.com/' + segs[0], 'x');
  }
  if (h('youtube.com')) {
    if (segs[0] && segs[0][0] === '@' && /^@[A-Za-z0-9._-]{3,60}$/.test(segs[0])) return mk('youtube.com/' + s0, 'https://www.youtube.com/' + segs[0], 'youtube');
    if (['channel', 'c', 'user'].includes(s0) && segs[1] && /^[A-Za-z0-9._-]{1,80}$/.test(segs[1])) {
      const id = s0 === 'channel' ? segs[1] : segs[1].toLowerCase();
      return mk(`youtube.com/${s0}/${id}`, `https://www.youtube.com/${s0}/${segs[1]}`, 'youtube');
    }
    return bad('Paste a YouTube channel link, like youtube.com/@name. Single videos are not accepted.');
  }
  if (h('tiktok.com')) {
    if (segs[0] && /^@[A-Za-z0-9._]{2,24}$/.test(segs[0])) return mk('tiktok.com/' + s0, 'https://www.tiktok.com/' + segs[0], 'tiktok');
    return bad('Paste a TikTok profile link, like tiktok.com/@name.');
  }
  if (h('facebook.com') || h('fb.com')) {
    const RES = new Set(['profile.php', 'groups', 'sharer', 'share', 'watch', 'events', 'marketplace', 'login', 'dialog', 'plugins', 'hashtag', 'photo', 'photos', 'video', 'videos', 'reel', 'stories', 'permalink.php', 'story.php', 'l.php', 'policy', 'help']);
    if (!segs[0] || RES.has(s0) || !/^[a-z0-9.-]{5,50}$/i.test(segs[0])) return bad('Paste a Facebook page link, like facebook.com/name. Groups and profile.php links are not accepted.');
    return mk('facebook.com/' + s0, 'https://www.facebook.com/' + segs[0], 'facebook');
  }
  if (h('threads.net') || h('threads.com')) {
    if (segs[0] && /^@[A-Za-z0-9._]{1,30}$/.test(segs[0])) return mk('threads.net/' + s0, 'https://www.threads.net/' + segs[0], 'threads');
    return bad('Paste a Threads profile link, like threads.net/@name.');
  }
  if (h('reddit.com')) {
    if (['r', 'u', 'user'].includes(s0) && segs[1] && /^[A-Za-z0-9_-]{2,40}$/.test(segs[1])) {
      const t = s0 === 'r' ? 'r' : 'u';
      return mk(`reddit.com/${t}/${segs[1].toLowerCase()}`, `https://www.reddit.com/${t}/${segs[1]}`, 'reddit');
    }
    return bad('Paste a subreddit or user link, like reddit.com/r/name.');
  }
  if (h('medium.com')) {
    if (segs[0] && !['tag', 'topic', 'm', 'plans', 'membership', 'about', 'jobs-at-medium', 'search'].includes(s0) && /^@?[A-Za-z0-9._-]{1,60}$/.test(segs[0])) return mk('medium.com/' + s0, 'https://medium.com/' + segs[0], 'medium');
    return bad('Paste a Medium profile or publication link.');
  }
  if (h('twitch.tv')) {
    if (segs[0] && !['directory', 'videos', 'downloads', 'p', 'settings', 'turbo', 'jobs', 'store', 'friends'].includes(s0) && /^[A-Za-z0-9_]{2,30}$/.test(segs[0])) return mk('twitch.tv/' + s0, 'https://www.twitch.tv/' + segs[0], 'twitch');
    return bad('Paste a Twitch channel link, like twitch.tv/name.');
  }
  if (h('producthunt.com')) {
    if (s0 === 'products' && segs[1] && /^[A-Za-z0-9_-]{1,80}$/.test(segs[1])) return mk('producthunt.com/products/' + segs[1].toLowerCase(), 'https://www.producthunt.com/products/' + segs[1], 'producthunt');
    return bad('Paste a Product Hunt product link, like producthunt.com/products/name.');
  }
  if (h('huggingface.co')) {
    const RES = new Set(['models', 'docs', 'blog', 'pricing', 'join', 'login', 'settings', 'papers', 'tasks', 'collections', 'organizations', 'chat', 'learn', 'enterprise']);
    if (['spaces', 'datasets'].includes(s0)) {
      if (segs[1] && segs[2] && /^[A-Za-z0-9._-]{1,96}$/.test(segs[1]) && /^[A-Za-z0-9._-]{1,96}$/.test(segs[2])) {
        const key = `huggingface.co/${s0}/${segs[1].toLowerCase()}/${segs[2].toLowerCase()}`;
        return mk(key, `https://huggingface.co/${s0}/${segs[1]}/${segs[2]}`, 'huggingface');
      }
      return bad('Paste the full Hugging Face link, like huggingface.co/spaces/owner/name.');
    }
    if (!segs[0] || RES.has(s0) || !/^[A-Za-z0-9._-]{1,96}$/.test(segs[0])) return bad('Paste a Hugging Face model or profile link, like huggingface.co/owner/model.');
    const model = segs[1] && /^[A-Za-z0-9._-]{1,96}$/.test(segs[1]) ? segs[1] : null;
    const key = 'huggingface.co/' + s0 + (model ? '/' + model.toLowerCase() : '');
    return mk(key, 'https://huggingface.co/' + segs[0] + (model ? '/' + model : ''), 'huggingface');
  }
  if (h('play.google.com')) {
    const id = u.searchParams.get('id') || '';
    if (u.pathname.startsWith('/store/apps/details') && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(id)) {
      const key = 'play.google.com/store/apps/details?id=' + id.toLowerCase();
      return mk(key, 'https://play.google.com/store/apps/details?id=' + id, 'playstore');
    }
    return bad('Paste a Google Play app link, like play.google.com/store/apps/details?id=com.name.app.');
  }
  if (h('apps.apple.com')) {
    const idSeg = segs.find((x) => /^id\d{3,}$/.test(x));
    if (idSeg) return mk('apps.apple.com/app/' + idSeg, 'https://apps.apple.com/app/' + idSeg, 'appstore');
    return bad('Paste an App Store app link (it contains /id and a number).');
  }
  if (h('npmjs.com')) {
    const name = segs.slice(1, 3).join('/');
    if (s0 === 'package' && /^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+$/i.test(name.replace(/%40/g, '@'))) return mk('npmjs.com/package/' + name.toLowerCase(), 'https://www.npmjs.com/package/' + name, 'npm');
    return bad('Paste an npm package link, like npmjs.com/package/name.');
  }
  if (h('pypi.org')) {
    if (s0 === 'project' && segs[1] && /^[A-Za-z0-9._-]{1,100}$/.test(segs[1])) return mk('pypi.org/project/' + segs[1].toLowerCase(), 'https://pypi.org/project/' + segs[1] + '/', 'pypi');
    return bad('Paste a PyPI project link, like pypi.org/project/name.');
  }
  for (const [domain, [id, label]] of Object.entries(PATH1_HOSTS)) {
    if (h(domain)) {
      if (segs[0] && /^[A-Za-z0-9._@-]{1,60}$/.test(segs[0])) return mk(`${domain}/${s0}`, `https://${domain}/${segs[0]}`, id);
      return bad(`Paste a ${label} profile link, like ${domain}/name.`);
    }
  }
  // Any other site is a website, identified by its domain. The listing links to the homepage.
  return mk(host, 'https://' + host + '/', 'website', `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`);
}

// ---------- database ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'data.db');

// Small better-sqlite3-style wrapper over sql.js. The whole database is saved to DB_FILE after every write
// (atomic temp-file + rename), so a crash can never leave a half-written file.
let db;
async function openDb(file) {
  const SQL = await initSqlJs();
  const raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  const persist = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(raw.export()));
    fs.renameSync(tmp, file);
  };
  const toBind = (args) => {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const o = {};
      for (const k of Object.keys(args[0])) o['@' + k] = args[0][k] === undefined ? null : args[0][k];
      return o;
    }
    return args.map((v) => (v === undefined ? null : v));
  };
  return {
    exec(sql) { raw.exec(sql); persist(); },
    prepare(sql) {
      return {
        get(...args) {
          const st = raw.prepare(sql);
          try { if (args.length) st.bind(toBind(args)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
        },
        all(...args) {
          const st = raw.prepare(sql);
          try { if (args.length) st.bind(toBind(args)); const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; } finally { st.free(); }
        },
        run(...args) {
          const st = raw.prepare(sql);
          try { if (args.length) st.bind(toBind(args)); st.step(); } finally { st.free(); }
          const changes = raw.getRowsModified();
          const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
          persist();
          return { changes, lastInsertRowid };
        },
      };
    },
  };
}

async function initDb() {
  db = await openDb(DB_FILE);
  // Earlier versions of this project ranked songs. Keep a backup copy, then start the listings schema.
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='songs'").get()) {
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.songs-backup'); } catch (e) { /* best effort */ }
    db.exec('DROP TABLE IF EXISTS songs; DROP TABLE IF EXISTS boosts;');
    console.log('Upgraded from the songs version. A backup of the old data is in ' + DB_FILE + '.songs-backup');
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT, icon TEXT,
  builtin INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, url TEXT NOT NULL, platform TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, image TEXT,
  category TEXT, pending_category TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS boosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, stripe_payment_intent TEXT,
  payment_session TEXT, payment_reference TEXT,
  display_name TEXT, message TEXT, email TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_boosts_period ON boosts(period, status);
CREATE INDEX IF NOT EXISTS idx_boosts_listing ON boosts(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
INSERT OR IGNORE INTO meta (k, v) VALUES ('launched_at', datetime('now'));
`);
  const boostColumns = new Set(db.prepare('PRAGMA table_info(boosts)').all().map((column) => column.name));
  if (!boostColumns.has('payment_session')) db.exec('ALTER TABLE boosts ADD COLUMN payment_session TEXT');
  if (!boostColumns.has('payment_reference')) db.exec('ALTER TABLE boosts ADD COLUMN payment_reference TEXT');
  BUILTIN_CATEGORIES.forEach(([slug, name, blurb, icon], i) => {
    db.prepare('INSERT OR IGNORE INTO categories (slug,name,blurb,icon,builtin,sort) VALUES (?,?,?,?,1,?)').run(slug, name, blurb, icon, slug === 'other' ? 2000 : (i + 1) * 10);
  });

  if (DEMO) {
    // A few clearly fictional listings so the site is browsable before launch. They never appear once a Stripe key is set.
    if (db.prepare('SELECT COUNT(*) c FROM listings').get().c === 0) {
      const demo = [
        ['pingboard.example', 'Pingboard', 'Uptime monitoring with plain-English alerts.', 'dev-tools'],
        ['northwind-analytics.example', 'Northwind Analytics', 'Simple website analytics that respects privacy.', 'analytics'],
        ['lumen-llm.example', 'Lumen LLM', 'An open-weight language model for small teams.', 'ai-models'],
        ['agentry.example', 'Agentry', 'Build and deploy AI agents without glue code.', 'ai-agents'],
        ['paperplane-mail.example', 'Paperplane Mail', 'Email campaigns that feel hand-written.', 'marketing'],
        ['kestrel-studio.example', 'Kestrel Studio', 'A small design studio for software brands.', 'agencies'],
        ['fernleaf.example', 'Fernleaf Health', 'Daily habit coaching for better sleep and energy.', 'health'],
        ['ledgerly.example', 'Ledgerly', 'Bookkeeping for freelancers, done in minutes.', 'business'],
        ['quillandco.example', 'Quill & Co', 'A newsletter on writing clearly at work.', 'writing'],
        ['tideline-travel.example', 'Tideline Travel', 'Slow-travel itineraries for coastal towns.', 'travel'],
        ['sparkcast.example', 'Sparkcast', 'Turn a voice memo into a polished podcast episode.', 'audio'],
        ['orbit-learn.example', 'Orbit Learn', 'Short interactive courses on data and design.', 'education'],
      ];
      const ins = db.prepare("INSERT INTO listings (id,key,url,platform,title,description,image,category,live,is_demo) VALUES (?,?,?,?,?,?,NULL,?,1,1)");
      demo.forEach(([key, title, desc, cat]) => ins.run('demo-' + key.split('.')[0], key, 'https://' + key + '/', 'website', title, desc, cat));
    }
  } else {
    // Going live: drop everything created while testing in demo mode.
    db.exec(`DELETE FROM boosts WHERE is_demo=1;
DELETE FROM listings WHERE is_demo=1 AND id NOT IN (SELECT listing_id FROM boosts);
DELETE FROM categories WHERE is_demo=1 AND slug NOT IN (SELECT category FROM listings WHERE category IS NOT NULL);`);
  }
}

// ---------- helpers ----------
// The "month" and "today" follow SITE_TIMEZONE (default India Standard Time), not UTC.
const localDay = () => new Date().toLocaleDateString('en-CA', { timeZone: SITE_TZ }); // YYYY-MM-DD
const currentPeriod = () => localDay().slice(0, 7); // YYYY-MM in the site's timezone
const tzOffsetMs = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000;
};
const sqlTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const startOfTodayUTC = () => { const [y, m, d] = localDay().split('-').map(Number); return sqlTs(Date.UTC(y, m - 1, d) - tzOffsetMs()); };
const monthEndsAt = () => { const [y, m] = currentPeriod().split('-').map(Number); return new Date(Date.UTC(y, m, 1) - tzOffsetMs()).toISOString(); };
const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const newId = () => crypto.randomBytes(6).toString('hex');
const decorate = (r) => ({ ...r, platform_label: PLATFORM_LABELS[r.platform] || 'Website', display: r.key });

const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k); }, 600000).unref();

// ---------- categories ----------
const slugify = (n) => {
  const s = n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'c-' + crypto.createHash('sha1').update(n.toLowerCase()).digest('hex').slice(0, 8);
};
function validCategoryName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 32) return { error: 'A category name must be 2 to 32 characters.' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &,'./+-]*$/u.test(n)) return { error: "Category names can only use letters, numbers, spaces and & , ' . / + -" };
  if (/^[\d\s]+$/.test(n)) return { error: 'A category name needs some letters.' };
  if (ADULT_RE.test(n)) return { error: 'That category name is not allowed.' };
  n = n[0].toUpperCase() + n.slice(1);
  return { name: n };
}
const findCategoryByName = (name) => db.prepare('SELECT * FROM categories WHERE LOWER(name)=LOWER(?)').get(name);
const categoryExists = (slug) => !!db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug);
const customCategoryCount = () => db.prepare('SELECT COUNT(*) n FROM categories WHERE builtin=0').get().n;
function ensureCategory(name, isDemo) {
  const ex = findCategoryByName(name);
  if (ex) return ex.slug;
  let slug = slugify(name);
  if (categoryExists(slug)) slug += '-' + crypto.randomBytes(2).toString('hex');
  db.prepare("INSERT INTO categories (slug,name,blurb,icon,builtin,is_demo,sort) VALUES (?,?,?,?,0,?,1000)").run(slug, name, 'Added by the community', 'tag', isDemo ? 1 : 0);
  return slug;
}
const listCategories = () => db.prepare('SELECT slug,name,blurb,icon,builtin FROM categories ORDER BY sort, name').all();

// ---------- queries ----------
const COLS = `l.id, l.title, l.description, l.url, l.key, l.platform, l.image, COALESCE(l.category,'other') AS category`;
// period: 'YYYY-MM' for a month, or 'all' for all time. category: optional slug.
function leaderboard(period, limit = 50, category = null) {
  const where = ["b.status='paid'", 'l.hidden=0', 'l.live=1'];
  const args = [];
  if (period !== 'all') { where.push('b.period=?'); args.push(period); }
  if (category) { where.push("COALESCE(l.category,'other')=?"); args.push(category); }
  args.push(limit);
  return db.prepare(`
    SELECT ${COLS},
           SUM(b.amount_cents) AS total_cents, COUNT(b.id) AS boosts, COUNT(DISTINCT COALESCE(NULLIF(b.email,''), b.id)) AS supporters,
           MAX(b.paid_at) AS last_boost_at
    FROM boosts b JOIN listings l ON l.id = b.listing_id
    WHERE ${where.join(' AND ')}
    GROUP BY l.id ORDER BY total_cents DESC, MIN(b.paid_at) ASC LIMIT ?`).all(...args)
    .map((r, i) => decorate({ ...r, rank: i + 1 }));
}
function listingTotals(id, category) {
  const p = currentPeriod();
  const month = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE listing_id=? AND status='paid' AND period=?`).get(id, p);
  const all = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE listing_id=? AND status='paid'`).get(id);
  const rank = leaderboard(p, 1000).find((r) => r.id === id);
  const crank = category ? leaderboard(p, 1000, category).find((r) => r.id === id) : null;
  return { month_cents: month.c, month_boosts: month.n, all_cents: all.c, all_boosts: all.n, rank: rank ? rank.rank : null, category_rank: crank ? crank.rank : null };
}
function categoryOverview() {
  const p = currentPeriod();
  const items = listCategories().map((c) => {
    const act = db.prepare(`SELECT COUNT(*) n, MAX(b.paid_at) last FROM boosts b JOIN listings l ON l.id=b.listing_id WHERE b.status='paid' AND b.period=? AND l.hidden=0 AND l.live=1 AND COALESCE(l.category,'other')=?`).get(p, c.slug);
    const listings = db.prepare(`SELECT COUNT(*) n FROM listings WHERE hidden=0 AND live=1 AND COALESCE(category,'other')=?`).get(c.slug).n;
    return { ...c, top: leaderboard(p, 3, c.slug), boosts_month: act.n, last_boost_at: act.last || null, listings };
  });
  const hot = items.filter((c) => c.boosts_month > 0).sort((a, b) => (b.last_boost_at > a.last_boost_at ? 1 : -1)).slice(0, 3);
  return { items, hot };
}
function markPaid(boostId, session) {
  const b = db.prepare('SELECT * FROM boosts WHERE id=?').get(boostId);
  if (!b || b.status === 'paid') return b;
  if (PAYMENT_PROVIDER === 'youpi') {
    db.prepare(`UPDATE boosts SET status='paid', paid_at=datetime('now'), payment_reference=COALESCE(?,payment_reference) WHERE id=?`)
      .run(session && session.payment_reference ? String(session.payment_reference) : null, boostId);
  } else {
    db.prepare(`UPDATE boosts SET status='paid', paid_at=datetime('now'), stripe_payment_intent=COALESCE(?,stripe_payment_intent) WHERE id=?`)
      .run(session && session.payment_intent ? String(session.payment_intent) : null, boostId);
  }
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
  if (l) {
    // The listing goes live, and a brand-new category is created only now that someone has actually paid.
    let cat = l.category;
    if (l.pending_category) cat = ensureCategory(l.pending_category, b.is_demo);
    db.prepare('UPDATE listings SET live=1, category=?, pending_category=NULL WHERE id=?').run(cat || 'other', l.id);
  }
  return db.prepare('SELECT * FROM boosts WHERE id=?').get(boostId);
}
setInterval(() => {
  try { db.exec("DELETE FROM listings WHERE live=0 AND created_at < datetime('now','-3 day') AND id NOT IN (SELECT listing_id FROM boosts WHERE status='paid')"); } catch (e) { /* retry later */ }
}, 3600000).unref();

// ---------- visitors: DataFast when configured, otherwise a built-in cookieless counter ----------
const VISITS_FILE = path.join(DATA_DIR, 'visits.json');
const todayLocal = localDay; // visitor 'today' follows the site timezone too
let visits = { days: {} };
try { visits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8')); if (!visits.days) visits = { days: {} }; } catch (e) { /* first run */ }
let seenToday = new Set(), seenDay = todayLocal(), daySalt = crypto.randomBytes(16).toString('hex'), dirty = false;
const lastSeen = new Map();
function trackVisit(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || /bot|crawl|spider|slurp|preview|monitor|curl|wget|headless|facebookexternalhit/i.test(ua)) return;
  const day = todayLocal();
  if (day !== seenDay) { seenDay = day; seenToday = new Set(); daySalt = crypto.randomBytes(16).toString('hex'); }
  // Daily-salted hash: not reversible and not linkable across days. No cookies, no IP stored.
  const h = crypto.createHash('sha256').update(daySalt + req.ip + ua).digest('hex').slice(0, 24);
  lastSeen.set(h, Date.now());
  if (!seenToday.has(h)) { seenToday.add(h); visits.days[day] = seenToday.size; dirty = true; }
}
function flushVisits() {
  if (!dirty) return;
  try { fs.writeFileSync(VISITS_FILE + '.tmp', JSON.stringify(visits)); fs.renameSync(VISITS_FILE + '.tmp', VISITS_FILE); dirty = false; } catch (e) { /* retry next tick */ }
}
setInterval(() => {
  flushVisits();
  const cut = Date.now() - 600000;
  for (const [k, t] of lastSeen) if (t < cut) lastSeen.delete(k);
}, 30000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushVisits(); process.exit(0); });
process.on('exit', flushVisits);

function builtinVisitors() {
  const cut = Date.now() - 5 * 60000;
  let online = 0;
  for (const t of lastSeen.values()) if (t >= cut) online++;
  const total = Object.values(visits.days).reduce((a, b) => a + b, 0);
  return { source: 'builtin', online, today: seenToday.size, total };
}
async function dfGet(p) {
  const r = await fetch((process.env.DATAFAST_API_URL || 'https://datafa.st/api/v1').replace(/\/$/, '') + '/' + p, { headers: { Authorization: 'Bearer ' + DF_KEY } });
  if (!r.ok) throw new Error('DataFast ' + r.status);
  const j = await r.json();
  return j && j.data && j.data[0] ? Number(j.data[0].visitors) || 0 : 0;
}
let vCache = { t: 0, data: null };
async function getVisitors() {
  if (vCache.data && Date.now() - vCache.t < 30000) return vCache.data;
  let data;
  if (DF_KEY) {
    try {
      const d = new Date().toLocaleDateString('en-CA', { timeZone: SITE_TZ }); // YYYY-MM-DD in the site's timezone
      const tz = encodeURIComponent(SITE_TZ);
      const [online, today, total] = await Promise.all([
        dfGet('analytics/realtime'),
        dfGet(`analytics/overview?startAt=${d}&endAt=${d}&timezone=${tz}`),
        dfGet('analytics/overview'),
      ]);
      data = { source: 'datafast', online, today, total };
    } catch (e) {
      console.error('DataFast API error, using built-in counter:', e.message);
    }
  }
  data = data || builtinVisitors();
  vCache = { t: Date.now(), data };
  return data;
}

// ---------- app ----------
const app = express();
const dbReady = initDb();
module.exports = app;
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use((req, res, next) => {
  dbReady.then(
    () => next(),
    () => res.status(503).send('Service temporarily unavailable')
  );
});

// Stripe webhook needs the raw body, so it is registered before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send('Webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send('Bad signature');
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    if (s.payment_status === 'paid' && s.metadata && s.metadata.boost_id) markPaid(Number(s.metadata.boost_id), s);
  }
  res.json({ received: true });
});

app.post('/api/youpi/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (PAYMENT_PROVIDER !== 'youpi' || !YOUPI_WEBHOOK_SECRET) return res.status(404).end();
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Expected a raw JSON body.' });
  const signature = String(req.headers['x-gateway-signature'] || '');
  const hexSignature = signature.startsWith('sha256=') ? signature.slice(7) : '';
  if (!/^[a-f0-9]{64}$/i.test(hexSignature)) return res.status(401).json({ error: 'Invalid signature.' });
  const expected = crypto.createHmac('sha256', YOUPI_WEBHOOK_SECRET).update(req.body).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hexSignature, 'hex'))) return res.status(401).json({ error: 'Invalid signature.' });

  let event;
  try { event = JSON.parse(req.body.toString('utf8')); }
  catch (e) { return res.status(400).json({ error: 'Invalid JSON.' }); }
  const terminalStatuses = { FAILED: 'failed', EXPIRED: 'expired', CANCELLED: 'cancelled' };
  if (event.event !== 'SUCCESS' && !terminalStatuses[event.event]) return res.status(400).json({ error: 'Unknown payment event.' });
  const orderMatch = /^monthlytop-boost-(\d+)$/.exec(String(event.orderId || ''));
  if (!orderMatch || !event.paymentId) return res.status(400).json({ error: 'Invalid payment reference.' });
  const boostId = Number(orderMatch[1]);
  const boost = db.prepare('SELECT id,status,amount_cents,currency,payment_session FROM boosts WHERE id=?').get(boostId);
  if (!boost || boost.payment_session !== String(event.paymentId)) return res.status(404).json({ error: 'Payment not found.' });
  if (Number(event.amountPaise) !== boost.amount_cents || String(event.currency || '').toLowerCase() !== boost.currency.toLowerCase())
    return res.status(400).json({ error: 'Payment amount or currency mismatch.' });

  if (event.event === 'SUCCESS') markPaid(boostId, { payment_reference: String(event.paymentId) });
  else db.prepare('UPDATE boosts SET status=? WHERE id=? AND status=\'pending\'').run(terminalStatuses[event.event], boostId);
  res.json({ received: true });
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && (req.path === '/' || !path.extname(req.path) || req.path.endsWith('.html'))) trackVisit(req);
  next();
});
app.use(express.json({ limit: '20kb' }));

app.get('/api/config', (req, res) => {
  res.json({
    siteName: SITE_NAME, currency: CURRENCY, minCents: MIN_CENTS, maxCents: MAX_CENTS, demo: DEMO, paymentProvider: PAYMENT_PROVIDER, period: currentPeriod(),
    categories: listCategories(), platforms: PLATFORM_LABELS, creator: CREATOR, timezone: SITE_TZ,
    datafast: { websiteId: DF_ID, domain: DF_DOMAIN, shareUrl: DF_SHARE },
  });
});

app.get('/api/stats', (req, res) => {
  const p = currentPeriod();
  const m = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE status='paid' AND period=?`).get(p);
  const inRace = db.prepare(`SELECT COUNT(DISTINCT listing_id) n FROM boosts WHERE status='paid' AND period=?`).get(p).n;
  const listed = db.prepare('SELECT COUNT(*) n FROM listings WHERE hidden=0 AND live=1').get().n;
  res.json({ period: p, raised_cents: m.c, boosts: m.n, in_race: inRace, listed, ends_at: monthEndsAt() });
});

app.get('/api/visitors', async (req, res) => {
  try { res.json(await getVisitors()); } catch (e) { res.json(builtinVisitors()); }
});

app.get('/api/about', async (req, res) => {
  const all = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE status='paid'`).get();
  const today = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE status='paid' AND paid_at >= ?`).get(startOfTodayUTC());
  const topAll = leaderboard('all', 1)[0] || null;
  const listed = db.prepare('SELECT COUNT(*) n FROM listings WHERE hidden=0 AND live=1').get().n;
  const addedToday = db.prepare(`SELECT COUNT(*) n FROM listings WHERE hidden=0 AND live=1 AND created_at >= ?`).get(startOfTodayUTC()).n;
  const launched = db.prepare("SELECT v FROM meta WHERE k='launched_at'").get();
  let visitors; try { visitors = await getVisitors(); } catch (e) { visitors = builtinVisitors(); }
  res.json({
    visitors, raised_cents: all.c, boosts: all.n, raised_today_cents: today.c, boosts_today: today.n,
    top_all: topAll ? { id: topAll.id, title: topAll.title, total_cents: topAll.total_cents } : null,
    listed, added_today: addedToday, launched_at: launched ? launched.v.replace(' ', 'T') + 'Z' : null,
  });
});

app.get('/api/categories', (req, res) => res.json(categoryOverview()));

app.get('/api/leaderboard', (req, res) => {
  const period = req.query.period === 'all' ? 'all' : isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const category = req.query.category && categoryExists(String(req.query.category)) ? String(req.query.category) : null;
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
  res.json({ period, category, items: leaderboard(period, limit, category) });
});

// Check a link before payment: is it allowed, what is it, and is it already listed?
app.get('/api/lookup', (req, res) => {
  if (!rateLimit('l:' + req.ip, 90, 60000)) return res.status(429).json({ error: 'Too many checks. Slow down a little.' });
  const t = normalizeTarget(req.query.url);
  if (t.error) return res.json({ ok: false, error: t.error });
  const l = db.prepare('SELECT * FROM listings WHERE key=?').get(t.key);
  let existing = null;
  if (l && l.hidden) return res.json({ ok: false, error: 'This listing has been removed from the site.' });
  if (l && l.live) {
    const tot = listingTotals(l.id, l.category || 'other');
    existing = { id: l.id, title: l.title, description: l.description, category: l.category || 'other', rank: tot.rank, month_cents: tot.month_cents, all_cents: tot.all_cents };
  }
  res.json({ ok: true, key: t.key, url: t.url, platform: t.platform, platform_label: PLATFORM_LABELS[t.platform] || 'Website', image: t.image, existing });
});

app.get('/api/listings', (req, res) => {
  const q = clean(req.query.q, 100);
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const per = 24;
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const where = ['l.hidden=0', 'l.live=1'];
  const args = [];
  if (q) { where.push('(l.title LIKE ? OR l.description LIKE ? OR l.key LIKE ?)'); args.push(like, like, like); }
  const cat = req.query.category && categoryExists(String(req.query.category)) ? String(req.query.category) : null;
  if (cat) { where.push("COALESCE(l.category,'other')=?"); args.push(cat); }
  const plat = clean(req.query.platform, 30);
  if (plat && PLATFORM_LABELS[plat]) { where.push('l.platform=?'); args.push(plat); }
  const total = db.prepare(`SELECT COUNT(*) n FROM listings l WHERE ${where.join(' AND ')}`).get(...args).n;
  const items = db.prepare(`
    SELECT ${COLS},
      COALESCE((SELECT SUM(amount_cents) FROM boosts b WHERE b.listing_id=l.id AND b.status='paid'),0) AS all_cents,
      COALESCE((SELECT SUM(amount_cents) FROM boosts b WHERE b.listing_id=l.id AND b.status='paid' AND b.period=?),0) AS month_cents
    FROM listings l WHERE ${where.join(' AND ')} ORDER BY month_cents DESC, all_cents DESC, l.title ASC LIMIT ? OFFSET ?`)
    .all(currentPeriod(), ...args, per, (page - 1) * per).map(decorate);
  res.json({ items, total, page, pages: Math.max(Math.ceil(total / per), 1) });
});

app.get('/api/listings/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0 AND live=1').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const cat = l.category || 'other';
  const supporters = db.prepare(`SELECT display_name, message, amount_cents, paid_at FROM boosts WHERE listing_id=? AND status='paid' ORDER BY paid_at DESC LIMIT 15`).all(l.id)
    .map((b) => ({ ...b, display_name: b.display_name || 'Anonymous' }));
  res.json({ listing: decorate({ id: l.id, title: l.title, description: l.description, url: l.url, key: l.key, platform: l.platform, image: l.image, category: cat }), totals: listingTotals(l.id, cat), supporters });
});

app.get('/api/archive', (req, res) => {
  const periods = db.prepare(`SELECT DISTINCT period FROM boosts WHERE status='paid' AND period<>? ORDER BY period DESC LIMIT 36`).all(currentPeriod());
  res.json({ items: periods.map((p) => ({ period: p.period, top: leaderboard(p.period, 3) })) });
});

app.post('/api/boost', async (req, res) => {
  if (!rateLimit('b:' + req.ip, BOOST_RATE, 60000)) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  const b = req.body || {};
  const amount = Math.round(Number(b.amountCents));
  const email = clean(b.email, 200);
  if (!Number.isFinite(amount) || amount < MIN_CENTS || amount > MAX_CENTS)
    return res.status(400).json({ error: `A boost must be between ${money(MIN_CENTS)} and ${money(MAX_CENTS)}.` });
  if (amount % 100 !== 0) return res.status(400).json({ error: 'Boosts are in whole rupees, with no paise.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'A valid email is required for your receipt.' });
  if (!b.acceptTerms) return res.status(400).json({ error: 'Please accept the Terms to continue.' });
  const providerError = PAYMENT_PROVIDER === 'youpi' ? youpiConfigError() : PAYMENT_PROVIDER === 'stripe' && !stripe ? 'Stripe payments are not configured.' : null;
  if (providerError) return res.status(503).json({ error: providerError });

  try {
    let listing;
    if (b.listingId) {
      // Boosting something that is already on the chart. Its details are fixed.
      listing = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0 AND live=1').get(clean(b.listingId, 40));
      if (!listing) return res.status(404).json({ error: 'That listing was not found.' });
    } else {
      const t = normalizeTarget(b.url);
      if (t.error) return res.status(400).json({ error: t.error });
      listing = db.prepare('SELECT * FROM listings WHERE key=?').get(t.key);
      if (listing && listing.hidden) return res.status(400).json({ error: 'This listing has been removed from the site.' });
      if (!listing || !listing.live) {
        // A new listing: whoever pays first sets its title, description and category. They are locked after that.
        const title = clean(b.title, 70), description = clean(b.description, 160);
        if (title.length < 2) return res.status(400).json({ error: 'Add a name for your listing (2 to 70 characters).' });
        if (description.length < 10) return res.status(400).json({ error: 'Say what it does in a sentence (10 to 160 characters).' });
        if (ADULT_RE.test(title + ' ' + description)) return res.status(400).json({ error: 'Adult content is not allowed on this site.' });
        let category = null, pending = null;
        const newName = clean(b.newCategory, 80), slug = clean(b.category, 60);
        if (newName) {
          const v = validCategoryName(newName);
          if (v.error) return res.status(400).json({ error: v.error });
          const ex = findCategoryByName(v.name);
          if (ex) category = ex.slug; // already exists, so just use it
          else if (customCategoryCount() >= MAX_CUSTOM_CATEGORIES) return res.status(400).json({ error: 'We have reached the limit for new categories. Please pick an existing one.' });
          else pending = v.name; // created only once the payment completes
        } else if (slug && categoryExists(slug)) category = slug;
        else return res.status(400).json({ error: 'Pick a category, or create a new one.' });
        if (!listing) {
          listing = { id: newId() };
          db.prepare('INSERT INTO listings (id,key,url,platform,title,description,image,category,pending_category,live,is_demo) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
            .run(listing.id, t.key, t.url, t.platform, title, description, t.image, category, pending, DEMO ? 1 : 0);
        } else {
          db.prepare('UPDATE listings SET url=?, platform=?, title=?, description=?, image=?, category=?, pending_category=? WHERE id=?')
            .run(t.url, t.platform, title, description, t.image, category, pending, listing.id);
        }
        listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listing.id);
      }
    }

    const info = db.prepare(`INSERT INTO boosts (listing_id,amount_cents,currency,period,display_name,message,email,is_demo) VALUES (?,?,?,?,?,?,?,?)`)
      .run(listing.id, amount, CURRENCY, currentPeriod(), clean(b.displayName, 40) || null, clean(b.message, 140) || null, email, DEMO ? 1 : 0);
    const boostId = info.lastInsertRowid;

    if (DEMO) return res.json({ url: `/demo-checkout.html?boost=${boostId}`, demo: true });

    if (PAYMENT_PROVIDER === 'youpi') {
      const response = await fetch(`${YOUPI_API_URL}/api/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Id': YOUPI_MERCHANT_ID,
          'Idempotency-Key': `monthlytop-boost-${boostId}`,
        },
        body: JSON.stringify({
          orderId: `monthlytop-boost-${boostId}`,
          amount: (amount / 100).toFixed(2),
          currency: 'INR',
          customer: { email },
          description: `Monthly Top boost: ${listing.title}`.slice(0, 250),
          returnUrl: `${BASE_URL}/success.html?boost=${boostId}`,
          metadata: { boostId: String(boostId), listingId: String(listing.id) },
        }),
      });
      if (!response.ok) throw new Error(`YOUPI API returned ${response.status}`);
      const session = await response.json();
      if (!session.paymentId || !session.checkoutUrl) throw new Error('YOUPI returned an incomplete checkout session');
      const checkoutUrl = new URL(session.checkoutUrl);
      if (checkoutUrl.origin !== new URL(YOUPI_API_URL).origin || checkoutUrl.protocol !== 'https:' && (process.env.VERCEL || process.env.NODE_ENV === 'production'))
        throw new Error('YOUPI returned an untrusted checkout URL');
      db.prepare('UPDATE boosts SET payment_session=? WHERE id=?').run(String(session.paymentId), boostId);
      return res.json({ url: checkoutUrl.href });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: amount,
          product_data: { name: `Boost: ${listing.title}`.slice(0, 250), description: `${listing.key} · ${currentPeriod()} chart`.slice(0, 350) },
        },
      }],
      metadata: { boost_id: String(boostId), listing_id: listing.id },
      success_url: `${BASE_URL}/success.html?boost=${boostId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: listing.live ? `${BASE_URL}/listing.html?id=${encodeURIComponent(listing.id)}&cancelled=1` : `${BASE_URL}/boost.html?cancelled=1`,
    });
    db.prepare('UPDATE boosts SET stripe_session=? WHERE id=?').run(session.id, boostId);
    res.json({ url: session.url });
  } catch (e) {
    console.error('boost error:', e.message);
    res.status(502).json({ error: 'Could not start checkout. Please try again.' });
  }
});

app.get('/api/boost/:id', async (req, res) => {
  const b = db.prepare('SELECT b.id,b.status,b.amount_cents,b.currency,b.period,b.stripe_session,b.payment_session,l.id listing_id,l.title,l.key,l.url,l.image FROM boosts b JOIN listings l ON l.id=b.listing_id WHERE b.id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  // Backup for a delayed webhook: confirm directly with Stripe, only for the matching session id.
  if (b.status === 'pending' && PAYMENT_PROVIDER === 'stripe' && stripe && b.stripe_session && req.query.session_id === b.stripe_session) {
    try {
      const s = await stripe.checkout.sessions.retrieve(b.stripe_session);
      if (s.payment_status === 'paid') { markPaid(b.id, s); b.status = 'paid'; }
    } catch (e) { /* webhook will settle it */ }
  }
  delete b.stripe_session;
  delete b.payment_session;
  res.json(b);
});

app.get('/api/demo/boost/:id', (req, res) => {
  if (!DEMO) return res.status(404).end();
  const b = db.prepare('SELECT b.id,b.status,b.amount_cents,b.currency,l.title,l.key FROM boosts b JOIN listings l ON l.id=b.listing_id WHERE b.id=?').get(req.params.id);
  b ? res.json(b) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/demo/confirm/:id', (req, res) => {
  if (!DEMO) return res.status(404).end(); // disabled automatically once a Stripe key is set
  markPaid(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/contact', (req, res) => {
  if (!rateLimit('c:' + req.ip, 5, 3600000)) return res.status(429).json({ error: 'Too many messages. Try again later.' });
  const { name, email, body } = req.body || {};
  if (!clean(name, 80) || !validEmail(clean(email, 200)) || clean(body, 2000).length < 10)
    return res.status(400).json({ error: 'Please fill in your name, a valid email and a message (10+ characters).' });
  db.prepare('INSERT INTO messages (name,email,body) VALUES (?,?,?)').run(clean(name, 80), clean(email, 200), clean(body, 2000));
  res.json({ ok: true });
});

// ---------- admin ----------
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin is disabled. Set ADMIN_PASSWORD in your environment.');
  const h = req.headers.authorization || '';
  const [scheme, val] = h.split(' ');
  if (scheme === 'Basic' && val) {
    const pass = Buffer.from(val, 'base64').toString().split(':').slice(1).join(':');
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"').status(401).send('Authentication required');
}
app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'admin.html')));
app.get('/api/admin/overview', adminAuth, (req, res) => {
  const paid = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c, COUNT(*) n FROM boosts WHERE status='paid'`).get();
  const month = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) c FROM boosts WHERE status='paid' AND period=?`).get(currentPeriod()).c;
  const boosts = db.prepare(`SELECT b.id,b.amount_cents,b.currency,b.status,b.period,b.display_name,b.email,b.created_at,b.paid_at,l.id listing_id,l.title,l.key FROM boosts b JOIN listings l ON l.id=b.listing_id ORDER BY b.id DESC LIMIT 100`).all();
  const listings = db.prepare("SELECT id,title,description,key,url,hidden,live,COALESCE(category,'other') AS category FROM listings WHERE live=1 ORDER BY created_at DESC LIMIT 300").all();
  const cats = db.prepare(`SELECT c.slug,c.name,c.builtin,(SELECT COUNT(*) FROM listings l WHERE COALESCE(l.category,'other')=c.slug AND l.live=1) AS n FROM categories c ORDER BY c.sort, c.name`).all();
  const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 50').all();
  res.json({ categories: cats, currency: CURRENCY, demo: DEMO, total_cents: paid.c, total_boosts: paid.n, month_cents: month, boosts, listings, messages });
});
app.post('/api/admin/listings/:id/hidden', adminAuth, (req, res) => {
  db.prepare('UPDATE listings SET hidden=? WHERE id=?').run(req.body && req.body.hidden ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/listings/:id/category', adminAuth, (req, res) => {
  const cat = req.body && req.body.category;
  if (!categoryExists(cat)) return res.status(400).json({ error: 'Unknown category.' });
  db.prepare('UPDATE listings SET category=? WHERE id=?').run(cat, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/listings/:id/edit', adminAuth, (req, res) => {
  const title = clean(req.body && req.body.title, 70), description = clean(req.body && req.body.description, 160);
  if (title.length < 2 || description.length < 10) return res.status(400).json({ error: 'Title 2+ characters and description 10+ characters.' });
  db.prepare('UPDATE listings SET title=?, description=? WHERE id=?').run(title, description, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/categories/:slug/rename', adminAuth, (req, res) => {
  const v = validCategoryName(req.body && req.body.name);
  if (v.error) return res.status(400).json({ error: v.error });
  const clash = findCategoryByName(v.name);
  if (clash && clash.slug !== req.params.slug) return res.status(400).json({ error: 'A category with that name already exists.' });
  db.prepare('UPDATE categories SET name=? WHERE slug=?').run(v.name, req.params.slug);
  res.json({ ok: true });
});
app.post('/api/admin/categories/:slug/delete', adminAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE slug=?').get(req.params.slug);
  if (!c || c.builtin) return res.status(400).json({ error: 'Only categories created by users can be deleted.' });
  db.prepare("UPDATE listings SET category='other' WHERE category=?").run(c.slug);
  db.prepare('DELETE FROM categories WHERE slug=?').run(c.slug);
  res.json({ ok: true });
});
app.post('/api/admin/boosts/:id/refund', adminAuth, async (req, res) => {
  const b = db.prepare('SELECT * FROM boosts WHERE id=?').get(req.params.id);
  if (!b || b.status !== 'paid') return res.status(400).json({ error: 'Only paid boosts can be refunded.' });
  if (PAYMENT_PROVIDER === 'youpi') return res.status(400).json({ error: 'Refund this payment in your YOUPI gateway before changing its status.' });
  try {
    if (stripe && b.stripe_payment_intent) await stripe.refunds.create({ payment_intent: b.stripe_payment_intent });
    else if (stripe) return res.status(400).json({ error: 'No payment reference stored; refund in the Stripe dashboard.' });
    db.prepare(`UPDATE boosts SET status='refunded' WHERE id=?`).run(b.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`\n${SITE_NAME} is running.  Open this in your browser:  ${BASE_URL}\n`);
    console.log(`Payments: ${DEMO ? 'DEMO MODE (no Stripe key, simulated checkout)' : 'Stripe enabled'}`);
    console.log(`Visitors: ${DF_KEY ? 'DataFast API' : 'built-in counter (add DATAFAST_API_KEY to use DataFast)'}`);
    if (!ADMIN_PASSWORD) console.log('Admin: disabled (set ADMIN_PASSWORD in .env)');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Close the other program or set PORT=3001 in your .env file.\n`);
    else console.error(e);
    process.exit(1);
  });
};

if (require.main === module) {
  dbReady.then(startServer).catch((e) => { console.error('Could not start:', e); process.exit(1); });
} else {
  dbReady.catch((e) => { console.error('Could not initialize app:', e); });
}
