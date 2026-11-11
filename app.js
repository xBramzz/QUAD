/* =========================================================
   WEBSITE HEALTH — app.js (Pi-optimised, Historical Data)
   ========================================================= */
const API_URL      = 'api.php';
const REFRESH_MS   = 30000;
const SCROLL_PPS   = 36;    // pixels per second for marquee

let allData          = [];
let historyData      = {};
let previousStatuses = null;

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
    btn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', function () {
        btn.textContent = document.fullscreenElement ? '✕' : '⛶';
    });
}

/* ---------- GLOBAL REFRESH ---------- */
function initGlobalRefresh() {
    const btn = document.getElementById('force-refresh-btn');
    btn.addEventListener('click', function () {
        btn.classList.add('is-spinning');
        // Note: To truly bypass the 10-min PHP cache for ALL sites, 
        // you'd need to add ?reset=all logic to api.php. 
        // For now, this just forces a frontend re-fetch.
        loadData().finally(() => btn.classList.remove('is-spinning'));
    });
}

/* ---------- FILTER ---------- */
function visibleSites() {
    const v = document.getElementById('status-filter').value;
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
    document.getElementById('status-filter')
        .addEventListener('change', function () { renderCards(visibleSites()); });
}

/* ---------- HEALTH HELPERS ---------- */
function isHealthy(st) { return st >= 200 && st < 400; }

function renderHealth(sites) {
    const pill = document.getElementById('health');
    const text = document.getElementById('health-text');
    if (!sites.length) { text.textContent = '—'; return; }
	const healthy = sites.filter(function(s) { return isHealthy(s.status); }).length;
    const pct     = Math.round((healthy / sites.length) * 100);
    text.textContent = pct + '% healthy';
    pill.className   = 'health-pill ' + (pct >= 95 ? 'good' : pct >= 80 ? 'warn' : 'bad');
}

