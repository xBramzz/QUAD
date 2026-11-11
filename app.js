/* =========================================================
   WEBSITE HEALTH — app.js (Pi-optimised, Historical Data)
   Complete file — replace the whole thing, do not patch.
   ========================================================= */
const API_URL      = 'api.php';
const REFRESH_MS   = 30000;
const SCROLL_PPS   = 36;    // pixels per second for marquee

let allData          = [];
let historyData      = {};
let previousStatuses = null;
let currentUrlKey    = null;

document.addEventListener('DOMContentLoaded', function () {
    startClock();
    initTheme();
    initFilter();
    initScrollPause();
    initKiosk();
    initGlobalRefresh();
    loadData();
    setInterval(loadData, REFRESH_MS);
});

/* ---------- CLOCK ---------- */
function startClock() {
    const timeEl = document.getElementById('time');
    const dateEl = document.getElementById('date');
    if (!timeEl || !dateEl) return;
    function tick() {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('nl-NL');
        dateEl.textContent = now.toLocaleDateString('nl-NL', {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
        });
    }
    tick();
    setInterval(tick, 1000);
}

/* ---------- THEME ---------- */
function initTheme() {
    const sel = document.getElementById('theme-select');
    if (!sel) return;
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        sel.value = 'dark';
    }
    sel.addEventListener('change', function (e) {
        document.body.classList.toggle('dark-mode', e.target.value === 'dark');
        localStorage.setItem('theme', e.target.value);
    });
}

/* ---------- KIOSK / FULLSCREEN ---------- */
function initKiosk() {
    const btn = document.getElementById('kiosk-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', function () {
        btn.classList.toggle('is-full', !!document.fullscreenElement);
    });
}

/* ---------- GLOBAL REFRESH ---------- */
function initGlobalRefresh() {
    const btn = document.getElementById('force-refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        btn.classList.add('is-spinning');
        // Forces a fresh check of ALL sites, bypassing the 60-second PHP cache.
        fetch(`${API_URL}?reset=all`, { cache: 'no-store' })
            .then(r => r.json())
            .then(data => {
                if (!data || !Array.isArray(data.sites)) throw new Error('bad payload');
                applyPayload(data);
            })
            .catch(() => loadData())
            .finally(() => btn.classList.remove('is-spinning'));
    });
}

/* ---------- FILTER ---------- */
function visibleSites() {
    const sel = document.getElementById('status-filter');
    const v = sel ? sel.value : 'all';
    if (v === 'all') return allData;
    return allData.filter(function (s) {
        const isUp = s.status >= 200 && s.status < 400;
        if (v === 'healthy') return isUp && s.ms < 1000;
        if (v === 'slow') return isUp && s.ms >= 1000;
        if (v === 'down') return !isUp;
        return true;
    });
}
function initFilter() {
    const sel = document.getElementById('status-filter');
    if (!sel) return;
    sel.addEventListener('change', function () { renderCards(visibleSites()); });
}

/* ---------- HEALTH HELPERS ---------- */
function isHealthy(st) { return st >= 200 && st < 400; }

function renderHealth(sites) {
    const pill = document.getElementById('health');
    const text = document.getElementById('health-text');
    if (!pill || !text) return;
    if (!sites.length) { text.textContent = '—'; return; }
    const healthy = sites.filter(function (s) { return isHealthy(s.status); }).length;
    const pct = Math.round((healthy / sites.length) * 100);
    text.textContent = pct + '% healthy';
    pill.className = 'health-pill ' + (pct >= 95 ? 'good' : pct >= 80 ? 'warn' : 'bad');
}

/* ---------- CHANGE DETECTION + TOASTS ---------- */
function detectChanges(sites) {
    if (!previousStatuses) return [];
    const changes = [];
    sites.forEach(function (s) {
        const old = previousStatuses[s.url];
        if (old === undefined || old === s.status) return;
        const downNow = !isHealthy(s.status);
        const wasDown = !isHealthy(old);
        if      (downNow && !wasDown) changes.push({ url: s.url, type: 'down',   status: s.status });
        else if (!downNow && wasDown) changes.push({ url: s.url, type: 'up',     status: s.status });
        else                          changes.push({ url: s.url, type: 'change', status: s.status });
    });
    return changes;
}

