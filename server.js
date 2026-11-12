/* =========================================================
   WEBSITE HEALTH — server.js
   Server tab: live tiles, history charts, memory breakdown.
   Load it AFTER tabs.js. It replaces tabs.js's renderServer().
   Data: stats.php (live + history) and api.php?action=server
   (engine / database info, already loaded by tabs.js).
   If stats.php fails, the old Server tab is shown instead.
   ========================================================= */

const SRV_STATS = 'stats.php';
const srvOldRender = renderServer;          // from tabs.js, used as fallback

let srvRange = 6, srvTimer = null, srvApi = null, srvLast = null, srvRz = null;
try {
    const r = parseInt(localStorage.getItem('srvRange'), 10);
    if ([1, 6, 24].includes(r)) srvRange = r;
} catch (e) { /* storage blocked: keep default */ }

/* ---------- formatting ---------- */
const srvLvl   = p => p >= 90 ? 'bad' : p >= 80 ? 'warn' : 'good';
const srvPct   = v => v == null ? '–' : (Math.round(v * 10) / 10) + '%';
const srvNum   = v => v == null ? '–' : String(Math.round(v * 100) / 100);
const srvTime  = t => new Date(t * 1000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const srvBytes = b => {
    if (b == null) return '–';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
};
const srvRate = b => b == null ? '–' : srvBytes(b) + '/s';

/* ---------- chart definitions ---------- */
const SRV_CHARTS = [
    { id: 'cpu',  title: 'CPU and memory', max: 100, fmt: srvPct,
      series: [{ k: 'cpu', name: 'CPU', color: 'var(--blue-text)' }, { k: 'mem', name: 'RAM', color: 'var(--purple-text)' }] },
    { id: 'load', title: 'Load average', fmt: srvNum,
      series: [{ k: 'load', name: 'Load', color: 'var(--orange-text)' }] },
    { id: 'net',  title: 'Network', fmt: srvRate,
      series: [{ k: 'rx', name: 'Download', color: 'var(--green-text)' }, { k: 'tx', name: 'Upload', color: 'var(--blue-text)' }] },
    { id: 'disk', title: 'Disk usage', max: 100, fmt: srvPct,
      series: [{ k: 'disk', name: 'Disk', color: 'var(--orange-text)' }] },
    { id: 'temp', title: 'Temperature', fmt: v => v == null ? '–' : Math.round(v) + ' °C', optional: true,
      series: [{ k: 'temp', name: 'Temp', color: 'var(--red-text)' }] },
];
const srvChartById = id => SRV_CHARTS.find(c => c.id === id);

/* Average buckets so the SVG never has more than n points (kind to the Pi) */
function srvDown(rows, n) {
    if (rows.length <= n) return rows;
    const step = Math.ceil(rows.length / n), out = [];
    for (let i = 0; i < rows.length; i += step) {
        const g = rows.slice(i, i + step), o = { t: g[g.length - 1].t };
        ['cpu', 'mem', 'load', 'disk', 'rx', 'tx', 'temp'].forEach(k => {
            const v = g.map(r => r[k]).filter(x => x != null);
            o[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        });
        out.push(o);
    }
    return out;
}
function srvAgg(rows, k) {
    const v = rows.map(r => r[k]).filter(x => x != null);
    return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) } : null;
}

