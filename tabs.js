/* =========================================================
   WEBSITE HEALTH — tabs.js
   Inventory / Domains / Certificates / DNS / Security / Server views.
   Talks to api.php?action=<view>; shares one meta payload per load.
   Defensive: never throws if analytics.js or app.js is missing.
   ========================================================= */

const TAB_API    = (typeof API_URL !== 'undefined') ? API_URL : 'api.php';
const escT       = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate    = t => t ? new Date(t * 1000).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }) : '–';
const fmtAtT     = t => t ? new Date(t * 1000).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
const fmtUptime  = s => {
    if (s == null) return '–';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + ' d ' : '') + (d || h ? h + ' h ' : '') + m + ' min';
};

const TAB_DEFS = [
    { view: 'inventory', action: 'inventory',  body: 'inv-body'  },
    { view: 'domains',   action: 'domains',    body: 'dom-body'  },
    { view: 'certs',     action: 'certs',      body: 'cert-body' },
    { view: 'dns',       action: 'dns',        body: 'dns-body'  },
    { view: 'security',  action: 'security',   body: 'sec-body'  },
    { view: 'server',    action: 'server',     body: 'srv-body'  },
];

let tabCache = {};          // action -> payload
let tabQuery = {};          // view -> search text
let tabSort  = {};          // view -> { key, dir }
let tabLiveStatus = {};     // url -> status from the live poller

const currentTabView = () => { const h = location.hash.slice(1); return TAB_DEFS.some(t => t.view === h) ? h : null; };