function showToast(change) {
    let box = document.getElementById('toasts');
    if (!box) return;

    // Anti-spam: max 3 toasts on screen; a 4th kicks out the oldest.
    while (box.children.length >= 3) box.removeChild(box.firstChild);

    const t = document.createElement('div');
    t.className = 'toast toast-' + change.type;

    let msg = '';
    if (change.type === 'down') msg = `${change.url} is DOWN`;
    else if (change.type === 'up') msg = `${change.url} recovered`;
    else if (change.type === 'reset') msg = `Refreshed ${change.url}`;
    else msg = `${change.url} status changed`;

    const dot = document.createElement('span');
    dot.className = 'toast-dot';
    const txt = document.createElement('span');
    txt.className = 'toast-text';
    txt.textContent = msg;
    t.appendChild(dot); t.appendChild(txt);
    box.appendChild(t);

    setTimeout(() => {
        t.classList.add('hide');
        setTimeout(() => t.remove(), 400);
    }, 3000);
}

function applyFlashes(changes) {
    changes.forEach(function (c) {
        const card = document.querySelector(`.card[data-url="${CSS.escape(c.url)}"]`);
        if (!card) return;
        card.style.transition = 'background 0.3s';
        card.style.background = c.type === 'down' ? 'var(--red)' : 'var(--green)';
        setTimeout(() => { card.style.background = ''; }, 1000);
    });
}

/* ---------- DATA FETCHING ---------- */
function applyPayload(data) {
    allData = data.sites || [];
    if (data.history && typeof data.history === 'object') historyData = data.history;

    const changes = detectChanges(allData);

    if (data.error && !allData.length) showError(data.error);
    else renderCards(visibleSites());

    applyFlashes(changes);
    changes.forEach(showToast);

    previousStatuses = {};
    allData.forEach(s => previousStatuses[s.url] = s.status);

    renderHealth(allData);
    renderStats(data.server);
}

async function loadData() {
    try {
        const res  = await fetch(API_URL, { cache: 'no-store' });
        const data = await res.json();
        applyPayload(data);
    } catch (err) {
        console.warn('Refresh skipped:', err.message);
        if (!allData.length) showError('Cannot reach api.php — is the file uploaded?');
    }
}

/* ---------- MANUAL RESET (Per Site) ---------- */
async function resetSite(url) {
    const btn = document.querySelector(`.card[data-url="${CSS.escape(url)}"] .reset-btn`);
    if (btn) btn.classList.add('is-spinning');

    try {
        const res = await fetch(`${API_URL}?reset=${encodeURIComponent(url)}`, { cache: 'no-store' });
        const data = await res.json();

        const freshSite = (data.sites || []).find(s => s.url === url);
        if (freshSite) {
            const idx = allData.findIndex(s => s.url === url);
            if (idx !== -1) allData[idx] = freshSite;
            if (data.history && data.history[url]) historyData[url] = data.history[url];

            renderCards(visibleSites());
            showToast({ url, type: 'reset', status: freshSite.status });
        }
    } catch (err) {
        console.warn('Reset failed:', err);
    } finally {
        if (btn) btn.classList.remove('is-spinning');
    }
}

function showError(msg) {
    const c = document.getElementById('card-container');
    if (!c) return;
    c.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'error-banner';
    div.textContent = 'ℹ️ ' + msg;
    c.appendChild(div);
}