/* ---------- chart drawing ---------- */
function srvDrawWrap(wrap) {
    const def = srvChartById(wrap.dataset.chart);
    if (!def) return;
    const rows = srvDown((srvLast && srvLast.history) || [], 120);
    if (rows.length < 2) {
        wrap.innerHTML = '<p class="muted srv-empty">Collecting data… one sample is saved every minute.</p>';
        wrap._srv = null;
        return;
    }
    const W = Math.max(260, Math.floor(wrap.clientWidth)), H = 170, L = 46, R = 10, T = 10, B = 22;
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
    let max = def.max;
    if (!max) {
        max = 0;
        def.series.forEach(s => rows.forEach(r => { if (r[s.k] != null && r[s.k] > max) max = r[s.k]; }));
        max = max > 0 ? max * 1.15 : 1;
    }
    const x = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const y = v => T + (1 - Math.min(v, max) / max) * (H - T - B);

    const grid = [0, 0.5, 1].map(f => {
        const yy = y(max * f).toFixed(1);
        return `<line class="srv-grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>
                <text class="srv-axis" x="${L - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end">${escT(def.fmt(max * f))}</text>`;
    }).join('');

    const lines = def.series.map((s, si) => {
        let d = '', pen = false, gap = false, fx = null, lx = null;
        rows.forEach(r => {
            const v = r[s.k];
            if (v == null) { pen = false; gap = true; return; }
            const px = x(r.t);
            if (fx === null) fx = px;
            lx = px;
            d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + y(v).toFixed(1);
            pen = true;
        });
        if (!d) return '';
        const base = (H - B).toFixed(1);
        const area = (si === 0 && !gap)
            ? `<path class="srv-area" d="${d} L${lx.toFixed(1)} ${base} L${fx.toFixed(1)} ${base} Z" style="fill:${s.color}"/>` : '';
        return `${area}<path class="srv-line" pathLength="1" d="${d}" style="stroke:${s.color}"/>`;
    }).join('');

    const mid = Math.round((t0 + t1) / 2);
    wrap.innerHTML = `<svg class="srv-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escT(def.title)}">
            ${grid}${lines}
            <line class="srv-cursor" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
            <text class="srv-axis" x="${L}" y="${H - 6}">${srvTime(t0)}</text>
            <text class="srv-axis" x="${((L + W - R) / 2).toFixed(0)}" y="${H - 6}" text-anchor="middle">${srvTime(mid)}</text>
            <text class="srv-axis" x="${W - R}" y="${H - 6}" text-anchor="end">${srvTime(t1)}</text>
        </svg><div class="srv-tip"></div>`;
    wrap._srv = { rows, def, W, L, R, t0, t1, x };
}

/* Hover tooltip (one delegated listener for all charts) */
document.addEventListener('pointermove', e => {
    const wrap = e.target.closest && e.target.closest('.srv-chart-wrap');
    document.querySelectorAll('.srv-chart-wrap.hover').forEach(w => { if (w !== wrap) w.classList.remove('hover'); });
    if (!wrap || !wrap._srv) return;
    const { rows, def, W, x } = wrap._srv;
    const rect = wrap.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    let best = rows[0], bd = Infinity;
    rows.forEach(r => { const dd = Math.abs(x(r.t) - px); if (dd < bd) { bd = dd; best = r; } });
    const cur = wrap.querySelector('.srv-cursor'), tip = wrap.querySelector('.srv-tip');
    if (!cur || !tip) return;
    const cx = x(best.t);
    cur.setAttribute('x1', cx); cur.setAttribute('x2', cx);
    tip.innerHTML = `<b>${srvTime(best.t)}</b>` + def.series.map(s =>
        `<span><i style="background:${s.color}"></i>${s.name} <strong>${escT(def.fmt(best[s.k]))}</strong></span>`).join('');
    tip.style.left = Math.max(0, Math.min(cx + 12, W - 150)) + 'px';
    wrap.classList.add('hover');
});
document.addEventListener('pointerleave', () => {
    document.querySelectorAll('.srv-chart-wrap.hover').forEach(w => w.classList.remove('hover'));
}, true);

window.addEventListener('resize', () => {
    clearTimeout(srvRz);
    srvRz = setTimeout(() => document.querySelectorAll('.srv-chart-wrap').forEach(srvDrawWrap), 200);
});