/* ---------- CHANGE DETECTION + TOASTS ---------- */
function detectChanges(sites) {
    if (!previousStatuses) return [];
    const changes = [];
    sites.forEach(function (s) {
        const old = previousStatuses[s.url];
        if (old === undefined || old === s.status) return;
        const downNow = !isHealthy(s);
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

    // 🛑 ANTI-SPAM: Limit to max 3 toasts on screen at once.
    // If a 4th one comes in, it kicks out the oldest one.
    while (box.children.length >= 3) {
        box.removeChild(box.firstChild);
    }

    const t = document.createElement('div');
    t.className = 'toast toast-' + change.type;

    // Clean, concise text (no big emojis, no redundant info)
    let msg = '';
    if (change.type === 'down') msg = `${change.url} is DOWN`;
    else if (change.type === 'up') msg = `${change.url} recovered`;
    else if (change.type === 'reset') msg = `Refreshed ${change.url}`;
    else msg = `${change.url} status changed`;

    t.innerHTML = `<span class="toast-dot"></span><span class="toast-text">${msg}</span>`;
    box.appendChild(t);

    // Auto-remove after 3 seconds (faster than before so they don't pile up)
    setTimeout(() => {
        t.classList.add('hide');
        setTimeout(() => t.remove(), 400); // Wait for fade-out animation
    }, 3000);
}

function applyFlashes(changes) {
    changes.forEach(function (c) {
        const card = document.querySelector(`.card[data-url="${c.url}"]`);
        if (!card) return;
        card.style.transition = 'background 0.3s';
        card.style.background = c.type === 'down' ? 'var(--red)' : 'var(--green)';
        setTimeout(() => { card.style.background = ''; }, 1000);
    });
}

/* ---------- DATA FETCHING ---------- */
async function loadData() {
    try {
        const res  = await fetch(API_URL, { cache: 'no-store' });
        const data = await res.json();

		allData = data.sites || [];
        
        // 🔥 THIS IS THE MISSING PIECE — load history from API
        if (data.history && typeof data.history === 'object') {
            historyData = data.history;
        }
        
        const changes = detectChanges(allData);

        if (data.error && !allData.length) showError(data.error);
        else renderCards(visibleSites());

        applyFlashes(changes);
        changes.forEach(showToast);

        previousStatuses = {};
        allData.forEach(s => previousStatuses[s.url] = s.status);

        renderHealth(allData);
        renderStats(data.server);
    } catch (err) {
        console.warn('Refresh skipped:', err.message);
        if (!allData.length) showError('Cannot reach api.php — is the file uploaded?');
    }
}

/* ---------- MANUAL RESET (Per Site) ---------- */
async function resetSite(url) {
    const btn = document.querySelector(`.card[data-url="${url}"] .reset-btn`);
    if (btn) btn.classList.add('is-spinning');

    try {
        const res = await fetch(`${API_URL}?reset=${encodeURIComponent(url)}`, { cache: 'no-store' });
        const data = await res.json();

        // Update local state with the fresh ping
        const freshSite = data.sites.find(s => s.url === url);
        if (freshSite) {
            const idx = allData.findIndex(s => s.url === url);
            if (idx !== -1) allData[idx] = freshSite;
            if (data.history[url]) historyData[url] = data.history[url];
            
            // Re-render just the cards to update sparklines/heatmaps
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
    document.getElementById('card-container').innerHTML =
        '<div class="error-banner">ℹ️ ' + msg + '</div>';
}

/* ---------- RENDERING ---------- */
let currentUrlKey = null;

function renderCards(sites) {
    const container = document.getElementById('card-container');
    const key = sites.map(s => s.url).join('|');

    if (key !== currentUrlKey) {
        container.innerHTML = '';
        if (!sites.length) { showError('No Sites Down.'); currentUrlKey = null; return; }
        const grid = document.createElement('div');
        grid.className = 'grid';
        sites.forEach(s => grid.appendChild(buildCard(s)));
        container.appendChild(grid);
        currentUrlKey = key;
        setupMarquee(container, grid);
        return;
    }

    // If structure hasn't changed, just update text/numbers to save DOM rendering
        // If structure hasn't changed, just update text/numbers to save DOM rendering
    if (!sites.length) return;
    sites.forEach(s => {
        const card = container.querySelector(`.card[data-url="${s.url}"]`);
        if (!card) return;
        
        // 1. Update background color class
        card.className = 'card status-' + Math.floor((s.status || 0) / 100) + 'xx';
        
        // 2. Update status badge and ms
        const badge = card.querySelector('.status-badge');
        if (badge) {
            badge.textContent = s.status || 'ERR';
            badge.className = 'status-badge ' + (s.status >= 200 && s.status < 400 ? (s.ms < 1000 ? 'badge-2xx' : 'badge-3xx') : 'badge-err');
        }
        const msEl = card.querySelector('.current-status span:last-child');
        if (msEl) msEl.textContent = s.ms + ' ms';

        // 3. FUTURISTIC OVERLAY LOGIC (Smoothly add/remove)
        const isDown = s.status === 0 || s.status >= 400;
        let overlay = card.querySelector('.down-overlay');
        
        if (isDown && !overlay) {
            let errCode = s.status === 0 ? 'TIMEOUT' : s.status;
            let errMsg = 'CONNECTION LOST';
            if (s.status >= 500) errMsg = 'SERVER FAILURE';
            else if (s.status >= 400 && s.status < 500) errMsg = 'ACCESS DENIED';
            
            overlay = document.createElement('div');
            overlay.className = 'down-overlay';
            overlay.innerHTML = `<div class="error-code">ERR: ${errCode}</div><div class="error-msg">${errMsg}</div>`;
            card.prepend(overlay);
        } else if (!isDown && overlay) {
            overlay.remove(); // Smoothly disappears
        } else if (isDown && overlay) {
            let errCode = s.status === 0 ? 'TIMEOUT' : s.status;
            let errMsg = 'CONNECTION LOST';
            if (s.status >= 500) errMsg = 'SERVER FAILURE';
            else if (s.status >= 400 && s.status < 500) errMsg = 'ACCESS DENIED';
            const codeEl = overlay.querySelector('.error-code');
            const msgEl = overlay.querySelector('.error-msg');
            if (codeEl) codeEl.textContent = `ERR: ${errCode}`;
            if (msgEl) msgEl.textContent = errMsg;
        }

        // 4. SMOOTH CHART UPDATES (The "dots just go" magic)
        const entries = historyData[s.url] || [];
        
        // Update Heatmap in-place (colors will smoothly fade via CSS)
        const heatCells = card.querySelectorAll('.heat-cell');
        const offset = 24 - entries.length;
        heatCells.forEach((cell, i) => {
            if (i < offset) {
                cell.className = 'heat-cell';
                cell.title = '';
            } else {
                const e = entries[i - offset];
                let cls = 'heat-down';
                if (e.s >= 200 && e.s < 400) {
                    if (e.ms < 500) cls = 'heat-fast';
                    else if (e.ms < 1500) cls = 'heat-med';
                    else cls = 'heat-slow';
                }
                if (!cell.classList.contains(cls)) cell.className = 'heat-cell ' + cls;
                cell.title = `${e.s} - ${e.ms}ms`;
            }
        });

        // Update Sparkline path in-place
        const path = card.querySelector('.sparkline path');
        if (path && entries.length >= 2) {
            const data = entries.slice(-24);
            const maxMs = Math.max(...data.map(e => e.ms), 500);
            const w = 100, h = 30;
            const step = w / (data.length - 1);
            let d = '';
            data.forEach((e, i) => {
                const x = i * step;
                const y = h - (e.ms / maxMs) * h;
                d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
            });
            path.setAttribute('d', d);
        }
        
        // Add a subtle "ping" glow to the chart area to show it just updated
        const chartArea = card.querySelector('.chart-area');
        if (chartArea) {
            chartArea.classList.remove('chart-updated');
            void chartArea.offsetWidth; // Trigger reflow to restart animation
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

    const statusClass = s.status >= 200 && s.status < 400 ? (s.ms < 1000 ? 'badge-2xx' : 'badge-3xx') : 'badge-err';
    const fallbackImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='rgba(140,140,160,0.25)'/><text x='12' y='17' font-size='11' text-anchor='middle'>🌐</text></svg>";

    // --- FUTURISTIC OVERLAY LOGIC ---
    let overlayHTML = '';
    const isDown = s.status === 0 || s.status >= 400;
    if (isDown) {
        let errCode = s.status === 0 ? 'TIMEOUT' : s.status;
        let errMsg = 'CONNECTION LOST';
        if (s.status >= 500) errMsg = 'SERVER FAILURE';
        else if (s.status >= 400 && s.status < 500) errMsg = 'ACCESS DENIED';
        
        overlayHTML = `
            <div class="down-overlay">
                <div class="error-code">ERR: ${errCode}</div>
                <div class="error-msg">${errMsg}</div>
            </div>
        `;
    }

    card.innerHTML = `
        ${overlayHTML}
        <button class="reset-btn" title="Force re-check & update history">↻</button>
        <div class="card-header">
            <img class="favicon" loading="lazy" decoding="async" src="https://icons.duckduckgo.com/ip3/${s.url}.ico" onerror="this.onerror=null; this.src='${fallbackImg}'" alt="">
            <p class="url">${s.url}</p>
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

    // Prevent the <a> tag from navigating when clicking the reset button
    card.querySelector('.reset-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetSite(s.url);
    });

    return card;
}

/* ---------- CHART MATH (Lightweight SVG & CSS) ---------- */
function buildSparkline(entries) {
    if (!entries || entries.length < 2) return '<svg class="sparkline"></svg>';
    
    // Take last 24 entries
    const data = entries.slice(-24);
    const maxMs = Math.max(...data.map(e => e.ms), 500); // Min 500ms scale so tiny changes show
    
    const w = 100, h = 30;
    const step = w / (data.length - 1);
    let d = '';
    
    data.forEach((e, i) => {
        const x = i * step;
        const y = h - (e.ms / maxMs) * h;
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });

    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

function buildHeatmap(entries) {
    const data = entries ? entries.slice(-24) : [];
    let cells = '';
    const offset = 24 - data.length;
    
    for (let i = 0; i < 24; i++) {
        if (i < offset) {
            cells += '<div class="heat-cell"></div>'; // Empty past cell
        } else {
            const e = data[i - offset];
            let cls = 'heat-down';
            if (e.s >= 200 && e.s < 400) {
                if (e.ms < 500) cls = 'heat-fast';
                else if (e.ms < 1500) cls = 'heat-med';
                else cls = 'heat-slow';
            }
            cells += `<div class="heat-cell ${cls}" title="${e.s} - ${e.ms}ms"></div>`;
        }
    }
    return `<div class="heatmap">${cells}</div>`;
}

/* ---------- SERVER STATS ---------- */
/* ---------- SERVER STATS + COUNTDOWN ---------- */
let nextRefresh = Date.now() + REFRESH_MS;

function renderStats(server) {
    const footer = document.getElementById('server-stats');
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

/* Countdown ticker — updates every second, no API calls */
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
    
    function pauseAndScroll() {
        // 1. Pause the CSS marquee animation
        c.classList.add('scroll-paused');
        // 2. Unlock native scrolling!
        c.style.overflowY = 'auto'; 
        
        // 3. Reset the timer: if no interaction for 4 seconds, resume auto-scroll
        clearTimeout(c._t);
        c._t = setTimeout(() => {
            c.classList.remove('scroll-paused');
            c.style.overflowY = 'hidden'; // Lock it back to marquee mode
        }, 4000); 
    }

    // Trigger on any interaction
    c.addEventListener('mouseenter', pauseAndScroll);
    c.addEventListener('wheel', pauseAndScroll, { passive: true });
    c.addEventListener('touchstart', pauseAndScroll, { passive: true });
    c.addEventListener('touchmove', pauseAndScroll, { passive: true });
}