/* ---------- RENDERING ---------- */
function renderCards(sites) {
    const container = document.getElementById('card-container');
    if (!container) return;
    const key = sites.map(s => s.url).join('|');

    if (key !== currentUrlKey) {
        container.innerHTML = '';
        if (!sites.length) { showError('No sites match this filter.'); currentUrlKey = null; return; }
        const grid = document.createElement('div');
        grid.className = 'grid';
        sites.forEach((s, i) => { const c = buildCard(s); c.style.setProperty('--i', Math.min(i, 20)); grid.appendChild(c); });
        container.appendChild(grid);
        currentUrlKey = key;
        setupMarquee(container, grid);
        return;
    }

    // Structure unchanged: update text/numbers in place to save DOM work.
    if (!sites.length) return;
    sites.forEach(s => {
        const card = container.querySelector(`.card[data-url="${CSS.escape(s.url)}"]`);
        if (!card) return;

        card.className = 'card status-' + Math.floor((s.status || 0) / 100) + 'xx';

        const badge = card.querySelector('.status-badge');
        if (badge) {
            badge.textContent = s.status || 'ERR';
            badge.className = 'status-badge ' + (isHealthy(s.status) ? (s.ms < 1000 ? 'badge-2xx' : 'badge-3xx') : 'badge-err');
        }
        const msEl = card.querySelector('.current-status span:last-child');
        if (msEl) msEl.textContent = s.ms + ' ms';

        // Down overlay
        const isDown = !isHealthy(s.status);
        let overlay = card.querySelector('.down-overlay');
        const errCode = s.status === 0 ? 'TIMEOUT' : s.status;
        const errMsg = s.status >= 500 ? 'SERVER FAILURE' : (s.status >= 400 ? 'ACCESS DENIED' : 'CONNECTION LOST');

        if (isDown && !overlay) {
            overlay = document.createElement('div');
            overlay.className = 'down-overlay';
            overlay.innerHTML = `<div class="error-code"></div><div class="error-msg"></div>`;
            card.prepend(overlay);
        }
        if (overlay) {
            if (!isDown) overlay.remove();
            else {
                overlay.querySelector('.error-code').textContent = 'ERR: ' + errCode;
                overlay.querySelector('.error-msg').textContent = errMsg;
            }
        }

        // Heatmap in place
        const entries = (historyData[s.url] || []).slice(-24);
        const heatCells = card.querySelectorAll('.heat-cell');
        const offset = 24 - entries.length;
        heatCells.forEach((cell, i) => {
            if (i < offset) { cell.className = 'heat-cell'; cell.title = ''; return; }
            const e = entries[i - offset];
            let cls = 'heat-down';
            if (e.s >= 200 && e.s < 400) cls = e.ms < 500 ? 'heat-fast' : e.ms < 1500 ? 'heat-med' : 'heat-slow';
            if (!cell.classList.contains(cls)) cell.className = 'heat-cell ' + cls;
            cell.title = `${e.s} - ${e.ms}ms`;
        });

        // Sparkline in place
        const svg = card.querySelector('.sparkline');
        if (svg && entries.length >= 2) {
            let path = svg.querySelector('path');
            if (!path) {
                svg.setAttribute('viewBox', '0 0 100 30');
                svg.setAttribute('preserveAspectRatio', 'none');
                path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                svg.appendChild(path);
            }
            path.setAttribute('d', sparkPath(entries));
        }

        const chartArea = card.querySelector('.chart-area');
        if (chartArea) {
            chartArea.classList.remove('chart-updated');
            void chartArea.offsetWidth;
            chartArea.classList.add('chart-updated');
        }
    });
}

function buildCard(s) {
    const card = document.createElement('a');
    card.className = 'card status-' + Math.floor((s.status || 0) / 100) + 'xx';
    card.href = 'https://' + s.url;
    card.target = '_blank';
    card.rel = 'noopener';
    card.dataset.url = s.url;

    const statusClass = isHealthy(s.status) ? (s.ms < 1000 ? 'badge-2xx' : 'badge-3xx') : 'badge-err';
    const fallbackImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='rgba(140,140,160,0.25)'/></svg>";

    let overlayHTML = '';
    if (!isHealthy(s.status)) {
        const errCode = s.status === 0 ? 'TIMEOUT' : s.status;
        const errMsg = s.status >= 500 ? 'SERVER FAILURE' : (s.status >= 400 ? 'ACCESS DENIED' : 'CONNECTION LOST');
        overlayHTML = `<div class="down-overlay"><div class="error-code">ERR: ${errCode}</div><div class="error-msg">${errMsg}</div></div>`;
    }

    card.innerHTML = `
        ${overlayHTML}
        <button class="reset-btn" title="Force re-check & update history">↻</button>
        <div class="card-header">
            <img class="favicon" loading="lazy" decoding="async" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(s.url)}.ico" onerror="this.onerror=null; this.src='${fallbackImg}'" alt="">
            <p class="url"></p>
        </div>
        <div class="current-status">
            <span class="status-badge ${statusClass}">${s.status || 'ERR'}</span>
            <span>${s.ms} ms</span>
        </div>
        <div class="chart-area">
            ${buildSparkline(historyData[s.url] || [])}
            ${buildHeatmap(historyData[s.url] || [])}
        </div>
    `;
    card.querySelector('.url').textContent = s.url;

    card.querySelector('.reset-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetSite(s.url);
    });

    return card;
}