/* ---------- building blocks ---------- */
const srvTile = (val, label, sub, cls) =>
    `<div class="tile ${cls || ''}"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;

function srvMemoryFallback(api) {          // old api.php numbers, used when stats.php can't read RAM
    const m = api && api.server && api.server.mem;
    if (!m || m.percent == null) return null;
    return { source: 'api.php', pct: m.percent, used: m.used_mb * 1048576, total: m.total_mb * 1048576, cached: 0, swap: null };
}

function srvMemoryPanel(m) {
    if (!m) return `<div class="panel"><h3>Memory</h3><p class="muted">Memory could not be read on this server.</p></div>`;
    const total = m.total || 1, used = m.used;
    const cache = Math.min(m.cached || 0, Math.max(0, total - used));
    const free = Math.max(0, total - used - cache);
    const w = v => (v / total * 100).toFixed(1);
    const swap = m.swap && m.swap.total
        ? meter('Swap', { percent: m.swap.pct }, `${srvBytes(m.swap.used)} / ${srvBytes(m.swap.total)}`) : '';
    return `<div class="panel"><h3>Memory</h3>
        <div class="srv-stack"><i class="u" style="width:${w(used)}%"></i><i class="c" style="width:${w(cache)}%"></i><i class="f" style="width:${w(free)}%"></i></div>
        <div class="srv-keys"><span><i class="u"></i>Used ${srvBytes(used)}</span><span><i class="c"></i>Cache ${srvBytes(cache)}</span><span><i class="f"></i>Free ${srvBytes(free)}</span></div>
        ${swap}<p class="srv-sub">Total ${srvBytes(total)} · read via ${escT(m.source || '?')}</p></div>`;
}

function srvEnginePanel(st, api) {
    const h = st.host || {}, s = (api && api.server) || {}, c = st.cpu || {};
    return `<div class="panel"><h3>Engine</h3><dl class="kv">
        <dt>PHP</dt><dd class="tmono">${escT(h.php || s.php || '?')}</dd>
        <dt>OS</dt><dd>${escT(h.os || s.os || '?')}</dd>
        <dt>Web server</dt><dd>${escT(h.web || '–')}</dd>
        <dt>Hostname</dt><dd>${escT(s.host || '–')}</dd>
        <dt>CPU cores</dt><dd>${c.cores != null ? c.cores : '–'}</dd>
        <dt>PHP memory</dt><dd>${escT(st.php_mem ? st.php_mem.limit : '–')} limit · ${srvBytes(st.php_mem && st.php_mem.peak)} peak</dd>
        <dt>Server time</dt><dd>${new Date(st.time * 1000).toLocaleString('nl-NL')}</dd>
        <dt>Domains</dt><dd>${api && api.domains != null ? api.domains : '–'}</dd>
    </dl></div>`;
}

function srvDbPanel(api) {
    const s = (api && api.server) || {}, ext = s.extensions || {};
    const pill = (n, ok) => `<span class="tpill ${ok ? 't-green' : 't-red'}">${n}: ${ok ? 'yes' : 'no'}</span>`;
    const db = s.db ? `<dl class="kv">
            <dt>Checks stored</dt><dd>${Number(s.db.checks).toLocaleString('nl-NL')}</dd>
            <dt>Incidents</dt><dd>${Number(s.db.incidents).toLocaleString('nl-NL')}</dd>
            <dt>Sites scanned</dt><dd>${Number(s.db.scanned).toLocaleString('nl-NL')}</dd>
            <dt>File size</dt><dd>${s.db.size_kb} KB</dd></dl>`
        : '<p class="muted">SQLite unavailable. Check that php-sqlite3 is installed and the folder is writable.</p>';
    return `<div class="panel"><h3>Database</h3>${db}</div>
        <div class="panel"><h3>Extensions</h3><p>${pill('curl', ext.curl)} ${pill('pdo_sqlite', ext.pdo_sqlite)} ${pill('mysqli', ext.mysqli)} ${pill('openssl', ext.openssl)}</p></div>`;
}

/* ---------- live section ---------- */
function srvLive(live, st, first) {
    srvLast = st;
    const mem = st.memory || srvMemoryFallback(srvApi);
    const cpu = st.cpu || {}, host = st.host || {}, d = st.disk || {};
    const rows = srvDown(st.history || [], 120);

    const tiles = [];
    if (cpu.pct != null) tiles.push(srvTile(srvPct(cpu.pct), 'CPU', `${cpu.cores} cores`, srvLvl(cpu.pct)));
    if (mem) tiles.push(srvTile(srvPct(mem.pct), 'Memory', `${srvBytes(mem.used)} / ${srvBytes(mem.total)}`, srvLvl(mem.pct)));
    if (d.total > 0) tiles.push(srvTile(srvPct(d.pct), 'Disk', `${srvBytes(d.free)} free`, srvLvl(d.pct)));
    if (cpu.load) {
        const r = cpu.load[0] / (cpu.cores || 1);
        tiles.push(srvTile(srvNum(cpu.load[0]), 'Load (1 min)', `${srvNum(cpu.load[1])} · ${srvNum(cpu.load[2])}`, r >= 1 ? 'bad' : r >= 0.7 ? 'warn' : 'good'));
    }
    if (host.uptime != null) tiles.push(srvTile(fmtUptime(host.uptime), 'Uptime', '', 'srv-sm'));
    if (cpu.temp != null) tiles.push(srvTile(cpu.temp.toFixed(1) + ' °C', 'Temperature', '', cpu.temp >= 80 ? 'bad' : cpu.temp >= 70 ? 'warn' : 'good'));
    if (host.procs != null) tiles.push(srvTile(String(host.procs), 'Processes', '', ''));

    const warns = (st.warnings || []).map(w => `<p>${escT(w)}</p>`).join('');
    const charts = SRV_CHARTS.filter(c => !c.optional || rows.some(r => r[c.series[0].k] != null)).map(def => {
        const legend = def.series.map(s => {
            const a = srvAgg(rows, s.k);
            return `<span><i style="background:${s.color}"></i>${s.name}${a ? ` <em>avg ${escT(def.fmt(a.avg))} · max ${escT(def.fmt(a.max))}</em>` : ''}</span>`;
        }).join('');
        return `<div class="panel"><h3>${def.title}</h3><div class="srv-chart-wrap" data-chart="${def.id}"></div><div class="srv-legend">${legend}</div></div>`;
    }).join('');

    live.classList.toggle('srv-anim', !!first);
    live.innerHTML = `${warns ? `<div class="srv-warn">${warns}</div>` : ''}
        <div class="tiles">${tiles.join('')}</div>
        <div class="srv-charts">${charts}</div>
        <div class="srv-grid">
            ${srvMemoryPanel(mem)}
            ${d.total > 0 ? `<div class="panel"><h3>Disk</h3>${meter('Disk', { percent: d.pct }, `${srvBytes(d.used)} used of ${srvBytes(d.total)}`)}</div>` : ''}
            ${srvEnginePanel(st, srvApi)}
            ${srvDbPanel(srvApi)}
        </div>`;
    live.querySelectorAll('.srv-chart-wrap').forEach(srvDrawWrap);

    const upd = document.getElementById('srv-updated');
    if (upd) upd.textContent = 'Updated ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function srvPoll(first) {
    if (location.hash !== '#server') { clearInterval(srvTimer); srvTimer = null; return; }
    if (document.hidden && !first) return;                       // pause when the tab is hidden
    const live = document.getElementById('srv-live');
    if (!live) { clearInterval(srvTimer); srvTimer = null; return; }
    try {
        const res = await fetch(`${SRV_STATS}?hours=${srvRange}`, { cache: 'no-store' });
        if (res.status === 401) { location.href = 'login.php'; return; }
        const st = await res.json();
        if (!st.ok) throw new Error(st.error || 'stats.php returned an error');
        srvLive(live, st, first);
    } catch (e) {
        if (!first) return;                                      // keep showing the last good data
        clearInterval(srvTimer); srvTimer = null;
        const body = document.getElementById('srv-body');
        srvOldRender(srvApi);                                    // fall back to the original tab
        body.insertAdjacentHTML('afterbegin',
            `<div class="srv-warn"><p>Live stats unavailable (${escT(e.message)}). Upload stats.php next to index.php and make sure the data/ folder is writable. Showing the basic view.</p></div>`);
    }
}

/* ---------- entry point: replaces tabs.js's renderServer ---------- */
window.renderServer = function (data) {
    const body = document.getElementById('srv-body');
    if (!body) return;
    srvApi = data;
    body.innerHTML = `<div class="view-head"><h2>Server</h2>
            <div class="head-right"><span class="scan-note" id="srv-updated"></span>
            <div class="seg" id="srv-range">${[1, 6, 24].map(h => `<button data-h="${h}" class="${h === srvRange ? 'on' : ''}">${h} h</button>`).join('')}</div></div>
        </div>
        <div id="srv-live"><div class="tab-loading"><span class="spinner"></span>Loading…</div></div>`;
    clearInterval(srvTimer);
    srvPoll(true);
    srvTimer = setInterval(() => srvPoll(false), 15000);
};

document.addEventListener('click', e => {
    const b = e.target.closest('#srv-range button');
    if (!b) return;
    srvRange = parseInt(b.dataset.h, 10);
    try { localStorage.setItem('srvRange', String(srvRange)); } catch (err) { /* ignore */ }
    document.querySelectorAll('#srv-range button').forEach(x => x.classList.toggle('on', x === b));
    srvPoll(true);
});