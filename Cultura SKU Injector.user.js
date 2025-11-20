// ==UserScript==
// @name         Cultura SKU Injector
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Ajoute un produit Cultura via son SKU
// @match        https://www.cultura.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/Cultura%20SKU%20Injector.user.js
// @downloadURL  https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/Cultura%20SKU%20Injector.user.js
// ==/UserScript==

(function () {
    'use strict';

    function inject(fn) {
        const s = document.createElement('script');
        s.textContent = '(' + fn.toString() + ')();';
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    }

    inject(function pageContext() {

        const TAMPON_SKU = '12440268'; // ton produit “technique” éventuellement utile plus tard

        const state = {
            url: null,
            init: null,
            storedUrl: null,
            storedInit: null
        };

        function cloneHeaders(headers) {
            if (!headers) return null;

            if (headers instanceof Headers) {
                const h = new Headers();
                headers.forEach((v, k) => h.append(k, v));
                return h;
            }

            if (Array.isArray(headers)) {
                return headers.map(([k, v]) => [k, v]);
            }

            if (typeof headers === 'object') {
                return { ...headers };
            }

            return headers;
        }

        // 🔹 Chargement d'un template sauvegardé (si on en a déjà un dans localStorage)
        (function loadStoredTemplate() {
            try {
                const raw = localStorage.getItem('culturaSkuInjectorTemplate');
                if (!raw) return;
                const parsed = JSON.parse(raw);

                if (parsed && parsed.url && parsed.init && parsed.init.body) {
                    state.storedUrl = parsed.url;
                    state.storedInit = {
                        ...parsed.init,
                        headers: parsed.init.headers || { 'content-type': 'application/json' },
                        body: parsed.init.body
                    };
                    console.log('[SKU Injector] Template chargé depuis localStorage');
                }
            } catch (e) {
                console.warn('[SKU Injector] Impossible de charger le template localStorage', e);
            }
        })();

        const originalFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string'
                    ? input
                    : (input && input.url) || '';

                if (
                    url.includes('/magento/graphql') &&
                    init &&
                    typeof init.body === 'string' &&
                    init.body.includes('addSimpleProductsToCart')
                ) {
                    state.url = url;
                    state.init = {
                        ...init,
                        headers: cloneHeaders(init.headers),
                        body: init.body
                    };
                    console.log('[SKU Injector] Requête addSimpleProductsToCart capturée');

                    // 🔹 On sauvegarde un template réutilisable dans localStorage
                    try {
                        localStorage.setItem(
                            'culturaSkuInjectorTemplate',
                            JSON.stringify({
                                url,
                                init: {
                                    method: init.method || 'POST',
                                    headers: init.headers,
                                    body: init.body
                                }
                            })
                        );
                        console.log('[SKU Injector] Template sauvegardé dans localStorage');
                    } catch (e) {
                        console.warn('[SKU Injector] Impossible de sauvegarder le template', e);
                    }
                }
            } catch (e) {
                console.warn('[SKU Injector] Erreur dans le hook fetch', e);
            }

            return originalFetch.apply(this, arguments);
        };

        async function sendAddToCartWithSku(sku) {
            const cleanSku = sku.trim();
            if (!cleanSku) return;

            // On prend en priorité la requête "live", sinon le template stocké
            const baseUrl = state.url || state.storedUrl;
            const baseInit = state.init || state.storedInit;

            if (!baseUrl || !baseInit) {
                // Fallback de sécurité, normalement on aura déjà alerté avant
                throw new Error(
                    'Ajoute un article au panier, puis clique sur le bouton "SKU Injector".'
                );
            }

            let payload;
            try {
                payload = JSON.parse(baseInit.body);
            } catch (e) {
                console.error('[SKU Injector] Body JSON invalide', e, baseInit.body);
                throw new Error("Impossible de parser le body JSON de référence.");
            }

            // On remplace le SKU
            if (
                !payload ||
                !payload.variables ||
                !Array.isArray(payload.variables.cartItems) ||
                !payload.variables.cartItems[0] ||
                !payload.variables.cartItems[0].data
            ) {
                console.error('[SKU Injector] Structure cartItems inconnue', payload);
                throw new Error("Structure cartItems inattendue dans la requête.");
            }

            payload.variables.cartItems[0].data.sku = cleanSku;

            const newInit = {
                ...baseInit,
                headers: cloneHeaders(baseInit.headers),
                body: JSON.stringify(payload)
            };

            // Tag optionnel
            if (newInit.headers instanceof Headers) {
                newInit.headers.set('x-sku-injector', '1');
            } else if (Array.isArray(newInit.headers)) {
                newInit.headers.push(['x-sku-injector', '1']);
            } else if (typeof newInit.headers === 'object' && newInit.headers !== null) {
                newInit.headers['x-sku-injector'] = '1';
            }

            const resp = await originalFetch(baseUrl, newInit);
            let json;
            try {
                json = await resp.json();
            } catch (e) {
                console.error('[SKU Injector] Réponse non JSON', e);
                throw new Error("Réponse GraphQL non JSON.");
            }

            if (json.errors) {
                console.error('[SKU Injector] Erreurs GraphQL :', json.errors);
                throw new Error(json.errors[0]?.message || "Erreur GraphQL lors de l'ajout du SKU.");
            }

            return json;
        }

        function createButton() {
            if (document.getElementById('sku-injector-btn')) return;

            const btn = document.createElement('button');
            btn.id = 'sku-injector-btn';
            btn.textContent = 'SKU Injector';

            Object.assign(btn.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '99999',
                padding: '10px 16px',
                background: '#0066cc',
                color: '#ffffff',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                fontSize: '14px',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            });

            btn.addEventListener('mouseenter', () => btn.style.background = '#0050a8');
            btn.addEventListener('mouseleave', () => btn.style.background = '#0066cc');

            btn.addEventListener('click', async () => {

                // 🔹 1) AVANT toute saisie de SKU, on vérifie qu'on a bien un template
                const hasTemplate = !!(state.url || state.storedUrl) && !!(state.init || state.storedInit);
                if (!hasTemplate) {
                    // Message d'erreur dès le clic sur le bouton
                    alert(
                        'Cultura SKU Injector\n\n' +
                        'Ajoute un article au panier, puis clique sur le bouton "SKU Injector".'
                    );
                    return;
                }

                // 🔹 2) Si on a déjà un template, on peut demander le SKU
                const sku = prompt('SKU à injecter dans le panier ? Le SKU doit comment par 1xxxxx (exemple: 12212415)');
                if (!sku) return;

                btn.disabled = true;
                btn.textContent = 'Ajout...';

                try {
                    await sendAddToCartWithSku(sku);
                    window.open("https://www.cultura.com/checkout#panier", "_blank");
                } catch (e) {
                    alert("SKU Injector : " + e.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'SKU Injector';
                }
            });

            document.body.appendChild(btn);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createButton);
        } else {
            createButton();
        }
    });
})();