/* ---------- CHART MATH ---------- */
function sparkPath(data) {
    const maxMs = Math.max(...data.map(e => e.ms), 500);
    const w = 100, h = 30;
    const step = w / (data.length - 1);
    let d = '';
    data.forEach((e, i) => {
        const x = i * step;
        const y = h - (e.ms / maxMs) * h;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    return d;
}

function buildSparkline(entries) {
    const data = (entries || []).slice(-24);
    if (data.length < 2) return '<svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
    return `<svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="${sparkPath(data)}"/></svg>`;
}

function buildHeatmap(entries) {
    const data = (entries || []).slice(-24);
    let cells = '';
    const offset = 24 - data.length;
    for (let i = 0; i < 24; i++) {
        if (i < offset) { cells += '<div class="heat-cell"></div>'; continue; }
        const e = data[i - offset];
        let cls = 'heat-down';
        if (e.s >= 200 && e.s < 400) cls = e.ms < 500 ? 'heat-fast' : e.ms < 1500 ? 'heat-med' : 'heat-slow';
        cells += `<div class="heat-cell ${cls}" title="${e.s} - ${e.ms}ms"></div>`;
    }
    return `<div class="heatmap">${cells}</div>`;
}

/* ---------- SERVER STATS + COUNTDOWN ---------- */
let nextRefresh = Date.now() + REFRESH_MS;

function renderStats(server) {
    const footer = document.getElementById('server-stats');
    if (!footer) return;
    function cls(p) { return p >= 90 ? 'red' : p >= 80 ? 'orange' : 'green'; }
    function bar(label, d, klass) {
        if (!d) return '<div class="' + klass + ' na"><p>' + label + ':</p><p>n/a</p></div>';
        return '<div class="' + klass + ' ' + cls(d.percent) + '">' +
               '<p>' + label + ':</p>' +
               '<progress max="100" value="' + d.percent + '"></progress>' +
               '<p>' + d.percent + '%</p></div>';
    }
    const mem  = server ? server.mem  : null;
    const disk = server ? server.disk : null;

    footer.innerHTML =
        bar('RAM', mem, 'memoryBar') +
        '<div class="countdown" id="countdown"></div>' +
        bar('Disk', disk, 'diskBar');

    nextRefresh = Date.now() + REFRESH_MS;
}

function tickCountdown() {
    const el = document.getElementById('countdown');
    if (!el) return;
    const remaining = Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000));
    el.textContent = '↻ ' + remaining + 's';
}
setInterval(tickCountdown, 1000);

/* ---------- MARQUEE & SCROLL PAUSE ---------- */
function setupMarquee(container, grid) {
    container.classList.remove('is-scrolling');
    requestAnimationFrame(function () {
        const maxScroll = grid.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;
        const duration = maxScroll / SCROLL_PPS;
        container.style.setProperty('--max-scroll', maxScroll + 'px');
        container.style.setProperty('--scroll-duration', duration.toFixed(1) + 's');
        container.classList.add('is-scrolling');
    });
}

function initScrollPause() {
    const c = document.getElementById('card-container');
    if (!c) return;

    function pauseAndScroll() {
        c.classList.add('scroll-paused');
        c.style.overflowY = 'auto';
        clearTimeout(c._t);
        c._t = setTimeout(() => {
            c.classList.remove('scroll-paused');
            c.style.overflowY = 'hidden';
        }, 4000);
    }

    c.addEventListener('mouseenter', pauseAndScroll);
    c.addEventListener('wheel', pauseAndScroll, { passive: true });
    c.addEventListener('touchstart', pauseAndScroll, { passive: true });
    c.addEventListener('touchmove', pauseAndScroll, { passive: true });
}