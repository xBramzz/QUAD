<?php require __DIR__ . '/auth.php'; require_login(); ?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Website Health</title>
    <link rel="stylesheet" href="style.css" />
    <link rel="stylesheet" href="home.css" />
    <link rel="stylesheet" href="tabs.css" />
</head>
<body>
    <div id="edge" aria-hidden="true"></div>
    <nav id="sidebar" aria-label="Main">
        <div class="brand"><img src="images/logo.png" alt="Qteco" onerror="this.onerror=null;this.src='images/logo.webp'" /></div>
        <a href="#live" data-view="live"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span class="label">Live</span></a>
        <a href="#inventory" data-view="inventory"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span class="label">Inventory</span></a>
        <a href="#domains" data-view="domains"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span class="label">Domains</span></a>
        <a href="#certs" data-view="certs"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span class="label">Certificates</span><span id="cert-badge" class="badge" hidden></span></a>
        <a href="#dns" data-view="dns"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="7" cy="6" r="1" fill="currentColor"/><circle cx="11" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg><span class="label">DNS</span></a>
        <a href="#security" data-view="security"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span class="label">Security</span></a>
        <a href="#analytics" data-view="analytics"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg><span class="label">Analytics</span></a>
        <a href="#incidents" data-view="incidents"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span class="label">Incidents</span><span id="inc-badge" class="badge" hidden></span></a>
        <a href="#server" data-view="server"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/></svg><span class="label">Server</span></a>
        <a href="#home" data-view="home"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg><span class="label">About</span></a>
       <form method="post" action="logout.php">
         <form class="logout-form" method="post" action="logout.php">
  <input type="hidden" name="csrf" value="<?= htmlspecialchars(csrf_token()) ?>">
  <button type="submit" class="logout-btn">
    <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <path d="m16 17 5-5-5-5"/>
      <path d="M21 12H9"/>
    </svg>
    <span>Logout</span>
  </button>
</form>
    </nav>

    <div class="main">
        <header class="Qteco">
            <div id="filter">
                <label for="status-filter">Show:</label>
                <select id="status-filter">
                    <option value="all">All</option>
                    <option value="healthy">Healthy (&lt; 1s)</option>
                    <option value="slow">Slow (&gt; 1s)</option>
                    <option value="down">Down</option>
                </select>
            </div>

            <div id="health" class="health-pill" title="Percentage of sites responding">
                <span id="health-dot"></span>
                <span id="health-text">—</span>
            </div>

            <div class="dateTime" id="time"></div>
            <div class="logo"><a href="#home" class="logo-link" title="About this dashboard" aria-label="About Website Health"><img src="images/logo.png" alt="Website Health" onerror="this.onerror=null;this.src='images/logo.webp'" /></a></div>
            <div class="dateTime" id="date"></div>

            <button id="force-refresh-btn" class="icon-btn" title="Refresh now"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg><span class="lbl">Refresh</span></button>

            <div id="theme-container">
                <select id="theme-select">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
            </div>

            <button id="kiosk-btn" class="icon-btn" title="Fullscreen mode"><svg class="ico in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span class="lbl in">Fullscreen</span><svg class="ico out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg><span class="lbl out">Exit</span></button>
        </header>

        <section id="view-home" class="view view-scroll home" hidden>
            <div id="home-body">
                <h2>Website Health</h2>
                <p class="lead">This dashboard checks all our websites around the clock and shows which ones are up, which are slow and which are down. Use it on a wall screen to see problems at a glance, or open Analytics to look back at how a site did over the last day, week or month.</p>
                <a class="home-btn" href="#live">Open the live view</a>

                <h3>The pages</h3>
                <dl class="parts">
                    <div><dt>Live</dt><dd>Every site as a card with its status, response time and a small graph of recent checks.</dd></div>
                    <div><dt>Inventory</dt><dd>The full catalogue of hosted sites: IP address, web server, page title, detected technology, redirects and size. Search, sort and export to CSV.</dd></div>
                    <div><dt>Domains</dt><dd>Sites grouped by their root domain, with a breakdown of extensions and subdomains.</dd></div>
                    <div><dt>Certificates</dt><dd>TLS certificates per site: who issued them, when they expire and how many days are left. Expiring certificates get a red number on the menu item.</dd></div>
                    <div><dt>DNS</dt><dd>The DNS records behind every site: addresses, mail servers, name servers and text records.</dd></div>
                    <div><dt>Security</dt><dd>A report card per site for security headers like HSTS, CSP and clickjacking protection.</dd></div>
                    <div><dt>Analytics</dt><dd>Uptime, average response time and number of checks for 24 hours, 7 days or 30 days.</dd></div>
                    <div><dt>Incidents</dt><dd>Every outage with the site, when it started, how long it lasted and whether it is resolved.</dd></div>
                    <div><dt>Server</dt><dd>Health of the machine running this dashboard: memory, disk, load, uptime and the check engine itself.</dd></div>
                </dl>

                <h3>Reading the numbers</h3>
                <p>A site counts as up when it answers with a normal page or a redirect (status 200 to 399). Anything else, including no answer at all, counts as down and starts an incident.</p>
                <ul class="key">
                    <li><i class="k-good"></i>Uptime of 99.9% or more is good.</li>
                    <li><i class="k-warn"></i>Uptime between 99% and 99.9% needs a look.</li>
                    <li><i class="k-bad"></i>Uptime below 99% is a problem.</li>
                </ul>
                <p>Response times in the charts are capped at 5 seconds. Deep information (certificates, DNS, headers) is refreshed in small batches every few hours so the monitored sites are never overloaded — use the Rescan button on those pages to push the queue.</p>
            </div>
        </section>
        <section id="view-live" class="view"><div id="card-container"></div></section>
        <section id="view-inventory" class="view view-scroll" hidden><div id="inv-body"></div></section>
        <section id="view-domains" class="view view-scroll" hidden><div id="dom-body"></div></section>
        <section id="view-certs" class="view view-scroll" hidden><div id="cert-body"></div></section>
        <section id="view-dns" class="view view-scroll" hidden><div id="dns-body"></div></section>
        <section id="view-security" class="view view-scroll" hidden><div id="sec-body"></div></section>
        <section id="view-analytics" class="view view-scroll" hidden><div id="an-body"></div></section>
        <section id="view-incidents" class="view view-scroll" hidden><div id="inc-body"></div></section>
        <section id="view-server" class="view view-scroll" hidden><div id="srv-body"></div></section>

        <footer id="server-stats"></footer>
        <div id="toasts"></div>
    </div>

    <script src="app.js"></script>
    <script src="analytics.js"></script>
    <script src="tabs.js"></script>
</body>
</html> 