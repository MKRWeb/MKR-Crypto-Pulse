(function () {
    'use strict';

    // Immutable Configuration
    const CONFIG = Object.freeze({
        APP_NAME: "MKR Crypto Pulse",
        CG_API_KEY: "", // Optional: Add CoinGecko Demo API key if needed
        CACHE_TTL: 300000, // 5 minutes
        FETCH_TIMEOUT: 8000,
        NEWS_ENDPOINTS: Object.freeze([
            {
                name: "CryptoCompare Direct",
                url: "https://min-api.cryptocompare.com/data/v2/news/?lang=EN",
                parser: (json) => {
                    if (!json || !Array.isArray(json.Data)) throw new Error("Invalid CC format");
                    return json.Data.map(item => ({
                        title: item.title,
                        url: item.url,
                        source: item.source_info ? item.source_info.name : (item.source || "CryptoCompare"),
                        score: (item.upvotes || 0) + (item.views || 0),
                        published: item.published_on * 1000
                    }));
                }
            },
            {
                name: "CoinTelegraph Live Feed",
                url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fcointelegraph.com%2Frss",
                parser: (json) => {
                    if (!json || json.status !== 'ok' || !Array.isArray(json.items)) throw new Error("Invalid RSS format");
                    return json.items.map((item, idx) => ({
                        title: item.title,
                        url: item.link,
                        source: "CoinTelegraph",
                        score: 100 - idx,
                        published: new Date(item.pubDate).getTime() || Date.now()
                    }));
                }
            },
            {
                name: "CoinDesk Live Feed",
                url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.coindesk.com%2Farc%2Foutboundfeeds%2Frss%2F",
                parser: (json) => {
                    if (!json || json.status !== 'ok' || !Array.isArray(json.items)) throw new Error("Invalid RSS format");
                    return json.items.map((item, idx) => ({
                        title: item.title,
                        url: item.link,
                        source: "CoinDesk",
                        score: 80 - idx,
                        published: new Date(item.pubDate).getTime() || Date.now()
                    }));
                }
            }
        ])
    });

    // Private Application State
    let currentData = [];
    let rawNews = [];
    let newsFilter = 'latest';
    let activeTab = 'market';

    // DOM References
    const dom = {
        modal: document.getElementById('chart-modal'),
        modalBody: document.getElementById('modal-body'),
        modalTitle: document.getElementById('modal-title'),
        closeBtn: document.getElementById('close-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        searchInput: document.getElementById('search-input'),
        hero: document.getElementById('home-hero'),
        heroTitle: document.getElementById('hero-title'),
        globalStats: document.getElementById('global-stats'),
        marketList: document.getElementById('market-list'),
        newsContent: document.getElementById('news-content'),
        newsBadge: document.getElementById('news-source-badge'),
        videoContent: document.getElementById('video-content'),
        fgImage: document.getElementById('fg-image'),
        btnLatest: document.getElementById('btn-latest'),
        btnTrending: document.getElementById('btn-trending'),
        views: {
            market: document.getElementById('market-list-view'),
            news: document.getElementById('news-view'),
            video: document.getElementById('video-view'),
            fg: document.getElementById('fg-view')
        }
    };

    // Security Helper: Prevent XSS when injecting remote strings
    function sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = String(str || '');
        return temp.innerHTML;
    }

    // Network Helper: Fetch with AbortController Timeout
    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            return response;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    // Safe LocalStorage Wrapper
    const Storage = {
        get(key) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : null;
            } catch (e) {
                return null;
            }
        },
        set(key, val) {
            try {
                localStorage.setItem(key, JSON.stringify(val));
            } catch (e) {
                console.warn("Storage quota exceeded");
            }
        }
    };

    // Tab Navigation
    function switchTab(tab, isBackAction = false) {
        if (!dom.views[tab]) return;
        if (tab !== activeTab) {
            activeTab = tab;
            if (!isBackAction) {
                window.history.pushState({ tab: tab }, "", "#" + tab);
            }
            renderTab(tab);
        }
    }

    function renderTab(tab) {
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });

        Object.keys(dom.views).forEach(key => {
            dom.views[key].classList.toggle('view-hidden', key !== tab);
        });

        if (tab === 'market') {
            dom.hero.classList.remove('view-hidden');
            dom.heroTitle.textContent = CONFIG.APP_NAME;
            loadCrypto();
        } else if (tab === 'news') {
            dom.hero.classList.add('view-hidden');
            loadNews();
        } else if (tab === 'video') {
            dom.hero.classList.remove('view-hidden');
            dom.heroTitle.textContent = "Safe Market Videos";
            loadVideos();
        } else if (tab === 'fg') {
            dom.hero.classList.remove('view-hidden');
            dom.heroTitle.textContent = "Market Sentiment";
        }
    }

    // Market Data Loader
    async function loadCrypto(force = false) {
        const cached = Storage.get('mkr_crypto_data');
        const lastFetch = Storage.get('mkr_crypto_time');
        const headers = CONFIG.CG_API_KEY ? { 'x-cg-demo-api-key': CONFIG.CG_API_KEY } : {};

        // Global Market Cap Header
        try {
            const globalRes = await fetchWithTimeout('https://api.coingecko.com/api/v3/global', { headers });
            if (globalRes.ok) {
                const globalData = await globalRes.json();
                const totalCap = globalData.data.total_market_cap.usd;
                const capChange = globalData.data.market_cap_change_percentage_24h_usd;
                const formattedCap = (totalCap / 1e12).toFixed(2) + 'T';
                const isUp = capChange >= 0;
                dom.globalStats.innerHTML = `Global Cap: <span style="font-weight:800">$${sanitizeHTML(formattedCap)}</span> <span class="${isUp ? 'up' : 'down'}" style="font-size:0.85rem; font-weight:700">(${isUp ? '▲' : '▼'}${Math.abs(capChange).toFixed(1)}%)</span>`;
            }
        } catch (e) {
            // Keep previous or default text if offline
        }

        if (!force && cached && lastFetch && (Date.now() - lastFetch < CONFIG.CACHE_TTL)) {
            currentData = cached;
            renderMarket(currentData);
            return;
        }

        try {
            const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1', { headers });
            if (!res.ok) throw new Error("Rate Limit");
            const data = await res.json();
            currentData = data.map(c => ({
                n: String(c.name || ''),
                s: String(c.symbol || '').toUpperCase(),
                p: Number(c.current_price || 0),
                ch: Number(c.price_change_percentage_24h || 0)
            }));
            Storage.set('mkr_crypto_data', currentData);
            Storage.set('mkr_crypto_time', Date.now());
            renderMarket(currentData);
        } catch (e) {
            if (cached && cached.length) {
                currentData = cached;
                renderMarket(currentData);
            } else {
                dom.marketList.innerHTML = '<div class="loading-state">API Rate Limited or Offline. Tap Refresh in 60s.</div>';
            }
        }
    }

    function renderMarket(items) {
        dom.marketList.innerHTML = '';
        if (!items || items.length === 0) {
            dom.marketList.innerHTML = '<div class="loading-state">No matching coins found.</div>';
            return;
        }
        const fragment = document.createDocumentFragment();
        items.forEach(item => {
            const pos = item.ch >= 0;
            const div = document.createElement('div');
            div.className = 'market-card';
            div.addEventListener('click', () => openChart(item.s, item.n));
            div.innerHTML = `
                <div>
                    <div class="coin-name" style="font-weight:700">${sanitizeHTML(item.n)}</div>
                    <div style="font-size:0.7rem;color:#777">${sanitizeHTML(item.s)}/USD</div>
                </div>
                <div style="text-align:right">
                    <div class="price">$${item.p.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                    <div class="change ${pos ? 'up' : 'down'}">${pos ? '▲' : '▼'} ${Math.abs(item.ch).toFixed(2)}%</div>
                </div>`;
            fragment.appendChild(div);
        });
        dom.marketList.appendChild(fragment);
    }

    // Multi-Tier Resilient News Engine
    async function loadNews(force = false) {
        const cachedNews = Storage.get('mkr_news_data');
        const cachedSource = Storage.get('mkr_news_source');
        const lastNewsFetch = Storage.get('mkr_news_time');

        if (!force && cachedNews && lastNewsFetch && (Date.now() - lastNewsFetch < CONFIG.CACHE_TTL)) {
            rawNews = cachedNews;
            dom.newsBadge.textContent = `Source: ${cachedSource || 'Cached Feed'}`;
            displayNews();
            return;
        }

        dom.newsContent.innerHTML = '<div class="loading-state">Fetching Verified Headlines...</div>';

        for (const endpoint of CONFIG.NEWS_ENDPOINTS) {
            try {
                const res = await fetchWithTimeout(endpoint.url);
                if (!res.ok) continue;
                const json = await res.json();
                const parsed = endpoint.parser(json);
                if (parsed && parsed.length > 0) {
                    rawNews = parsed;
                    Storage.set('mkr_news_data', rawNews);
                    Storage.set('mkr_news_source', endpoint.name);
                    Storage.set('mkr_news_time', Date.now());
                    dom.newsBadge.textContent = `Source: ${endpoint.name} (Live)`;
                    displayNews();
                    return;
                }
            } catch (err) {
                console.warn(`${endpoint.name} failed, switching to backup feed...`);
            }
        }

        // Final Fallback: Use expired cache if all endpoints are unreachable
        if (cachedNews && cachedNews.length > 0) {
            rawNews = cachedNews;
            dom.newsBadge.textContent = `Source: Offline Backup Cache`;
            displayNews();
        } else {
            dom.newsContent.innerHTML = '<div class="loading-state">Unable to reach news servers. Check your internet connection and tap Refresh.</div>';
        }
    }

    function displayNews() {
        dom.newsContent.innerHTML = '';
        let items = [...rawNews];

        if (newsFilter === 'trending') {
            items.sort((a, b) => (b.score || 0) - (a.score || 0));
        } else {
            items.sort((a, b) => (b.published || 0) - (a.published || 0));
        }

        const fragment = document.createDocumentFragment();
        items.slice(0, 26).forEach(item => {
            const card = document.createElement('div');
            card.className = 'news-card';
            card.addEventListener('click', () => {
                if (item.url && /^https?:\/\//i.test(item.url)) {
                    window.open(item.url, '_blank', 'noopener,noreferrer');
                }
            });
            card.innerHTML = `
                <span class="news-title">${sanitizeHTML(item.title)}</span>
                <div class="news-meta">
                    <span>${sanitizeHTML(item.source)}</span>
                    <span style="color:var(--mkr-purple-main);font-weight:bold;">Read Article →</span>
                </div>`;
            fragment.appendChild(card);
        });
        dom.newsContent.appendChild(fragment);
    }

    function setNewsFilter(filterType) {
        newsFilter = filterType;
        dom.btnLatest.classList.toggle('active', filterType === 'latest');
        dom.btnTrending.classList.toggle('active', filterType === 'trending');
        displayNews();
    }

    // Curated Videos Loader
    function loadVideos() {
        if (dom.videoContent.children.length > 0) return;
        const channels = [
            { name: "Coin Bureau", pId: "UUqK_GSMbzhxjiFeIWUz9A8Q" },
            { name: "Altcoin Daily", pId: "UUbLhGKVY-bJPcawebgtNfbw" },
            { name: "CryptosRUs", pId: "UU_I9_7W3YkS1p27OqW2_Npg" }
        ];
        dom.videoContent.innerHTML = '';
        const fragment = document.createDocumentFragment();
        channels.forEach(ch => {
            const label = document.createElement('span');
            label.className = 'video-label';
            label.textContent = `${ch.name} Feed`;
            fragment.appendChild(label);

            const card = document.createElement('div');
            card.className = 'video-card';
            card.innerHTML = `<div class="video-container"><iframe src="https://www.youtube-nocookie.com/embed?listType=playlist&list=${encodeURIComponent(ch.pId)}" loading="lazy" allowfullscreen="true"></iframe></div>`;
            fragment.appendChild(card);
        });
        dom.videoContent.appendChild(fragment);
    }

    // TradingView Chart Modal
    function openChart(symbol, name) {
        dom.modalTitle.textContent = `${name} Live Chart`;
        dom.modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const cleanSymbol = symbol.replace(/[^A-Z0-9]/g, '');
        const pair = ['USDT', 'USDC', 'DAI', 'FDUSD'].includes(cleanSymbol) ? 'BTCUSDT' : `${cleanSymbol}USDT`;
        dom.modalBody.innerHTML = `<iframe src="https://s.tradingview.com/widgetembed/?symbol=BINANCE:${encodeURIComponent(pair)}&theme=light" width="100%" height="100%" frameborder="0"></iframe>`;
        window.history.pushState({ modal: true }, "");
    }

    function closeModal() {
        dom.modal.style.display = 'none';
        document.body.style.overflow = '';
        dom.modalBody.innerHTML = '';
    }

    // Refresh Handler
    function handleRefresh(e) {
        if (e) e.preventDefault();
        dom.refreshBtn.classList.add('spinning');
        setTimeout(() => dom.refreshBtn.classList.remove('spinning'), 800);

        if (activeTab === 'market') loadCrypto(true);
        else if (activeTab === 'news') loadNews(true);
        else if (activeTab === 'fg') {
            dom.fgImage.src = "https://alternative.me/crypto/fear-and-greed-index.png?t=" + Date.now();
        }
    }

    // Search Filter
    function filterResults() {
        if (activeTab !== 'market') switchTab('market');
        const q = dom.searchInput.value.trim().toLowerCase();
        const filtered = currentData.filter(i => i.n.toLowerCase().includes(q) || i.s.toLowerCase().includes(q));
        renderMarket(filtered);
    }

    // Event Listeners & Initialization
    function bindEvents() {
        dom.refreshBtn.addEventListener('click', handleRefresh);
        dom.searchInput.addEventListener('keyup', filterResults);
        dom.closeBtn.addEventListener('click', closeModal);
        dom.btnLatest.addEventListener('click', () => setNewsFilter('latest'));
        dom.btnTrending.addEventListener('click', () => setNewsFilter('trending'));

        document.querySelectorAll('.nav-item').forEach(nav => {
            nav.addEventListener('click', () => switchTab(nav.dataset.tab));
        });

        window.addEventListener('popstate', (event) => {
            if (dom.modal.style.display === 'flex') {
                closeModal();
                return;
            }
            const targetTab = (event.state && event.state.tab) ? event.state.tab : 'market';
            switchTab(targetTab, true);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
        const hash = window.location.hash.replace('#', '');
        const startTab = ['market', 'news', 'video', 'fg'].includes(hash) ? hash : 'market';
        window.history.replaceState({ tab: 'market' }, "", "#market");
        if (startTab !== 'market') {
            window.history.pushState({ tab: startTab }, "", "#" + startTab);
        }
        activeTab = startTab;
        renderTab(startTab);
    });
})();
