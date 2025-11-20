// ==UserScript==
// @name         Micromania SKU Injector
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  Force l'ajout d'un produit Micromania via son PID
// @match        https://www.micromania.fr/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function inject(fn) {
        const s = document.createElement('script');
        s.textContent = '(' + fn.toString() + ')();';
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    }

    inject(() => {
        // --- State global (en page context) ---

        const state = {
            url: null,
            body: null,
            headers: null,
            currentPid: null,

            // Template persistant sauvegardé en localStorage
            storedUrl: null,
            storedBody: null,
            storedHeaders: null
        };

        // --- Helpers template / info ---

        function hasTemplate() {
            return !!(
                (state.url && state.body) ||
                (state.storedUrl && state.storedBody)
            );
        }

        function updateTemplateInfoVisibility() {
            const info = document.getElementById('micromania-sku-template-info');
            if (!info) return;
            // Affiche le texte seulement si AUCUN template n'est dispo
            info.style.display = hasTemplate() ? 'none' : 'block';
        }

        // --- Chargement du template persistant depuis localStorage ---
        (function loadStoredTemplate() {
            try {
                const raw = localStorage.getItem('micromaniaSkuInjectorTemplate');
                if (!raw) return;

                const parsed = JSON.parse(raw);
                if (parsed && parsed.url && parsed.body) {
                    state.storedUrl = parsed.url;
                    state.storedBody = parsed.body;
                    state.storedHeaders = parsed.headers || {};

                    console.log('[Micromania SKU Injector] Template chargé depuis localStorage', parsed);
                }
            } catch (e) {
                console.warn('[Micromania SKU Injector] Impossible de charger le template localStorage', e);
            }

            // Si le panel existe déjà, on met à jour l'info (sinon ça ne fera rien)
            updateTemplateInfoVisibility();
        })();

        // --- Hook XHR (Cart-AddProduct) ---

        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
            this._mm_method = method;
            this._mm_url = url;
            this._mm_headers = {};
            return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (this._mm_headers) {
                this._mm_headers[name] = value;
            }
            return origSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function (body) {
            try {
                if (
                    this._mm_method === 'POST' &&
                    typeof this._mm_url === 'string' &&
                    this._mm_url.includes('/Cart-AddProduct')
                ) {
                    state.url = this._mm_url;
                    state.body = typeof body === 'string' ? body : (body || '').toString();
                    state.headers = { ...(this._mm_headers || {}) };

                    console.log('[Micromania SKU Injector] Cart-AddProduct XHR capturée', {
                        url: state.url,
                        body: state.body,
                        headers: state.headers
                    });

                    // Met à jour aussi le template persistant
                    state.storedUrl = state.url;
                    state.storedBody = state.body;
                    state.storedHeaders = state.headers;

                    try {
                        localStorage.setItem(
                            'micromaniaSkuInjectorTemplate',
                            JSON.stringify({
                                url: state.storedUrl,
                                body: state.storedBody,
                                headers: state.storedHeaders
                            })
                        );
                        console.log('[Micromania SKU Injector] Template sauvegardé dans localStorage');
                    } catch (e) {
                        console.warn('[Micromania SKU Injector] Impossible de sauvegarder le template', e);
                    }

                    // Maintenant qu'on a un template, on peut cacher le message d'info
                    updateTemplateInfoVisibility();
                }
            } catch (e) {
                console.warn('[Micromania SKU Injector] Erreur dans le hook XHR', e);
            }

            return origSend.apply(this, arguments);
        };

        // --- Helpers PID actuel ---

        function computeCurrentPid() {
            // 1) data-pid sur la page (PDP, boutons, etc.)
            let pid = null;

            // a) meta productId si présent
            const metaProductId = document.querySelector('meta[itemprop="productID"], meta[itemprop="sku"]');
            if (metaProductId && metaProductId.content) {
                pid = metaProductId.content.trim();
            }

            // b) data-pid sur un bouton "Ajouter au panier" ou autre
            if (!pid) {
                const btn = document.querySelector('[data-pid]');
                if (btn && btn.getAttribute('data-pid')) {
                    pid = btn.getAttribute('data-pid').trim();
                }
            }

            // c) fallback depuis l'URL si pattern /xxxxxx.html?pid=YYYYYY
            if (!pid) {
                try {
                    const u = new URL(window.location.href);
                    if (u.searchParams.has('pid')) {
                        pid = u.searchParams.get('pid');
                    }
                } catch (e) {
                    // ignore
                }
            }

            // d) fallback regex dans l'URL si autre format
            if (!pid) {
                const m = window.location.href.match(/[?&]pid=([^&]+)/i);
                if (m) {
                    pid = decodeURIComponent(m[1]);
                }
            }

            if (pid) {
                state.currentPid = pid;
            }
            return pid;
        }

        // --- UI injection ---

        function createPanel() {
            if (document.getElementById('micromania-sku-injector-panel')) return;

            const panel = document.createElement('div');
            panel.id = 'micromania-sku-injector-panel';
            panel.style.position = 'fixed';
            panel.style.bottom = '10px';
            panel.style.right = '10px';
            panel.style.zIndex = '99999';
            panel.style.background = 'rgba(0,0,0,0.8)';
            panel.style.color = 'white';
            panel.style.padding = '8px 10px';
            panel.style.fontSize = '12px';
            panel.style.fontFamily = 'Arial, sans-serif';
            panel.style.borderRadius = '4px';
            panel.style.display = 'flex';
            panel.style.flexDirection = 'column';
            panel.style.gap = '4px';
            panel.style.maxWidth = '260px';

            // (On garde le titre, mais même quand le template est ok
            // visuellement tu n'auras plus que le titre + les 2 boutons)
            const title = document.createElement('div');
            title.textContent = 'Micromania SKU Injector';
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '4px';
            panel.appendChild(title);

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '4px';

            // Bouton principal "SKU Injector"
            const btnInjector = document.createElement('button');
            btnInjector.textContent = 'SKU Injector';
            btnInjector.style.flex = '1';
            btnInjector.style.cursor = 'pointer';
            btnInjector.style.fontSize = '12px';
            btnInjector.style.padding = '4px 6px';
            btnInjector.style.borderRadius = '3px';
            btnInjector.style.border = '1px solid #00bcd4';
            btnInjector.style.background = '#00bcd4';
            btnInjector.style.color = '#000';

            btnInjector.addEventListener('click', async () => {
                // On choisit d'abord la requête en mémoire, sinon le template persistant
                const baseUrl = state.url || state.storedUrl;
                const baseBody = state.body || state.storedBody;
                const baseHeaders = state.headers || state.storedHeaders;

                if (!baseUrl || !baseBody) {
                    alert(
                        "SKU Injector Micromania : je n'ai pas encore de modèle Cart-AddProduct.\n\n" +
                        'Fais au moins UNE FOIS un ajout au panier normal (clic sur "Ajouter au panier"),\n' +
                        'pour initialiser le template, puis réessaie.'
                    );
                    return;
                }

                const pid = prompt('PID / SKU Micromania à injecter ?\n(ex : 154108)');
                if (!pid) return;
                const cleanPid = pid.trim();
                if (!cleanPid) return;

                // --- URL : remplace le paramètre pid= ---
                let newUrl = baseUrl;
                try {
                    const u = new URL(baseUrl, window.location.origin);
                    if (u.searchParams.has('pid')) {
                        u.searchParams.set('pid', cleanPid);
                        newUrl = u.toString();
                    } else if (/pid=[^&]+/.test(baseUrl)) {
                        newUrl = baseUrl.replace(/(pid=)[^&]+/, '$1' + encodeURIComponent(cleanPid));
                    }
                } catch (e) {
                    console.warn('[Micromania SKU Injector] Impossible de parser URL, je garde telle quelle', e);
                }

                // --- Body form-urlencoded : remplace pid= ---
                let newBody = baseBody;
                try {
                    const params = new URLSearchParams(baseBody);
                    if (params.has('pid')) {
                        params.set('pid', cleanPid);
                        newBody = params.toString();
                    } else {
                        console.warn('[Micromania SKU Injector] Aucun paramètre pid dans le body', baseBody);
                    }
                } catch (e) {
                    console.warn('[Micromania SKU Injector] Impossible de parser le body', e, baseBody);
                }

                // --- Headers : met à jour ProductID si présent + content-type minimum ---
                const headers = { ...(baseHeaders || {}) };
                if (headers['ProductID']) {
                    headers['ProductID'] = cleanPid;
                }
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
                }
                if (!headers['X-Requested-With'] && !headers['x-requested-with']) {
                    headers['X-Requested-With'] = 'XMLHttpRequest';
                }
                if (!headers['Accept'] && !headers['accept']) {
                    headers['Accept'] = '*/*';
                }

                try {
                    btnInjector.disabled = true;
                    btnInjector.textContent = 'Ajout...';

                    await fetch(newUrl, {
                        method: 'POST',
                        headers,
                        body: newBody,
                        credentials: 'include'
                    });

                    // Ouvre le panier dans un nouvel onglet
                    window.open('https://www.micromania.fr/checkout/cart', '_blank');
                } catch (e) {
                    console.error('[Micromania SKU Injector] Erreur réseau', e);
                    alert('Erreur réseau. Regarde la console.');
                } finally {
                    btnInjector.disabled = false;
                    btnInjector.textContent = 'SKU Injector';
                }
            });

            // Bouton PID actuel (affiche PID dans le label)
            const btnCurrentPid = document.createElement('button');
            btnCurrentPid.id = 'micromania-current-pid-btn';
            btnCurrentPid.textContent = 'PID: ?';
            btnCurrentPid.style.flex = '1';
            btnCurrentPid.style.cursor = 'pointer';
            btnCurrentPid.style.fontSize = '12px';
            btnCurrentPid.style.padding = '4px 6px';
            btnCurrentPid.style.borderRadius = '3px';
            btnCurrentPid.style.border = '1px solid #4caf50';
            btnCurrentPid.style.background = '#4caf50';
            btnCurrentPid.style.color = '#000';

            btnCurrentPid.addEventListener('click', () => {
                const pid = computeCurrentPid();
                if (pid) {
                    navigator.clipboard.writeText(pid).catch(() => {});
                    alert('PID actuel copié : ' + pid);
                } else {
                    alert('Impossible de déterminer le PID actuel sur cette page.');
                }
            });

            row.appendChild(btnInjector);
            row.appendChild(btnCurrentPid);
            panel.appendChild(row);

            // Texte info (affiché seulement si pas encore de template)
            const info = document.createElement('div');
            info.id = 'micromania-sku-template-info';
            info.style.fontSize = '11px';
            info.style.opacity = '0.8';
            info.textContent = 'Fais au moins un ajout au panier pour initialiser le template.';
            panel.appendChild(info);

            document.body.appendChild(panel);

            // Met à jour la visibilité de l'info selon l'état actuel
            updateTemplateInfoVisibility();

            // Met à jour le label PID actuel à l’arrivée sur la page
            setTimeout(() => {
                const pid = computeCurrentPid();
                if (pid) {
                    btnCurrentPid.textContent = 'PID: ' + pid;
                }
            }, 1000);
        }

        // Création panel au DOMReady
        function domReady(fn) {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                fn();
            } else {
                document.addEventListener('DOMContentLoaded', fn);
            }
        }

        domReady(() => {
            try {
                createPanel();
            } catch (e) {
                console.error('[Micromania SKU Injector] Erreur dans createPanel', e);
            }
        });
    });
})();
