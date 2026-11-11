/* =========================================================
   WEBSITE HEALTH — analytics.js
   Sidebar routing + Analytics and Incidents views.
   Uses globals from app.js (allData, renderCards, visibleSites, API_URL, currentUrlKey)
   ========================================================= */
const VIEWS = ['live', 'analytics', 'incidents', 'home'];
let statsRange = '24h', stats = null, siteQuery = '', animateNext = false;

const esc    = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMs  = ms => ms == null ? '–' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms';
const fmtAt  = t => new Date(t * 1000).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDur = s => s < 60 ? '< 1 min' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? (s / 3600).toFixed(1) + ' h' : (s / 86400).toFixed(1) + ' d';
const uCls   = p => p >= 99.9 ? 'good' : p >= 99 ? 'warn' : 'bad';
const rangeSeg = () => '<div class="seg">' + ['24h', '7d', '30d'].map(r =>
    `<button data-range="${r}" class="${r === statsRange ? 'on' : ''}">${r}</button>`).join('') + '</div>';

/* ---------- ROUTING (#live, #analytics, #incidents) ---------- */
function currentView() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : 'live'; }

function showView() {
    const name = currentView();
    VIEWS.forEach(v => { document.getElementById('view-' + v).hidden = v !== name; });
    document.querySelectorAll('#sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    document.getElementById('filter').style.visibility = name === 'live' ? 'visible' : 'hidden';
    if (name === 'live') {
        // re-measure the marquee now that the grid is visible again
        if (allData.length) { currentUrlKey = null; renderCards(visibleSites()); }
    } else if (name !== 'home') { animateNext = true; loadStats(); }
}

function updateBadge() {
    const n = allData.filter(s => !(s.status >= 200 && s.status < 400)).length;
    const b = document.getElementById('inc-badge');
    b.textContent = n; b.hidden = !n;
}

/* ---------- DATA ---------- */
async function loadStats() {
    try {
        const res = await fetch(`${API_URL}?action=stats&range=${statsRange}`, { cache: 'no-store' });
        stats = await res.json();
        if (stats.error) throw new Error(stats.error);
        const box = document.getElementById(currentView() === 'analytics' ? 'an-body' : 'inc-body');
        if (currentView() === 'analytics') renderAnalytics();
        if (currentView() === 'incidents') renderIncidents();
        if (animateNext) { box.classList.add('anim'); setTimeout(() => box.classList.remove('anim'), 1600); animateNext = false; }
    } catch (e) {
        ['an-body', 'inc-body'].forEach(id =>
            document.getElementById(id).innerHTML = `<div class="error-banner">${esc(e.message)}</div>`);
    }
}

/* ---------- ANALYTICS ---------- */
function buildBars(tl) {
    if (!tl.length) return '<p class="muted">No data yet. Checks are stored while the Live page is open, so charts fill up over time.</p>';
    const W = 720, H = 180, max = Math.max(...tl.map(b => b.avg || 0), 500), bw = W / tl.length;
    const bars = tl.map((b, i) => {
        const h = Math.max(2, (b.avg || 0) / max * H), upp = b.up / b.n * 100;
        const cls = upp < 95 ? 'bar-bad' : upp < 100 ? 'bar-warn' : 'bar-ok';
        return `<rect style="--i:${i}" class="${cls}" x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${fmtAt(b.b)}: ${fmtMs(b.avg)}, ${upp.toFixed(1)}% up</title></rect>`;
    }).join('');
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
            <div class="chart-note"><span>${fmtAt(tl[0].b)}</span><span>Tallest bar: ${fmtMs(max)}. Orange or red bars had downtime.</span><span>Now</span></div>`;
}

function renderAnalytics() {
    const s = stats.summary, pct = s.checks ? (s.up || 0) / s.checks * 100 : null;
    const tile = (label, val, cls = '') => `<div class="tile ${cls}"><b>${val}</b><span>${label}</span></div>`;
    document.getElementById('an-body').innerHTML = `
        <div class="view-head"><h2>Analytics</h2>${rangeSeg()}</div>
        <div class="tiles">
            ${tile('Uptime', pct == null ? '–' : pct.toFixed(2) + '%', pct == null ? '' : uCls(pct))}
            ${tile('Average response', fmtMs(s.avg))}
            ${tile('Checks run', Number(s.checks).toLocaleString('nl-NL'))}
            ${tile('Incidents', s.incidents, s.incidents ? 'warn' : 'good')}
        </div>
        <div class="panel"><h3>Average response time</h3>${buildBars(stats.timeline)}</div>
        <div class="panel">
            <div class="view-head"><h3>Sites, worst first</h3><input class="search" id="site-search" placeholder="Search sites" value="${esc(siteQuery)}"></div>
            <table class="data"><thead><tr><th>Site</th><th>Uptime</th><th class="num">Average</th><th class="num">Slowest</th><th class="num">Checks</th></tr></thead><tbody id="site-rows"></tbody></table>
        </div>`;
    document.getElementById('site-search').addEventListener('input', e => { siteQuery = e.target.value.toLowerCase(); renderSiteRows(); });
    renderSiteRows();
}

function renderSiteRows() {
    const rows = stats.sites.filter(x => x.url.toLowerCase().includes(siteQuery))
        .sort((a, b) => a.uptime - b.uptime || b.avg - a.avg)
        .map(x => `<tr><td>${esc(x.url)}</td><td><span class="ubar ${uCls(x.uptime)}"><i style="width:${x.uptime}%"></i></span>${x.uptime}%</td><td class="num">${fmtMs(x.avg)}</td><td class="num">${fmtMs(x.max)}</td><td class="num">${x.checks}</td></tr>`)
        .join('');
    document.getElementById('site-rows').innerHTML = rows || '<tr><td colspan="5" class="muted">No sites match.</td></tr>';
}

/* ---------- INCIDENTS ---------- */
function renderIncidents() {
    const now = Date.now() / 1000;
    const rows = stats.incidents.map(i =>
        `<tr><td>${esc(i.url)}</td><td><span class="status-badge badge-err">${i.status || 'Timeout'}</span></td><td>${fmtAt(i.started)}</td><td>${fmtDur((i.ended || now) - i.started)}</td><td>${i.ended ? 'Resolved' : '<b class="ongoing">Ongoing</b>'}</td></tr>`).join('');
    document.getElementById('inc-body').innerHTML = `
        <div class="view-head"><h2>Incidents</h2>${rangeSeg()}</div>
        <div class="panel">${rows
            ? `<table class="data"><thead><tr><th>Site</th><th>Status</th><th>Started</th><th>Duration</th><th>State</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="muted">No incidents in this period.</p>'}</div>`;
}

/* ---------- WIRING ---------- */
document.addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (b) { statsRange = b.dataset.range; animateNext = true; loadStats(); }
});
window.addEventListener('hashchange', showView);
document.addEventListener('DOMContentLoaded', () => {
    showView();
    setInterval(updateBadge, 5000);
    setInterval(() => { if (currentView() === 'analytics' || currentView() === 'incidents') loadStats(); }, 60000);
});
