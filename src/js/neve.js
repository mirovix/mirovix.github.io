'use strict';

(function () {
    const ACCESS_CODE = 'Bentley99';
    const SETTINGS_KEY = 'neve.settings.v1';
    const SESSION_KEY = 'neve.unlocked';

    const defaultSettings = {
        studioLinks: [
            'https://www.fosterandpartners.com/careers/',
            'https://www.zaha-hadid.com/careers/',
            'https://big.dk/jobs/',
            'https://www.oma.com/jobs',
            'https://www.mvrdv.com/careers',
            'https://www.snohetta.com/careers',
            'https://www.herzogdemeuron.com/index/careers.html',
            'https://www.unstudio.com/en/page/13948/careers'
        ].join('\n'),
        keywords: 'architectural visualizer, architectural visualiser, 3d visualizer, 3d visualiser, visualization artist, visualisation artist, archviz, rendering artist, cgi artist, unreal, enscape, v-ray, corona, architect',
        negativeKeywords: 'finance, accountant, marketing, business development, hr, human resources, office manager, project manager construction',
        crawlDepth: 1,
        maxPages: 28,
        locations: 'London, New York, Copenhagen, Rotterdam, Basel, Oslo, Milano, remote',
        minScore: 5,
        includeClassic: true,
        onlyTopStudio: true,
        useReaderProxy: true,
        topStudios: [
            'Foster + Partners',
            'Zaha Hadid Architects',
            'BIG',
            'Bjarke Ingels Group',
            'OMA',
            'MVRDV',
            'Snøhetta',
            'Snohetta',
            'Herzog & de Meuron',
            'UNStudio',
            'Gensler',
            'SOM',
            'KPF',
            'Heatherwick Studio',
            'David Chipperfield Architects',
            'MAD Architects',
            'Diller Scofidio + Renfro',
            'Perkins&Will',
            'HOK'
        ].join('\n')
    };

    const classicQueries = [
        'architectural visualizer visualiser jobs top architecture studio Dezeen',
        'site:dezeenjobs.com visualiser architecture jobs',
        'site:archinect.com/jobs architectural visualization OR visualizer',
        'site:linkedin.com/jobs architectural visualization top architecture studio',
        'site:indeed.com architectural visualization visualizer architect',
        'site:ziprecruiter.com architectural visualization artist jobs'
    ];

    const state = {
        settings: Object.assign({}, defaultSettings),
        results: [],
        visited: new Set(),
        abort: false
    };

    const $ = selector => document.querySelector(selector);
    const els = {};

    window.addEventListener('DOMContentLoaded', init);

    function init() {
        bindElements();
        loadSettings();
        fillForm();
        bindEvents();
        if (sessionStorage.getItem(SESSION_KEY) === 'true') {
            unlock();
        }
    }

    function bindElements() {
        [
            'neveLock', 'neveApp', 'neveLockForm', 'nevePassword', 'neveLockError',
            'studioLinks', 'keywords', 'negativeKeywords', 'crawlDepth', 'maxPages',
            'locations', 'minScore', 'includeClassic', 'onlyTopStudio', 'useReaderProxy',
            'topStudios', 'saveSettings', 'resetSettings', 'runSearch', 'exportResults',
            'sourcesCount', 'matchesCount', 'lastRunStatus', 'searchState', 'progressText',
            'sourceLog', 'results', 'resultTemplate', 'resultFilter'
        ].forEach(id => { els[id] = document.getElementById(id); });
    }

    function bindEvents() {
        els.neveLockForm.addEventListener('submit', event => {
            event.preventDefault();
            if (els.nevePassword.value === ACCESS_CODE) {
                sessionStorage.setItem(SESSION_KEY, 'true');
                unlock();
            } else {
                els.neveLockError.textContent = 'Codice non valido.';
            }
        });

        const togglePassword = document.querySelector('[data-toggle-password]');
        togglePassword.addEventListener('click', () => {
            const hidden = els.nevePassword.type === 'password';
            els.nevePassword.type = hidden ? 'text' : 'password';
            togglePassword.innerHTML = hidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
        });

        els.saveSettings.addEventListener('click', () => {
            readForm();
            saveSettings();
            flashStatus('Salvato');
        });

        els.resetSettings.addEventListener('click', () => {
            state.settings = Object.assign({}, defaultSettings);
            saveSettings();
            fillForm();
            flashStatus('Reset');
        });

        els.runSearch.addEventListener('click', runSearch);
        els.exportResults.addEventListener('click', exportResults);
        els.resultFilter.addEventListener('input', renderResults);
        Array.from(document.querySelectorAll('input, textarea')).forEach(input => {
            if (input.id !== 'nevePassword' && input.id !== 'resultFilter') {
                input.addEventListener('change', () => {
                    readForm();
                    saveSettings();
                });
            }
        });
    }

    function unlock() {
        els.neveLock.hidden = true;
        els.neveApp.hidden = false;
        updateCounts();
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            if (saved && typeof saved === 'object') {
                state.settings = Object.assign({}, defaultSettings, saved);
            }
        } catch (error) {
            console.warn('Cannot load Neve settings', error);
        }
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    }

    function fillForm() {
        Object.keys(defaultSettings).forEach(key => {
            if (!els[key]) return;
            if (typeof defaultSettings[key] === 'boolean') {
                els[key].checked = Boolean(state.settings[key]);
            } else {
                els[key].value = state.settings[key];
            }
        });
        updateCounts();
    }

    function readForm() {
        state.settings = {
            studioLinks: els.studioLinks.value.trim(),
            keywords: els.keywords.value.trim(),
            negativeKeywords: els.negativeKeywords.value.trim(),
            crawlDepth: clamp(parseInt(els.crawlDepth.value, 10), 0, 2),
            maxPages: clamp(parseInt(els.maxPages.value, 10), 5, 80),
            locations: els.locations.value.trim(),
            minScore: clamp(parseInt(els.minScore.value, 10), 1, 30),
            includeClassic: els.includeClassic.checked,
            onlyTopStudio: els.onlyTopStudio.checked,
            useReaderProxy: els.useReaderProxy.checked,
            topStudios: els.topStudios.value.trim()
        };
    }

    async function runSearch() {
        readForm();
        saveSettings();
        state.abort = false;
        state.results = [];
        state.visited = new Set();
        renderResults();
        setRunning(true);

        const sources = buildSources();
        els.sourcesCount.textContent = String(sources.length);
        logSource('Avvio ricerca su ' + sources.length + ' fonti...');

        try {
            for (const source of sources) {
                await crawlSource(source);
                updateCounts();
            }
            els.searchState.textContent = 'Completata';
            els.progressText.textContent = 'Ricerca completata. Trovati ' + state.results.length + ' risultati candidati.';
        } catch (error) {
            console.error(error);
            els.searchState.textContent = 'Errore';
            els.progressText.textContent = 'Ricerca interrotta: ' + error.message;
        } finally {
            els.lastRunStatus.textContent = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
            setRunning(false);
            renderResults();
        }
    }

    function buildSources() {
        const custom = splitLines(state.settings.studioLinks)
            .map(normalizeUrl)
            .filter(Boolean)
            .map(url => ({ url, type: 'Studio target', depth: state.settings.crawlDepth }));

        if (!state.settings.includeClassic) return custom;

        const classic = classicQueries.map(query => ({
            url: 'https://s.jina.ai/' + encodeURIComponent(query),
            type: 'Job board classico',
            depth: 0
        }));

        classic.push(
            { url: 'https://www.dezeenjobs.com/job-category/visualiser/', type: 'Dezeen Visualiser', depth: 0 },
            { url: 'https://archinect.com/jobs', type: 'Archinect Jobs', depth: 0 },
            { url: 'https://ajv.archinect.com/', type: 'Archinect Visualizer', depth: 0 },
            { url: 'https://www.linkedin.com/jobs/architectural-visualization-jobs', type: 'LinkedIn Jobs', depth: 0 },
            { url: 'https://www.indeed.com/q-architectural-visualization-jobs.html', type: 'Indeed Jobs', depth: 0 },
            { url: 'https://www.ziprecruiter.com/Jobs/Architectural-Visualization', type: 'ZipRecruiter', depth: 0 }
        );

        return dedupeSources(custom.concat(classic));
    }

    async function crawlSource(source) {
        const queue = [{ url: source.url, depth: 0, type: source.type }];
        const maxPages = state.settings.maxPages;

        while (queue.length && state.visited.size < maxPages) {
            const item = queue.shift();
            if (!item.url || state.visited.has(item.url)) continue;
            state.visited.add(item.url);
            els.progressText.textContent = 'Leggo ' + item.url;
            logSource('Scansione: ' + item.url);

            const fetched = await fetchText(item.url);
            if (!fetched.text) {
                logSource('Saltato: non leggibile dal browser/proxy.');
                continue;
            }

            collectMatches(item.url, fetched.text, item.type, fetched.via);

            if (item.depth < source.depth) {
                const links = extractLikelyLinks(fetched.text, item.url);
                links.slice(0, 20).forEach(url => {
                    if (!state.visited.has(url)) queue.push({ url, depth: item.depth + 1, type: item.type });
                });
            }

            await wait(120);
        }
    }

    async function fetchText(url) {
        const attempts = [{ label: 'direct', url }];
        if (state.settings.useReaderProxy) {
            attempts.push(
                { label: 'jina', url: 'https://r.jina.ai/' + url },
                { label: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url) }
            );
        }

        for (const attempt of attempts) {
            try {
                const response = await fetch(attempt.url, { cache: 'no-store' });
                if (!response.ok) continue;
                const text = await response.text();
                if (text && text.trim().length > 80) {
                    return { text, via: attempt.label };
                }
            } catch (error) {
                console.debug('Fetch failed', attempt.label, url, error);
            }
        }
        return { text: '', via: 'none' };
    }

    function collectMatches(url, text, type, via) {
        const cleanText = stripText(text);
        const keywords = splitTokens(state.settings.keywords);
        const negatives = splitTokens(state.settings.negativeKeywords);
        const topStudios = splitLines(state.settings.topStudios);
        const locations = splitTokens(state.settings.locations);
        const lower = cleanText.toLowerCase();

        if (!keywords.some(term => lower.includes(term.toLowerCase()))) return;

        const chunks = makeChunks(cleanText, keywords);
        chunks.forEach(chunk => {
            const score = scoreChunk(chunk, keywords, negatives, topStudios, locations, url);
            if (score < state.settings.minScore) return;
            if (!looksLikeOpenRole(chunk, url)) return;
            if (state.settings.onlyTopStudio && !isTopStudio(chunk, topStudios, url) && score < state.settings.minScore + 4) return;

            const resultUrl = inferBestUrl(chunk, url);
            const title = inferTitle(chunk, url, resultUrl);
            if (/search results:|job category:|job categories|browse jobs/i.test(title)) return;
            const id = (title + resultUrl).toLowerCase();
            if (state.results.some(result => result.id === id)) return;

            state.results.push({
                id,
                title,
                url: resultUrl,
                sourceUrl: url,
                company: inferCompany(chunk, url, topStudios),
                sourceType: type + ' / ' + via,
                score,
                snippet: chunk.slice(0, 520),
                tags: matchedTerms(chunk, keywords.concat(locations, topStudios)).slice(0, 8)
            });
        });

        state.results.sort((a, b) => b.score - a.score);
        renderResults();
    }

    function scoreChunk(chunk, keywords, negatives, topStudios, locations, url) {
        const lower = chunk.toLowerCase();
        let score = 0;
        keywords.forEach(term => { if (lower.includes(term.toLowerCase())) score += term.length > 9 ? 3 : 2; });
        locations.forEach(term => { if (lower.includes(term.toLowerCase())) score += 1; });
        topStudios.forEach(studio => {
            if (lower.includes(studio.toLowerCase()) || url.toLowerCase().includes(slug(studio))) score += 4;
        });
        ['apply', 'career', 'careers', 'job', 'jobs', 'position', 'vacancy', 'join us', 'full-time', 'part-time', 'hybrid', 'remote'].forEach(term => {
            if (lower.includes(term)) score += 1;
        });
        ['hiring', 'seeking', 'is looking for', 'salary', 'posted', 'deadline'].forEach(term => {
            if (lower.includes(term)) score += 2;
        });
        ['no current vacancies', 'no open positions', 'currently no vacancies', 'unsolicited application', 'search all jobs by company', 'click here to post a job', 'subscribe to our newsletters', 'companies:', 'job alert'].forEach(term => {
            if (lower.includes(term)) score -= 5;
        });
        negatives.forEach(term => { if (lower.includes(term.toLowerCase())) score -= 3; });
        return score;
    }

    function makeChunks(text, keywords) {
        const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
        const chunks = [];
        lines.forEach((line, index) => {
            const lower = line.toLowerCase();
            if (!keywords.some(term => lower.includes(term.toLowerCase()))) return;
            const start = Math.max(0, index - 3);
            const end = Math.min(lines.length, index + 5);
            chunks.push(lines.slice(start, end).join(' '));
        });
        if (!chunks.length && text.length < 5000) chunks.push(text);
        return chunks;
    }

    function extractLikelyLinks(text, baseUrl) {
        const urls = new Set();
        const base = new URL(baseUrl);
        const patterns = [
            /href=["']([^"']+)["']/gi,
            /\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi,
            /(https?:\/\/[^\s<>"')]+)/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const normalized = normalizeUrl(match[1], baseUrl);
                if (!normalized) continue;
                try {
                    const next = new URL(normalized);
                    const searchable = /career|job|join|work|vacanc|position|people|studio|about|visual/i.test(next.pathname + next.search);
                    if (next.hostname === base.hostname && searchable) urls.add(next.href);
                } catch (error) {
                    console.debug(error);
                }
            }
        });

        return Array.from(urls);
    }

    function renderResults() {
        const filter = (els.resultFilter.value || '').toLowerCase();
        els.results.innerHTML = '';
        const visible = state.results.filter(result => {
            const haystack = [result.title, result.company, result.snippet, result.tags.join(' ')].join(' ').toLowerCase();
            return haystack.includes(filter);
        });

        if (!visible.length) {
            els.results.innerHTML = '<div class="neve-empty"><i class="fa-solid fa-compass"></i><p>Nessun risultato visibile.</p></div>';
            updateCounts();
            return;
        }

        visible.forEach(result => {
            const node = els.resultTemplate.content.cloneNode(true);
            node.querySelector('[data-role="score"]').textContent = 'Score ' + result.score;
            node.querySelector('[data-role="company"]').textContent = result.company;
            node.querySelector('[data-role="sourceType"]').textContent = result.sourceType;
            node.querySelector('[data-role="title"]').textContent = result.title;
            node.querySelector('[data-role="snippet"]').textContent = result.snippet;
            const tags = node.querySelector('[data-role="tags"]');
            result.tags.forEach(tag => {
                const pill = document.createElement('span');
                pill.textContent = tag;
                tags.appendChild(pill);
            });
            const link = node.querySelector('[data-role="url"]');
            link.href = result.url;
            els.results.appendChild(node);
        });
        updateCounts();
    }

    function exportResults() {
        const payload = {
            exportedAt: new Date().toISOString(),
            settings: state.settings,
            results: state.results
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'neve-visualizer-results.json';
        link.click();
        URL.revokeObjectURL(url);
    }

    function inferTitle(chunk, url, resultUrl) {
        const lines = chunk.split(/[.!?]\s|\n/).map(line => line.trim()).filter(Boolean);
        const jobLine = lines.find(line => /hiring|seeking|looking for|visual|render|archviz|3d|architect/i.test(line) && !/subscribe|companies:|search all jobs|job category:|search results:/i.test(line)) || lines[0] || url;
        const title = jobLine.replace(/\s+/g, ' ').slice(0, 120);
        if (/^\[?(more|read more|view job)\]?/i.test(title)) {
            return titleFromUrl(resultUrl) || title;
        }
        return title;
    }

    function inferCompany(chunk, url, studios) {
        const lower = chunk.toLowerCase();
        const studio = studios.find(item => lower.includes(item.toLowerCase()) || url.toLowerCase().includes(slug(item)));
        if (studio) return studio;
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return 'Fonte esterna';
        }
    }

    function inferBestUrl(chunk, fallback) {
        const markdown = chunk.match(/\((https?:\/\/[^)]+)\)/);
        const plain = chunk.match(/https?:\/\/[^\s<>"')]+/);
        return (markdown && markdown[1]) || (plain && plain[0]) || fallback;
    }

    function matchedTerms(text, terms) {
        const lower = text.toLowerCase();
        return terms.filter(Boolean).filter(term => lower.includes(term.toLowerCase()));
    }

    function isTopStudio(text, studios, url) {
        const lower = (text + ' ' + url).toLowerCase();
        return studios.some(studio => lower.includes(studio.toLowerCase()) || lower.includes(slug(studio)));
    }

    function looksLikeOpenRole(text, url) {
        const lower = (text + ' ' + url).toLowerCase();
        const roleSignal = /apply|hiring|seeking|looking for|vacanc|position|role|job|career|salary|full-time|part-time|hybrid|remote|posted/.test(lower);
        const boilerplate = /search all jobs by company|subscribe to our newsletters|click here to post a job|job alert|companies:/.test(lower);
        const linkCount = (text.match(/https?:\/\/|\]\(/g) || []).length;
        const companyListLinks = (text.match(/\* \[[^\]]+\]\(/g) || []).length;
        const strongHiringSignal = /is hiring|is seeking|is looking|apply now|posted|deadline|full-time|part-time/.test(lower);
        if (!strongHiringSignal && /search results:|job category:|job categories|browse jobs/.test(lower)) return false;
        return roleSignal && !boilerplate && (linkCount < 3 || strongHiringSignal) && (companyListLinks < 2 || strongHiringSignal);
    }

    function stripText(text) {
        return text
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function splitLines(value) {
        return String(value || '').split(/\n+/).map(item => item.trim()).filter(Boolean);
    }

    function splitTokens(value) {
        return String(value || '').split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
    }

    function normalizeUrl(value, baseUrl) {
        const raw = String(value || '').trim();
        if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return '';
        try {
            if (/^https?:\/\//i.test(raw)) return new URL(raw).href;
            if (baseUrl) return new URL(raw, baseUrl).href;
            return new URL('https://' + raw).href;
        } catch (error) {
            return '';
        }
    }

    function dedupeSources(sources) {
        const seen = new Set();
        return sources.filter(source => {
            if (seen.has(source.url)) return false;
            seen.add(source.url);
            return true;
        });
    }

    function slug(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function titleFromUrl(url) {
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            const last = parts[parts.length - 1] || '';
            return last
                .replace(/-\d+$/, '')
                .split('-')
                .filter(Boolean)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        } catch (error) {
            return '';
        }
    }

    function clamp(value, min, max) {
        if (Number.isNaN(value)) return min;
        return Math.min(max, Math.max(min, value));
    }

    function logSource(message) {
        const line = document.createElement('div');
        line.textContent = new Date().toLocaleTimeString('it-IT') + ' - ' + message;
        els.sourceLog.prepend(line);
        while (els.sourceLog.children.length > 18) els.sourceLog.lastChild.remove();
    }

    function setRunning(isRunning) {
        els.runSearch.disabled = isRunning;
        els.searchState.textContent = isRunning ? 'Ricerca...' : els.searchState.textContent;
        els.runSearch.querySelector('span').textContent = isRunning ? 'Cerco...' : 'Cerca ora';
    }

    function updateCounts() {
        els.sourcesCount.textContent = String(buildSources().length);
        els.matchesCount.textContent = String(state.results.length);
    }

    function flashStatus(message) {
        const previous = els.searchState.textContent;
        els.searchState.textContent = message;
        window.setTimeout(() => { els.searchState.textContent = previous || 'Pronto'; }, 1200);
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }
})();