/* ---------- LOAD ---------- */
async function loadTab(def, force) {
    const body = document.getElementById(def.body);
    if (!body) return;
    if (!force && tabCache[def.action]) { renderTab(def, tabCache[def.action]); return; }
    body.innerHTML = '<div class="tab-loading"><span class="spinner"></span>Loading…</div>';
    try {
        const res = await fetch(`${TAB_API}?action=${def.action}${force ? '&refresh=1' : ''}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        tabCache[def.action] = data;
        if (currentView() === def.view) renderTab(def, data);
    } catch (e) {
        body.innerHTML = `<div class="error-banner">${escT(e.message)}</div>`;
    }
}

function renderTab(def, data) {
    switch (def.view) {
        case 'inventory': renderInventory(data); break;
        case 'domains':   renderDomains(data);   break;
        case 'certs':     renderCerts(data);     break;
        case 'dns':       renderDns(data);       break;
        case 'security':  renderSecurity(data);  break;
        case 'server':    renderServer(data);    break;
    }
    if (def.view === 'certs') updateCertBadge(data);
}

/* ---------- SHARED BITS ---------- */
function siteName(url) {
    const st = tabLiveStatus[url];
    const cls = st == null ? 't-grey' : (st >= 200 && st < 400 ? 't-green' : 't-red');
    return `<td><div class="cell-site">
        <img class="tfav" loading="lazy" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(url)}.ico"
             onerror="this.onerror=null;this.style.visibility='hidden'" alt="">
        <div><a class="tlink" href="https://${escT(url)}" target="_blank" rel="noopener">${escT(url)}</a>
        <div class="sub">${escT(titleOf(url))}</div></div>
        <span class="tpill ${cls}">${st == null ? '?' : st}</span>
    </div></td>`;
}
function titleOf(url) {
    const d = (tabCache.inventory && tabCache.inventory.sites || []).find(x => x.url === url);
    return d && d.http && d.http.title ? d.http.title : '';
}

function toolsHtml(view, placeholder) {
    return `<div class="tab-tools">
        <input class="search tab-search" data-tab-search="${view}" placeholder="${placeholder}" value="${escT(tabQuery[view] || '')}">
        <button class="icon-btn" data-rescan="${view}">↻ Rescan</button>
        <button class="icon-btn" data-csv="${view}">⇩ CSV</button>
    </div>`;
}

function headHtml(title, count, view, placeholder) {
    return `<div class="view-head"><h2>${title}<span class="count-chip">${count}</span></h2></div>${toolsHtml(view, placeholder)}`;
}

function progressNote(p) {
    if (!p) return '';
    return p.pending > 0
        ? `<p class="muted foot-note">Deep scan in progress — ${p.scanned_now} sites scanned this pass, ${p.pending} still queued. They will fill in automatically over the next minutes.</p>`
        : '';
}

function filteredSites(sites, view, fieldsFn) {
    const q = (tabQuery[view] || '').toLowerCase();
    let rows = sites.filter(s => !q || fieldsFn(s).join(' ').toLowerCase().includes(q));
    const sort = tabSort[view];
    if (sort) {
        rows = rows.slice().sort((a, b) => {
            const av = a[sort.key], bv = b[sort.key];
            const an = av == null || isNaN(av), bn = bv == null || isNaN(bv);
            let r;
            if (an && bn) r = String(av).localeCompare(String(bv));
            else if (an) r = 1;
            else if (bn) r = -1;
            else r = (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)));
            return sort.dir === 'asc' ? r : -r;
        });
    }
    return rows;
}

function tableHead(view, cols) {
    return '<tr>' + cols.map(c =>
        `<th class="sortable ${c.num ? 'num' : ''}" data-sort-key="${c.key}" data-sort-view="${view}">${c.label}${sortArrow(view, c.key)}</th>`
    ).join('') + '</tr>';
}
function sortArrow(view, key) {
    const s = tabSort[view];
    if (!s || s.key !== key) return '';
    return s.dir === 'asc' ? ' ▲' : ' ▼';
}

function bindRowDrawers(bodyEl, sites) {
    bodyEl.querySelectorAll('.trow').forEach(row => {
        row.addEventListener('click', e => {
            if (e.target.closest('a')) return;
            openDrawer(sites.find(s => s.url === row.dataset.url));
        });
    });
}

/* ---------- INVENTORY ---------- */
function invFields(s) {
    const h = s.http || {};
    return [s.url, h.title || '', h.server || '', (h.tech || []).join(' '), h.final_url || '', s.ip || ''];
}
function renderInventory(data) {
    const body = document.getElementById('inv-body');
    if (!body) return;
    const sites = data.sites || [];
    const rows = filteredSites(sites, 'inventory', invFields);
    body.innerHTML = `${headHtml('Inventory', sites.length, 'inventory', 'Search sites, servers, tech…')}
        <div class="panel table-wrap"><table class="data tab-table">
        <thead>${tableHead('inventory', [
            { key: 'url', label: 'Site' }, { key: 'ip', label: 'IP' }, { key: 'server', label: 'Server' },
            { key: 'tech', label: 'Technology' }, { key: 'size_kb', label: 'Size', num: true }, { key: 'redirects', label: 'Redirects', num: true },
        ])}</thead>
        <tbody>${rows.map(s => {
            const h = s.http || {};
            return `<tr class="trow" data-url="${escT(s.url)}">
                <td><div class="cell-site">
                    <img class="tfav" loading="lazy" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(s.url)}.ico" onerror="this.onerror=null;this.style.visibility='hidden'" alt="">
                    <div><a class="tlink" href="https://${escT(s.url)}" target="_blank" rel="noopener">${escT(s.url)}</a>
                    <div class="sub" title="${escT(h.title || '')}">${escT(h.title || '')}</div></div>
                </div></td>
                <td class="tmono">${escT(s.ip || '–')}</td>
                <td>${escT(h.server || '–')}</td>
                <td>${(h.tech || []).map(t => `<span class="tpill t-blue">${escT(t)}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
                <td class="num">${h.size_kb != null ? escT(h.size_kb) + ' KB' : '–'}</td>
                <td class="num">${h.redirects ? `<span class="redirect-chip">→ ${escT(h.redirects)}</span>` : '–'}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">No sites match.</td></tr>'}</tbody>
        </table></div>${progressNote(data.progress)}`;
    bindRowDrawers(body, sites);
}

/* ---------- DOMAINS ---------- */
function renderDomains(data) {
    const body = document.getElementById('dom-body');
    if (!body) return;
    const groups = data.groups || [];
    const tlds = data.tlds || {};
    const maxTld = Math.max(...Object.values(tlds), 1);
    const q = (tabQuery.domains || '').toLowerCase();
    const shown = groups.filter(g => !q || JSON.stringify(g).toLowerCase().includes(q));
    body.innerHTML = `${headHtml('Domains', groups.length, 'domains', 'Search domains…')}
        <div class="panel"><h3>Extensions</h3><div class="tld-chart">${Object.entries(tlds).map(([t, n], i) => `
            <div class="tld-row"><span class="tld-name">.${escT(t)}</span>
            <div class="tld-bar"><i style="width:${(n / maxTld * 100).toFixed(1)}%;background:var(--blue);animation-delay:${i * 40}ms"></i></div>
            <b>${n}</b></div>`).join('')}</div>
        </div>
        <div class="domain-grid">${shown.map(g => `
            <div class="panel domain-card"><div class="domain-head"><h3>${escT(g.root)}</h3><span class="tpill t-grey">.${escT(g.tld)}</span></div>
            <ul class="domain-list">${g.sites.map(s => `
                <li>${s.is_subdomain ? '<span class="sub-tag">sub</span>' : '<span class="sub-tag" style="background:var(--purple);color:var(--purple-text)">root</span>'}
                <a class="tlink" href="https://${escT(s.url)}" target="_blank" rel="noopener">${escT(s.url)}</a>
                <span class="tpill ${s.status >= 200 && s.status < 400 ? 't-green' : s.status ? 't-red' : 't-grey'}">${s.status || '?'}</span></li>`).join('')}
            </ul></div>`).join('') || '<p class="muted">No domains match.</p>'}
        </div>${progressNote(data.progress)}`;
}

/* ---------- CERTIFICATES ---------- */
function certDaysLeft(d) {
    if (!d.cert) return null;
    if (typeof d.cert.days_left === 'number') return d.cert.days_left;
    return d.cert.valid_to ? Math.floor((d.cert.valid_to - Date.now() / 1000) / 86400) : null;
}
function certPill(days) {
    if (days == null) return '<span class="tpill t-grey">no TLS info</span>';
    if (days < 0)   return `<span class="tpill t-red">expired ${-days} d ago</span>`;
    if (days <= 21) return `<span class="tpill t-amber">${days} d left</span>`;
    return `<span class="tpill t-green">${days} d left</span>`;
}
function updateCertBadge(data) {
    const badge = document.getElementById('cert-badge');
    if (!badge) return;
    const n = (data.sites || []).filter(s => { const d = certDaysLeft(s); return d != null && d <= 21; }).length;
    badge.textContent = n; badge.hidden = !n;
}
function renderCerts(data) {
    const body = document.getElementById('cert-body');
    if (!body) return;
    const sites = (data.sites || []).map(s => Object.assign({}, s, { days_left: certDaysLeft(s) }));
    const rows = filteredSites(sites, 'certs', s => [s.url, (s.cert && (s.cert.issuer + ' ' + s.cert.subject)) || '']);
    body.innerHTML = `${headHtml('Certificates', sites.length, 'certs', 'Search issuers, sites…')}
        <div class="panel table-wrap"><table class="data tab-table">
        <thead>${tableHead('certs', [
            { key: 'url', label: 'Site' }, { key: 'issuer', label: 'Issuer' }, { key: 'subject', label: 'Subject' },
            { key: 'valid_from', label: 'Valid from' }, { key: 'valid_to', label: 'Valid until' },
            { key: 'days_left', label: 'Days left', num: true },
        ])}</thead>
        <tbody>${rows.map(s => {
            const c = s.cert || {};
            return `<tr class="trow" data-url="${escT(s.url)}">
                <td>${escT(s.url)} ${certPill(s.days_left)}</td>
                <td>${escT(c.issuer || '–')}</td>
                <td>${escT(c.subject || '–')}</td>
                <td>${c.valid_from ? fmtDate(c.valid_from) : '–'}</td>
                <td>${c.valid_to ? fmtDate(c.valid_to) : '–'}</td>
                <td class="num">${s.days_left == null ? '–' : s.days_left}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">No certificates found yet.</td></tr>'}</tbody>
        </table></div>${progressNote(data.progress)}`;
    bindRowDrawers(body, sites);
}

/* ---------- DNS ---------- */
function renderDns(data) {
    const body = document.getElementById('dns-body');
    if (!body) return;
    const sites = data.sites || [];
    const rows = filteredSites(sites, 'dns', s => {
        const d = s.dns || {};
        return [s.url, (d.a || []).join(' '), (d.aaaa || []).join(' '), (d.ns || []).join(' '), (d.mx || []).map(m => m.target).join(' '), (d.txt || []).join(' ')];
    });
    body.innerHTML = `${headHtml('DNS', sites.length, 'dns', 'Search records…')}
        <div class="panel table-wrap"><table class="data tab-table">
        <thead><tr><th>Site</th><th>A</th><th>MX</th><th>NS</th><th>TXT</th></tr></thead>
        <tbody>${rows.map(s => {
            const d = s.dns || {};
            return `<tr class="trow" data-url="${escT(s.url)}">
                <td>${escT(s.url)}</td>
                <td>${(d.a || []).map(ip => `<div class="tmono">${escT(ip)}</div>`).join('') || '<span class="muted">–</span>'}</td>
                <td>${(d.mx || []).map(m => `<div><span class="mx-pri">${m.pri}</span> ${escT(m.target)}</div>`).join('') || '<span class="muted">–</span>'}</td>
                <td>${(d.ns || []).map(n => `<div>${escT(n)}</div>`).join('') || '<span class="muted">–</span>'}</td>
                <td>${(d.txt || []).slice(0, 3).map(t => `<div class="txt-rec sub" title="${escT(t)}">${escT(t)}</div>`).join('') || '<span class="muted">–</span>'}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="muted">No DNS data yet.</td></tr>'}</tbody>
        </table></div>${progressNote(data.progress)}`;
    bindRowDrawers(body, sites);
}

/* ---------- SECURITY ---------- */
const SEC_LABELS = { hsts: 'HSTS', csp: 'CSP', xframe: 'Frame', xcto: 'Nosniff', referrer: 'Referrer', permissions: 'Permissions', https: 'HTTPS' };
function renderSecurity(data) {
    const body = document.getElementById('sec-body');
    if (!body) return;
    const sites = (data.sites || []).map(s => Object.assign({}, s, { grade: (s.security || {}).grade || '?' }));
    const rows = filteredSites(sites, 'security', s => [s.url, s.grade]);
    const gradeCls = g => g === 'A' ? 't-green' : g === 'B' ? 't-blue' : g === 'C' ? 't-amber' : g === 'F' ? 't-red' : 't-grey';
    body.innerHTML = `${headHtml('Security', sites.length, 'security', 'Search sites…')}
        <div class="panel table-wrap"><table class="data tab-table">
        <thead>${tableHead('security', [{ key: 'url', label: 'Site' }, { key: 'grade', label: 'Grade' }, { key: 'checks', label: 'Headers' }])}</thead>
        <tbody>${rows.map(s => {
            const sec = s.security || { checks: {}, score: 0 };
            return `<tr class="trow" data-url="${escT(s.url)}">
                <td>${escT(s.url)}</td>
                <td><span class="tpill grade ${gradeCls(sec.grade)}">${escT(sec.grade || '?')}</span> <span class="muted">${sec.score || 0}/7</span></td>
                <td><div class="sec-checks">${Object.keys(SEC_LABELS).map(k =>
                    `<span class="sec-dot ${sec.checks && sec.checks[k] ? 'on' : 'off'}" title="${SEC_LABELS[k]}: ${sec.checks && sec.checks[k] ? 'present' : 'missing'}">${SEC_LABELS[k][0]}</span>`).join('')}</div></td>
            </tr>`;
        }).join('') || '<tr><td colspan="3" class="muted">No security data yet.</td></tr>'}</tbody>
        </table></div>
        <p class="muted sec-legend"><span>H</span>HSTS <span>C</span>CSP <span>F</span>X-Frame-Options/frame-ancestors <span>N</span>X-Content-Type-Options <span>R</span>Referrer-Policy <span>P</span>Permissions-Policy <span>S</span>HTTPS</p>
        ${progressNote(data.progress)}`;
    bindRowDrawers(body, sites);
}

/* ---------- SERVER ---------- */
function meter(label, d, sub) {
    if (!d) return `<div class="srv-meter"><div class="srv-meter-head"><span>${label}</span><span class="muted">n/a</span></div></div>`;
    const pct = Math.min(100, d.percent);
    const color = pct >= 90 ? 'var(--red)' : pct >= 80 ? 'var(--orange)' : 'var(--green)';
    return `<div class="srv-meter"><div class="srv-meter-head"><span>${label}</span><span>${d.percent}%</span></div>
        <div class="tld-bar"><i style="width:${pct}%;background:${color}"></i></div>${sub ? `<p class="srv-sub">${sub}</p>` : ''}</div>`;
}
function renderServer(data) {
    const body = document.getElementById('srv-body');
    if (!body) return;
    const s = data.server || {};
    const ext = s.extensions || {};
    const pill = (name, ok) => `<span class="tpill ${ok ? 't-green' : 't-red'}">${name}: ${ok ? 'yes' : 'no'}</span>`;
    body.innerHTML = `<div class="view-head"><h2>Server</h2><span class="scan-note">Updated ${fmtAtT(Math.floor(Date.now() / 1000))}</span></div>
        <div class="srv-grid">
            <div class="panel"><h3>Resources</h3>
                ${meter('Memory', s.mem, s.mem ? `${s.mem.used_mb} / ${s.mem.total_mb} MB` : '')}
                ${meter('Disk', s.disk, s.disk ? `${s.disk.free_gb} GB free of ${s.disk.total_gb} GB` : '')}
                <div class="srv-meter"><div class="srv-meter-head"><span>Load average</span><span>${s.load ? s.load.map(l => Number(l).toFixed(2)).join(' / ') : 'n/a'}</span></div></div>
                <div class="srv-meter"><div class="srv-meter-head"><span>Uptime</span><span>${s.uptime != null ? fmtUptime(s.uptime) : 'n/a'}</span></div></div>
            </div>
            <div class="panel"><h3>Engine</h3><dl class="kv">
                <dt>PHP</dt><dd class="tmono">${escT(s.php || '?')}</dd>
                <dt>OS</dt><dd>${escT(s.os || '?')}</dd>
                <dt>Hostname</dt><dd>${escT(s.host || '?')}</dd>
                <dt>Timezone</dt><dd>${escT(s.timezone || '?')}</dd>
                <dt>Server time</dt><dd>${escT(s.time || '?')}</dd>
                <dt>Domains</dt><dd>${data.domains != null ? data.domains : '–'}</dd>
            </dl></div>
            <div class="panel"><h3>Database</h3>${s.db ? `<dl class="kv">
                <dt>Checks stored</dt><dd>${Number(s.db.checks).toLocaleString('nl-NL')}</dd>
                <dt>Incidents</dt><dd>${Number(s.db.incidents).toLocaleString('nl-NL')}</dd>
                <dt>Sites scanned</dt><dd>${Number(s.db.scanned).toLocaleString('nl-NL')}</dd>
                <dt>File size</dt><dd>${s.db.size_kb} KB</dd>
            </dl>` : '<p class="muted">SQLite unavailable — check that php-sqlite3 is installed and the folder is writable.</p>'}</div>
            <div class="panel"><h3>Extensions</h3><p>
                ${pill('curl', ext.curl)} ${pill('pdo_sqlite', ext.pdo_sqlite)} ${pill('mysqli', ext.mysqli)} ${pill('openssl', ext.openssl)}
            </p></div>
        </div>`;
}

/* ---------- DRAWER (site details) ---------- */
function findMeta(url) {
    for (const key of ['inventory', 'certs', 'dns', 'security']) {
        const hit = ((tabCache[key] || {}).sites || []).find(s => s.url === url);
        if (hit) return hit;
    }
    return null;
}
function openDrawer(site) {
    if (!site) return;
    closeDrawer();
    const overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'tab-drawer';
    const h = site.http || {}, d = site.dns || {}, c = site.cert || {}, sec = site.security || { checks: {} };
    overlay.innerHTML = `<div class="drawer">
        <div class="drawer-head"><div><h3>${escT(site.url)}</h3><p class="muted">${escT(h.title || '')}</p></div>
        <button class="icon-btn drawer-close">✕ Close</button></div>
        <div class="drawer-body">
            <div class="drawer-sec"><h4>Web</h4><dl class="kv">
                <dt>Status</dt><dd>${h.status || '–'}</dd>
                <dt>Final URL</dt><dd>${escT(h.final_url || '–')}</dd>
                <dt>Server</dt><dd>${escT(h.server || '–')}</dd>
                <dt>Powered by</dt><dd>${escT(h.powered_by || '–')}</dd>
                <dt>Technology</dt><dd>${(h.tech || []).join(', ') || '–'}</dd>
                <dt>Size</dt><dd>${h.size_kb != null ? h.size_kb + ' KB' : '–'}</dd>
            </dl></div>
            <div class="drawer-sec"><h4>Certificate</h4><dl class="kv">
                <dt>Issuer</dt><dd>${escT(c.issuer || '–')}</dd>
                <dt>Subject</dt><dd>${escT(c.subject || '–')}</dd>
                <dt>Valid until</dt><dd>${c.valid_to ? fmtDate(c.valid_to) : '–'}</dd>
                <dt>Days left</dt><dd>${c.days_left != null ? c.days_left : '–'}</dd>
                <dt>SANs</dt><dd>${(c.sans || []).slice(0, 8).map(escT).join('<br>') || '–'}</dd>
            </dl></div>
            <div class="drawer-sec"><h4>DNS</h4><dl class="kv">
                <dt>A</dt><dd>${(d.a || []).join(', ') || '–'}</dd>
                <dt>AAAA</dt><dd>${(d.aaaa || []).join(', ') || '–'}</dd>
                <dt>MX</dt><dd>${(d.mx || []).map(m => `${m.pri} ${escT(m.target)}`).join('<br>') || '–'}</dd>
                <dt>NS</dt><dd>${(d.ns || []).join(', ') || '–'}</dd>
                <dt>CNAME</dt><dd>${escT(d.cname || '–')}</dd>
            </dl></div>
            <div class="drawer-sec"><h4>Security headers (${sec.score != null ? sec.score + '/7 · grade ' + escT(sec.grade) : '–'})</h4><dl class="kv">
                ${Object.keys(SEC_LABELS).map(k => `<dt>${SEC_LABELS[k]}</dt><dd>${sec.checks && sec.checks[k] ? '✔ present' : '✘ missing'}</dd>`).join('')}
            </dl></div>
            <div class="drawer-actions">
                <a class="icon-btn" href="https://${escT(site.url)}" target="_blank" rel="noopener">Open site</a>
                <a class="icon-btn" href="#live">Live view</a>
            </div>
        </div></div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('.drawer-close')) closeDrawer(); });
    document.addEventListener('keydown', onDrawerKey);
}
function onDrawerKey(e) { if (e.key === 'Escape') closeDrawer(); }
function closeDrawer() {
    const el = document.getElementById('tab-drawer');
    if (el) el.remove();
    document.removeEventListener('keydown', onDrawerKey);
}

/* ---------- CSV EXPORT ---------- */
function exportCsv(view) {
    let heads, rows;
    const sites = (tabCache.inventory || {}).sites || [];
    const certs = (tabCache.certs || {}).sites || [];
    if (view === 'inventory') {
        heads = ['url', 'ip', 'status', 'title', 'server', 'technology', 'size_kb', 'redirects'];
        rows = sites.map(s => { const h = s.http || {}; return [s.url, s.ip || '', h.status || '', h.title || '', h.server || '', (h.tech || []).join('|'), h.size_kb == null ? '' : h.size_kb, h.redirects || 0]; });
    } else if (view === 'certs') {
        heads = ['url', 'issuer', 'subject', 'valid_from', 'valid_to', 'days_left'];
        rows = certs.map(s => { const c = s.cert || {}; return [s.url, c.issuer || '', c.subject || '', c.valid_from ? new Date(c.valid_from * 1000).toISOString().slice(0, 10) : '', c.valid_to ? new Date(c.valid_to * 1000).toISOString().slice(0, 10) : '', c.days_left == null ? '' : c.days_left]; });
    } else return;
    const csv = [heads].concat(rows).map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${view}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- LIVE STATUS HOOK ---------- */
window.onLiveSites = function (sites) {
    (sites || []).forEach(s => tabLiveStatus[s.url] = s.status);
};

/* ---------- EVENTS ---------- */
document.addEventListener('click', e => {
    const resc = e.target.closest('[data-rescan]');
    if (resc) {
        const def = TAB_DEFS.find(t => t.view === resc.dataset.rescan);
        if (def) { resc.disabled = true; loadTab(def, true).finally(() => { resc.disabled = false; }); }
        return;
    }
    const csv = e.target.closest('[data-csv]');
    if (csv) { exportCsv(csv.dataset.csv); return; }
    const th = e.target.closest('th.sortable');
    if (th) {
        const view = th.dataset.sortView, key = th.dataset.sortKey;
        const cur = tabSort[view];
        tabSort[view] = (cur && cur.key === key) ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
        const def = TAB_DEFS.find(t => t.view === view);
        if (def && tabCache[def.action]) renderTab(def, tabCache[def.action]);
    }
});
document.addEventListener('input', e => {
    const inp = e.target.closest('[data-tab-search]');
    if (!inp) return;
    tabQuery[inp.dataset.tabSearch] = inp.value;
    const def = TAB_DEFS.find(t => t.view === inp.dataset.tabSearch);
    if (def && tabCache[def.action]) {
        renderTab(def, tabCache[def.action]);
        const again = document.querySelector(`[data-tab-search="${def.view}"]`);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }
});
window.addEventListener('hashchange', () => {
    const view = currentTabView();
    if (!view) return;
    const def = TAB_DEFS.find(t => t.view === view);
    if (def) loadTab(def);
    // background-refresh the certificate badge so it stays accurate everywhere
    if (view !== 'certs') loadTab(TAB_DEFS.find(t => t.view === 'certs'));
});
document.addEventListener('DOMContentLoaded', () => {
    const view = currentTabView();
    if (view) {
        const def = TAB_DEFS.find(t => t.view === view);
        if (def) loadTab(def);
    } else {
        // background-refresh the certificate badge so it stays accurate everywhere
        loadTab(TAB_DEFS.find(t => t.view === 'certs'));
    }
});
