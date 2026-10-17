/* Shared helpers, header, footer, theme, live visitor pill. Every page loads this first. */
(function () {
  const App = (window.App = {});
  App.config = null;

  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  App.api = async (url, opts) => {
    const r = await fetch(url, opts && opts.body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : undefined);
    let j = {};
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ')');
    return j;
  };

  // Amounts are stored in the smallest unit (paise). Indian digit grouping: Rs 9,99,999.
  App.money = (cents, currency) => {
    const c = (currency || (App.config && App.config.currency) || 'inr').toUpperCase();
    try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
    catch (e) { return (cents / 100).toFixed(2) + ' ' + c; }
  };
  App.num = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
  App.symbol = () => App.money(0).replace(/[\d.,\s]/g, '') || '₹';

  App.monthName = (period) => {
    if (period === 'all') return 'All time';
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  // "32 minutes ago" from a UTC timestamp like "2026-10-16 08:05:54"
  App.ago = (ts) => {
    if (!ts) return '';
    const t = new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z')).getTime();
    const s = Math.max(Math.round((Date.now() - t) / 1000), 0);
    if (s < 60) return 'just now';
    const u = [[86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [sec, name] of u) if (s >= sec) { const n = Math.floor(s / sec); return n + ' ' + name + (n === 1 ? '' : 's') + ' ago'; }
    return '';
  };

  // ---- icons (inline, no network). Categories pick one by name. ----
  const P = {
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    megaphone: '<path d="M3 11v3a1 1 0 001 1h2l7 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M17 9a4 4 0 010 6M19.5 6.5a8 8 0 010 11"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    chart: '<rect x="4" y="11" width="4" height="9" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="16" y="14" width="4" height="6" rx="1"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5"/>',
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-12 6"/>',
    scale: '<path d="M12 4v16M6 20h12M5 7h14"/><path d="M5 7l-3 7a3 3 0 006 0zM19 7l-3 7a3 3 0 006 0z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/>',
    book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M8 7h7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2.5.6 4 2.4 4 5"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 00.8.6h9.8a1 1 0 001-.8L21 7H6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4M16 11h.01M18.5 14h.01"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    palette: '<path d="M12 3a9 9 0 100 18c1.4 0 2-1 2-2 0-1.5-1-1.5-1-3s1-2 2.5-2H18a3 3 0 003-3c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
    pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14 7l3 3"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 00-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6M7 12h10M7 16h10"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  App.icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.tag}</svg>`;

  App.cat = (slug) => (App.config && App.config.categories.find((c) => c.slug === slug)) || { slug: 'other', name: 'Everything Else', icon: 'grid' };
  App.catIcon = (slug) => App.icon(App.cat(slug).icon);
  App.chip = (slug, link) => {
    const c = App.cat(slug);
    const inner = `${App.icon(c.icon)}${App.esc(c.name)}`;
    return link ? `<a class="chip" href="/category.html?c=${encodeURIComponent(c.slug)}">${inner}</a>` : `<span class="chip">${inner}</span>`;
  };
  App.platformChip = (l) => (l.platform && l.platform !== 'website' ? `<span class="chip plain">${App.esc(l.platform_label || l.platform)}</span>` : '');
  // Categories for a dropdown: A-Z, with "Everything Else" last.
  App.sortedCategories = () => (App.config.categories || []).slice().sort((a, b) => (a.slug === 'other') - (b.slug === 'other') || a.name.localeCompare(b.name));

  // Logo: a coloured letter always sits underneath, so a missing or blocked image just falls back to it.
  App.cover = (s, cls) => {
    const c = cls || '';
    let h = 0;
    for (const ch of (s.title || '') + (s.key || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const letter = App.esc(((s.title || s.key || '?').trim()[0] || '?').toUpperCase());
    const img = s.image ? `<img src="${App.esc(s.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" onload="this.classList.add('ok')">` : '';
    return `<div class="cover ph ${c}${s.platform === 'github' ? ' avatar' : ''}" style="background:linear-gradient(135deg,hsl(${h},58%,42%),hsl(${(h + 50) % 360},62%,30%))" aria-hidden="true"><span>${letter}</span>${img}</div>`;
  };

  // One chart row (used on the home page, category pages and the archive)
  App.row = (s) => `
    <li><a class="row r${s.rank}" href="/listing.html?id=${encodeURIComponent(s.id)}">
      <div class="rank">${s.rank}</div>
      ${App.cover(s)}
      <div class="info"><div class="t">${App.esc(s.title)}</div><div class="a">${App.esc(s.description)}</div>
        <div class="tags">${App.chip(s.category)}${App.platformChip(s)}</div></div>
      <div class="meta"><b>${App.money(s.total_cents)}</b><span>${s.boosts} boost${s.boosts === 1 ? '' : 's'}</span></div>
    </a></li>`;

  App.toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  };

  // ---- shared boost fields (amount, email, name, message, terms) ----
  App.boostFieldsHTML = () => {
    const cfg = App.config;
    const presets = [10000, 50000, 100000, 500000, 1000000].filter((c) => c >= cfg.minCents && c <= cfg.maxCents);
    const minR = Math.ceil(cfg.minCents / 100), maxR = Math.floor(cfg.maxCents / 100);
    return `
      <div class="field"><label for="custom">Boost amount (whole rupees, ${App.money(cfg.minCents)} to ${App.money(cfg.maxCents)})</label>
        <div class="amounts" role="group" aria-label="Amount">${presets.map((c, i) => `<button type="button" class="amt${i === 1 ? ' on' : ''}" data-c="${c}">${App.money(c)}</button>`).join('')}</div>
        <div class="input-prefix"><span>${App.esc(App.symbol())}</span><input id="custom" type="number" min="${minR}" max="${maxR}" step="1" inputmode="numeric" placeholder="Or type your own amount"></div></div>
      <div class="field"><label for="email">Email (for your receipt, never shown publicly)</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="name">Display name (optional, shown with your boost)</label><input id="name" type="text" maxlength="40" placeholder="Anonymous"></div>
      <div class="field"><label for="msg">Message (optional, shown on the listing page)</label><input id="msg" type="text" maxlength="140"></div>
      <label class="check"><input type="checkbox" id="terms"><span>I agree to the <a href="/terms.html" target="_blank">Terms</a>, <a href="/privacy.html" target="_blank">Privacy Policy</a> and <a href="/refunds.html" target="_blank">Refund Policy</a>. I understand a boost is a payment for ranking: it is not an endorsement, and it does not buy the listed product or any rights in it.</span></label>
      <div class="err" id="err" role="alert"></div>
      <button class="btn" id="go" type="submit" style="width:100%">Continue to payment</button>
      <p class="muted" style="font-size:.78rem;margin:12px 0 0">${cfg.demo ? 'Demo mode: no real payment will be taken.' : 'Secure checkout by Stripe. We never see your card details.'}</p>`;
  };
  App.boostBind = (root) => {
    const cfg = App.config;
    const amts = root.querySelectorAll('.amt');
    const presets = [...amts].map((b) => Number(b.dataset.c));
    let cents = presets[1] || presets[0] || cfg.minCents;
    const custom = root.querySelector('#custom'), err = root.querySelector('#err'), btn = root.querySelector('#go');
    amts.forEach((b) => b.addEventListener('click', () => {
      amts.forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); cents = Number(b.dataset.c); custom.value = '';
    }));
    custom.addEventListener('input', () => {
      amts.forEach((x) => x.classList.remove('on'));
      cents = Math.round(parseFloat(custom.value || '0') * 100);
    });
    return {
      get: () => ({
        amountCents: cents, email: root.querySelector('#email').value.trim(),
        displayName: root.querySelector('#name').value, message: root.querySelector('#msg').value,
        acceptTerms: root.querySelector('#terms').checked,
      }),
      error: (m) => { err.textContent = m || ''; },
      busy: (on) => { btn.disabled = on; btn.textContent = on ? 'Starting checkout…' : 'Continue to payment'; },
    };
  };

  // ---- theme ----
  const theme = () => document.documentElement.getAttribute('data-theme') || 'dark';
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ }
    const b = document.getElementById('themeBtn');
    if (b) { b.innerHTML = App.icon(t === 'dark' ? 'sun' : 'moon'); b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); }
  }

  const links = [['/', 'Chart'], ['/categories.html', 'Categories'], ['/archive.html', 'Winners'], ['/about.html', 'About'], ['/rules.html', 'Rules']];
  const mark = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="17" width="5" height="12" rx="2.5" fill="currentColor"/><rect x="11" y="9" width="5" height="20" rx="2.5" fill="currentColor"/><rect x="19" y="3" width="5" height="26" rx="2.5" style="fill:var(--accent)"/><rect x="27" y="13" width="4" height="16" rx="2" fill="currentColor"/></svg>`;

  App.ready = fetch('/api/config').then((r) => r.json()).then((cfg) => {
    App.config = cfg;
    const isAdmin = location.pathname.startsWith('/admin');
    document.title = (document.title ? document.title + ' · ' : '') + cfg.siteName;

    // DataFast analytics script (public pages only)
    if (cfg.datafast && cfg.datafast.websiteId && !isAdmin) {
      const s = document.createElement('script');
      s.defer = true; s.src = 'https://datafa.st/js/script.js';
      s.setAttribute('data-website-id', cfg.datafast.websiteId);
      if (cfg.datafast.domain) s.setAttribute('data-domain', cfg.datafast.domain);
      document.head.appendChild(s);
    }

    const path = location.pathname === '/index.html' ? '/' : location.pathname;
    const nav = links.map(([h, t]) => `<a href="${h}" class="${path === h || path === h.replace('.html', '') ? 'on' : ''}">${t}</a>`).join('');
    const banner = cfg.demo ? '<div class="banner">Demo mode: payments are simulated and no real money is charged.</div>' : '';
    const statsHref = (cfg.datafast && cfg.datafast.shareUrl) || '/about.html';
    const external = /^https?:/.test(statsHref) ? ' target="_blank" rel="noopener"' : '';
    document.body.insertAdjacentHTML('afterbegin', `${banner}
      <header class="site"><div class="wrap">
        <a class="brand" href="/">${mark}${App.esc(cfg.siteName)}</a>
        <a class="live" id="live" href="${App.esc(statsHref)}"${external} aria-label="Live visitor stats"><span class="dot"></span><span><b id="vOnline">–</b> online</span><span class="long">· <span id="vToday">–</span> visitors today</span><span class="go">· stats→</span></a>
        <nav class="main" id="nav" aria-label="Main">${nav}<a class="getlisted" href="/boost.html">Get listed</a><a class="icon-btn" href="/listings.html" aria-label="Browse and search all listings">${App.icon('search')}</a><button class="icon-btn" id="themeBtn" type="button"></button></nav>
        <button class="icon-btn burger" id="burger" aria-label="Menu" aria-expanded="false" type="button">${App.icon('menu')}</button>
      </div></header>`);
    setTheme(theme());
    document.getElementById('themeBtn').addEventListener('click', () => setTheme(theme() === 'dark' ? 'light' : 'dark'));
    const burger = document.getElementById('burger'), navEl = document.getElementById('nav');
    burger.addEventListener('click', () => { const o = navEl.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });

    const cr = cfg.creator || {};
    const built = cr.name ? `Built by ${cr.url ? `<a href="${App.esc(cr.url)}" target="_blank" rel="noopener" style="display:inline;color:var(--text)">${App.esc(cr.name)}</a>` : App.esc(cr.name)}` : '';
    document.body.insertAdjacentHTML('beforeend', `
      <footer class="site"><div class="wrap">
        <div class="cols">
          <div><b style="color:var(--text);font-size:1rem">${App.esc(cfg.siteName)}</b><p style="margin:6px 0 0;max-width:340px">A public leaderboard for websites, profiles, apps and AI tools. Pay more, rank higher. Every month starts from zero.</p></div>
          <div><h4>Explore</h4><a href="/boost.html">Get listed</a><a href="/">This month's chart</a><a href="/categories.html">Categories</a><a href="/listings.html">All listings</a><a href="/archive.html">Past winners</a><a href="/about.html">About</a><a href="/rules.html">Rules</a></div>
          <div><h4>Legal</h4><a href="/terms.html">Terms of Service</a><a href="/privacy.html">Privacy Policy</a><a href="/refunds.html">Refund Policy</a><a href="/contact.html">Contact</a></div>
        </div>
        <div class="fine"><span>© ${new Date().getFullYear()} ${App.esc(cfg.siteName)}${built ? ' · ' + built : ''}</span><span>Listings are submitted by users. Names and logos belong to their owners, and we are not affiliated with them. Payments by Stripe.</span></div>
      </div></footer>`);

    // live visitor numbers (DataFast when configured, otherwise a built-in cookieless counter)
    const refresh = () => fetch('/api/visitors').then((r) => r.json()).then((v) => {
      document.getElementById('vOnline').textContent = App.num(v.online);
      document.getElementById('vToday').textContent = App.num(v.today);
    }).catch(() => {});
    refresh(); setInterval(refresh, 30000);
    return cfg;
  });
})();
