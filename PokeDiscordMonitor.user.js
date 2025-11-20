// ==UserScript==
// @name         PokeDiscordMonitor
// @namespace    https://discord.com/
// @version      1.3
// @description  Ouvre automatiquement les liens des messages Discord contenant tous les mots-clés d'un groupe, avec logs, groupes illimités et prise en compte immédiate des changements.
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL   https://raw.githubusercontent.com/Groshaq/GroshaqScript/main/PokeDiscordMonitor.user.js
// @downloadURL https://raw.githubusercontent.com/Groshaq/GroshaqScript/main/PokeDiscordMonitor.user.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG_KEY = 'discordKeywordOpenerConfig_v1';
    const OPENED_KEY = 'discordKeywordOpenerOpened_v1';
    const LOG_KEY    = 'discordKeywordOpenerLog_v1';

    let globalConfig = null; // config utilisée partout

    // ---------- CONFIG PAR DÉFAUT ----------
    function defaultConfig() {
        return {
            channelNameFilter: 'alertes-pokemon',

            groups: [
                {
                    id: 'g1',
                    name: 'Pokémon – prioritaire',
                    enabled: true,
                    include: ['flamme blanche', 'mega evolution', 'méga évolution'],
                    exclude: ['rupture', 'indisponible']
                },
                {
                    id: 'g2',
                    name: 'Général',
                    enabled: false,
                    include: ['pokemon'],
                    exclude: []
                }
            ]
        };
    }

    function loadConfig() {
        try {
            const raw = GM_getValue(CONFIG_KEY);
            if (!raw) return defaultConfig();
            const c = JSON.parse(raw);
            if (!Array.isArray(c.groups)) c.groups = defaultConfig().groups;
            return c;
        } catch (e) {
            return defaultConfig();
        }
    }

    function saveConfig(cfg) {
        GM_setValue(CONFIG_KEY, JSON.stringify(cfg));
    }

    // ---------- TRACKING DES MESSAGES DÉJÀ TRAITÉS ----------
    let openedSet = new Set();

    function loadOpened() {
        try {
            const raw = GM_getValue(OPENED_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) openedSet = new Set(arr);
        } catch (e) {}
    }

    function saveOpened() {
        const arr = Array.from(openedSet);
        const trimmed = arr.slice(-2000);
        openedSet = new Set(trimmed);
        GM_setValue(OPENED_KEY, JSON.stringify(trimmed));
    }

    // ---------- LOGS ----------
    function loadLog() {
        try {
            const raw = GM_getValue(LOG_KEY, '[]');
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }

    function saveLog(arr) {
        if (arr.length > 300) arr = arr.slice(arr.length - 300);
        GM_setValue(LOG_KEY, JSON.stringify(arr));
    }

    function addLogEntry(entry) {
        const log = loadLog();
        log.push(entry);
        saveLog(log);
    }

    // ---------- UTILITAIRES TEXTE ----------
    function normalize(str) {
        return (str || '').toString().toLowerCase();
    }

    // Tous les mots "include" doivent être présents (ET logique)
    function textContainsAll(text, words) {
        text = normalize(text);
        const list = words.map(w => normalize(w).trim()).filter(Boolean);
        if (!list.length) return false;
        return list.every(k => text.includes(k));
    }

    // Aucun mot exclu ne doit être présent
    function textContainsNone(text, words) {
        text = normalize(text);
        return !words.some(w => text.includes(normalize(w.trim())));
    }

    // ---------- SCORE DES LIENS ----------
    function isBadDomain(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return (
                host.includes('discord.com') ||
                host.includes('discordapp.com') ||
                host.includes('cdn.discordapp.com') ||
                host.includes('images-ext-1.discordapp.net') ||
                host.includes('images-ext-2.discordapp.net') ||
                host.includes('i.neptun-monitors.com') ||
                host.includes('images.weserv.nl')
            );
        } catch(e){ return true; }
    }

    function scoreAnchor(a) {
        const href = a.href || '';
        const text = normalize(a.textContent || '');
        if (!href.startsWith('http')) return -9999;
        if (isBadDomain(href)) return -5000;

        let score = 0;

        // Texte typique "view / acheter"
        if (text.includes('view product') || text.includes('purchase link') ||
            text.includes('voir le produit') || text.includes('acheter')) {
            score += 100;
        }

        // Sites "fortement souhaités"
        if (/fnac\.com/.test(href))          score += 80;
        if (/philibertnet\.com/.test(href))  score += 80;
        if (/magicfranco\.be/.test(href))    score += 80;

        // Grosse marketplaces / JV / GSS
        if (/amazon\./.test(href))          score += 70;
        if (/cdiscount\.com/.test(href))    score += 70;
        if (/micromania\.fr/.test(href))    score += 70;

        // Jouets / GSA
        if (/king-jouet|kingjouet/.test(href)) score += 60;
        if (/auchan\.fr/.test(href))           score += 60;
        if (/lagranderecre/.test(href))        score += 60;
        if (/carrefour\.fr/.test(href))        score += 60;
        if (/e-?leclerc/.test(href))           score += 60;
        if (/joueclub\.fr/.test(href))         score += 60;
        if (/cultura\.com/.test(href))         score += 60;

        // Autres jouets / toys
        if (/maxitoys/i.test(href))      score += 50;
        if (/smyths/i.test(href))        score += 50;

        // Redirections
        if (/l\.neptun-monitors\.com/.test(href)) score += 40;

        // Embeds Discord
        if (a.classList.contains('embedTitleLink__623de'))      score += 20;
        if (a.classList.contains('embedAuthorNameLink__623de')) score += 10;

        // Lien original Discord (souvent image)
        if (a.classList.contains('originalLink_af017a')) score -= 100;

        if (text.includes('http')) score += 5;

        return score;
    }

    function findBestLinkInMessage(li) {
        const anchors = Array.from(li.querySelectorAll('a[href^="http"]'));
        if (!anchors.length) return null;

        let best = null, bestScore = -Infinity;
        for (const a of anchors) {
            const s = scoreAnchor(a);
            if (s > bestScore) {
                bestScore = s;
                best = a;
            }
        }
        return bestScore >= -1000 ? best.href : null;
    }

    // ---------- SALON ----------
    function isOnTargetChannel() {
        const cfg = globalConfig || {};
        const main = document.querySelector('main.chatContent_f75fb0[aria-label]');
        if (!main) return true;
        const label = normalize(main.getAttribute('aria-label'));
        const filter = normalize(cfg.channelNameFilter || '');
        if (!filter) return true;
        return label.includes(filter);
    }

    // ---------- MESSAGE ----------
    function handleMessage(li) {
        if (!li) return;
        const config = globalConfig;
        if (!config) return;

        const id = li.getAttribute('id') || li.dataset.listItemId;
        if (!id || openedSet.has(id)) return;

        const text = normalize(li.innerText || '');
        if (!text) return;

        for (const group of config.groups) {
            if (!group.enabled) continue;

            const includes = group.include || [];
            const excludes = group.exclude || [];

            if (!includes.length) continue;

            if (textContainsAll(text, includes) && textContainsNone(text, excludes)) {
                const url = findBestLinkInMessage(li);
                if (url) {
                    addLogEntry({
                        time: new Date().toLocaleString(),
                        url,
                        messageId: id,
                        groupName: group.name || '',
                        excerpt: (li.innerText || '').slice(0,140)
                    });

                    window.open(url, '_blank');

                    openedSet.add(id);
                    saveOpened();
                }
                break;
            }
        }
    }

    // 🔁 Rescan de tous les messages visibles (appelé après Sauvegarder)
    function rescanExistingMessages() {
        const list = document.querySelector('[data-list-id="chat-messages"]');
        if (!list) return;
        list.querySelectorAll('li').forEach(li => handleMessage(li));
    }

    // ---------- OBSERVER ----------
    function initObserver() {
        const list = document.querySelector('[data-list-id="chat-messages"]');
        if (!list) return;

        // Premier passage
        list.querySelectorAll('li').forEach(li => handleMessage(li));

        new MutationObserver(mutations => {
            for (const mut of mutations) {
                for (const n of mut.addedNodes) {
                    if (!(n instanceof HTMLElement)) continue;

                    if (n.tagName === 'LI') {
                        handleMessage(n);
                    } else if (n.querySelectorAll) {
                        n.querySelectorAll('li').forEach(li => handleMessage(li));
                    }
                }
            }
        }).observe(list, { childList: true, subtree: true });
    }

    // ---------- Position du panneau (près de la Boîte de réception) ----------
    function positionPanel(panel) {
        try {
            const inbox =
                document.querySelector('[aria-label="Boîte de réception"]') ||
                document.querySelector('[aria-label="Inbox"]');

            if (inbox) {
                const r = inbox.getBoundingClientRect();
                // On place le panneau sous la boîte de réception, légèrement décalé à gauche
                panel.style.top  = (r.bottom + 8) + 'px';
                panel.style.left = (r.left) + 'px';
                panel.style.right = 'auto';
            } else {
                // Position de secours si on ne trouve pas l'inbox
                panel.style.top  = '80px';
                panel.style.right = '10px';
                panel.style.left  = 'auto';
            }
        } catch (e) {
            panel.style.top  = '80px';
            panel.style.right = '10px';
            panel.style.left  = 'auto';
        }
    }

    // ---------- UI ----------
    function createConfigPanel(config) {
        const panel = document.createElement('div');
        panel.id = 'pdm-panel';
        panel.style.position = 'fixed';
        panel.style.zIndex = '999999';
        panel.style.background = 'rgba(30,31,34,0.95)';
        panel.style.color = '#fff';
        panel.style.padding = '10px';
        panel.style.borderRadius = '8px';
        panel.style.fontSize = '12px';
        panel.style.maxWidth = '320px';
        panel.style.maxHeight = '70vh';
        panel.style.overflow = 'auto';
        panel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <strong style="font-size:13px;">🔍 PokeDiscordMonitor</strong>
                <button id="pdm-minimize" style="background:#202225;border:1px solid #555;color:#fff;border-radius:4px;cursor:pointer;width:22px;height:22px;line-height:20px;padding:0;font-size:14px;">−</button>
            </div>

            <div id="pdm-body">
                <div style="display:flex;gap:4px;margin-bottom:6px;">
                    <button class="tab-btn active" data-tab="config"
                        style="flex:1;background:#5865F2;border:none;color:white;padding:4px;border-radius:4px;">
                        Config
                    </button>
                    <button class="tab-btn" data-tab="logs"
                        style="flex:1;background:#2f3136;border:none;color:#ccc;padding:4px;border-radius:4px;">
                        Logs
                    </button>
                </div>

                <div id="section-config">
                    <div style="margin-top:2px;">Salon cible :</div>
                    <input type="text" id="channel-filter" style="width:100%;margin-bottom:6px;border-radius:4px;background:#202225;border:1px solid #555;color:white;padding:3px;">

                    <div id="groups"></div>

                    <button id="add-group" style="width:100%;background:#3ba55d;border:none;color:white;padding:4px;margin-top:6px;border-radius:4px;">
                        + Ajouter un groupe
                    </button>

                    <button id="save" style="width:100%;background:#5865F2;border:none;color:white;padding:4px;margin-top:6px;border-radius:4px;">
                        💾 Sauvegarder (live)
                    </button>
                </div>

                <div id="section-logs" style="display:none;margin-top:6px;">
                    <div style="display:flex;gap:4px;">
                        <button id="refresh-logs" style="flex:1;background:#4f545c;border:none;color:white;padding:4px;border-radius:4px;">🔄 Rafraîchir</button>
                        <button id="clear-logs"   style="flex:1;background:#d83c3e;border:none;color:white;padding:4px;border-radius:4px;">🗑 Vider</button>
                    </div>
                    <div id="logs" style="margin-top:6px;font-size:11px;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Positionner près de la Boîte de réception
        positionPanel(panel);
        window.addEventListener('resize', () => positionPanel(panel));

        const tabBtns       = panel.querySelectorAll('.tab-btn');
        const sectionConfig = panel.querySelector('#section-config');
        const sectionLogs   = panel.querySelector('#section-logs');
        const logsDiv       = panel.querySelector('#logs');
        const channelInput  = panel.querySelector('#channel-filter');
        const bodyDiv       = panel.querySelector('#pdm-body');
        const minimizeBtn   = panel.querySelector('#pdm-minimize');

        channelInput.value = config.channelNameFilter || '';

        // Minimise / agrandit la boîte
        let isMinimized = false;
        minimizeBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                bodyDiv.style.display = 'none';
                minimizeBtn.textContent = '+';
            } else {
                bodyDiv.style.display = '';
                minimizeBtn.textContent = '−';
            }
        });

        function renderGroups() {
            const container = panel.querySelector('#groups');
            container.innerHTML = '';
            config.groups.forEach((g, i) => {
                const div = document.createElement('div');
                div.style = "border:1px solid #444;border-radius:6px;padding:6px;margin-top:6px;";
                div.innerHTML = `
                    <div style="display:flex;align-items:center;margin-bottom:4px;">
                        <input type="checkbox" data-i="${i}" class="g-enabled" ${g.enabled ? 'checked':''}>
                        <input type="text" data-i="${i}" class="g-name"
                            style="flex:1;margin-left:4px;background:#202225;color:white;border:1px solid #555;border-radius:4px;padding:2px 4px;"
                            value="${g.name}">
                    </div>

                    <div>Inclure (tous requis) :</div>
                    <textarea data-i="${i}" class="g-include"
                        style="width:100%;background:#202225;color:white;border:1px solid #555;border-radius:4px;padding:3px;margin-top:2px;"
                        rows="2">${(g.include||[]).join(', ')}</textarea>

                    <div style="margin-top:4px;">Exclure :</div>
                    <textarea data-i="${i}" class="g-exclude"
                        style="width:100%;background:#202225;color:white;border:1px solid #555;border-radius:4px;padding:3px;margin-top:2px;"
                        rows="2">${(g.exclude||[]).join(', ')}</textarea>
                `;
                container.appendChild(div);
            });
        }

        function renderLogs() {
            const log = loadLog().slice().reverse();
            logsDiv.innerHTML = log.length
                ? log.map(e => `
                    <div style="border-bottom:1px solid #444;padding:4px 0;">
                        <div><strong>${e.time}</strong> — ${e.groupName}</div>
                        <div><a href="${e.url}" target="_blank" style="color:#00aff4;">${e.url}</a></div>
                        <div style="font-size:10px;color:#888;">Msg: ${e.messageId}</div>
                        <div style="font-size:10px;color:#ccc;">"${e.excerpt}"</div>
                    </div>
                `).join('')
                : '<em>Aucun log.</em>';
        }

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.background='#2f3136';
                    b.style.color='#ccc';
                });
                btn.classList.add('active');
                btn.style.background='#5865F2';
                btn.style.color='white';

                if (btn.dataset.tab === 'logs') {
                    sectionConfig.style.display='none';
                    sectionLogs.style.display='';
                    renderLogs();
                } else {
                    sectionConfig.style.display='';
                    sectionLogs.style.display='none';
                }
            });
        });

        panel.querySelector('#refresh-logs').addEventListener('click', renderLogs);
        panel.querySelector('#clear-logs').addEventListener('click', () => {
            if (confirm("Vider les logs ?")) {
                saveLog([]);
                renderLogs();
            }
        });

        panel.querySelector('#add-group').addEventListener('click', () => {
            config.groups.push({
                id: 'g'+Date.now(),
                name: 'Nouveau groupe',
                enabled: true,
                include: [],
                exclude: []
            });
            renderGroups();
        });

        panel.querySelector('#save').addEventListener('click', () => {
            // Récupère la config depuis l’UI
            config.channelNameFilter = channelInput.value.trim();

            const newList = [];
            panel.querySelectorAll('.g-name').forEach(el => {
                const i       = el.dataset.i;
                const enabled = panel.querySelector(`.g-enabled[data-i="${i}"]`).checked;
                const include = panel.querySelector(`.g-include[data-i="${i}"]`).value.split(',').map(s=>s.trim()).filter(Boolean);
                const exclude = panel.querySelector(`.g-exclude[data-i="${i}"]`).value.split(',').map(s=>s.trim()).filter(Boolean);

                newList.push({
                    id: config.groups[i].id,
                    name: el.value.trim() || `Groupe ${Number(i)+1}`,
                    enabled,
                    include,
                    exclude
                });
            });

            config.groups = newList;

            // Sauvegarde + applique en live
            globalConfig = config;
            saveConfig(config);

            // 🔁 Re-scan immédiat des messages déjà visibles
            rescanExistingMessages();
        });

        renderGroups();
    }

    // ---------- MAIN ----------
    function main() {
        const cfg = loadConfig();
        globalConfig = cfg;
        loadOpened();
        createConfigPanel(cfg);

        const interval = setInterval(() => {
            if (!isOnTargetChannel()) return;
            const list = document.querySelector('[data-list-id="chat-messages"]');
            if (list) {
                clearInterval(interval);
                initObserver();
            }
        }, 800);
    }

    main();
})();
