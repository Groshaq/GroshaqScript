// ==UserScript==
// @name         Cultura SKU Injector
// @namespace    http://tampermonkey.net/
// @version      2
// @description  Ajoute un produit Cultura via son SKU
// @match        https://www.cultura.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Groshaq/GroshaqScript/main/Cultura%20SKU%20Injector.user.js
// @downloadURL  https://raw.githubusercontent.com/Groshaq/GroshaqScript/main/Cultura%20SKU%20Injector.user.js
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

            // 🔹 IDENTIQUE à ton script : live d'abord, sinon template stocké
            const baseUrl = state.url || state.storedUrl;
            const baseInit = state.init || state.storedInit;

            if (!baseUrl || !baseInit) {
                throw new Error(
                    'Ajoute un article au panier à la main sur le site Cultura, puis reclique sur "SKU Injector".'
                );
            }

            let payload;
            try {
                payload = JSON.parse(baseInit.body);
            } catch (e) {
                console.error('[SKU Injector] Body JSON invalide', e, baseInit.body);
                throw new Error("Impossible de parser le body JSON de référence.");
            }

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

        // =========================
        //   Données catégories / produits
        // =========================
        const SKU_CATEGORIES = [
            {
                name: 'ME2 Flammes Fantasmagoriques',
                products: [
                    { label: 'ETB', sku: '12369069' },
                    { label: 'UPC', sku: '12435439' },
                    { label: 'Booster', sku: '12369070' },
                    { label: 'Tripack', sku: '12369071' }
                ]
            },
            {
                name: 'ME1 Mega-Evolution',
                products: [
                    { label: 'Mini Tins', sku: '12369064' },
                    { label: 'Tripack', sku: '12369060' },
                    { label: 'Booster', sku: '12369059' }
                ]
            },
            {
                name: 'EV8.5 Evolutions Prismatiques',
                products: [
                    { label: 'Coffret Premium Figurine', sku: '12169595' }
                ]
            },
            {
                name: 'ARTICLE TEST',
                products: [
                    { label: 'Calendrier de l’Avent en bois - Sapin tradition - Créalia', sku: '11896492' }
                ]
            }
        ];

        // =========================
        //   Gestion de la popin moderne
        // =========================
        const modalState = {
            overlay: null,
            container: null,
            skuInput: null,
            addButton: null,
            errorBox: null,
            categoryList: null,
            productList: null
        };

        // =========================
        //   Popin d'information (pas de template)
        // =========================
        const infoModalState = {
            overlay: null,
            container: null,
            messageBox: null
        };

        function createInfoModalIfNeeded() {
            if (infoModalState.overlay) return;

            const overlay = document.createElement('div');
            overlay.id = 'sku-injector-info-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                inset: '0',
                background: 'rgba(0,0,0,0.45)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '100001',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            });

            const dialog = document.createElement('div');
            Object.assign(dialog.style, {
                background: '#ffffff',
                borderRadius: '10px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                width: 'min(90vw, 420px)',
                maxWidth: '420px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            });

            const header = document.createElement('div');
            header.textContent = 'Information';
            Object.assign(header.style, {
                padding: '10px 16px',
                background: '#0066cc',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: '600'
            });

            const body = document.createElement('div');
            Object.assign(body.style, {
                padding: '14px 16px',
                fontSize: '13px',
                color: '#111827'
            });

            const msg = document.createElement('div');
            Object.assign(msg.style, {
                marginBottom: '12px',
                lineHeight: '1.5'
            });

            const buttonRow = document.createElement('div');
            Object.assign(buttonRow.style, {
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '8px'
            });

            const okBtn = document.createElement('button');
            okBtn.textContent = 'OK';
            Object.assign(okBtn.style, {
                padding: '6px 14px',
                background: '#2563eb',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
            });

            okBtn.addEventListener('mouseenter', () => {
                okBtn.style.background = '#1d4ed8';
            });
            okBtn.addEventListener('mouseleave', () => {
                okBtn.style.background = '#2563eb';
            });

            okBtn.addEventListener('click', hideInfoModal);

            buttonRow.appendChild(okBtn);
            body.appendChild(msg);
            body.appendChild(buttonRow);

            dialog.appendChild(header);
            dialog.appendChild(body);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) hideInfoModal();
            });

            infoModalState.overlay = overlay;
            infoModalState.container = dialog;
            infoModalState.messageBox = msg;
        }

        function showInfoModal(message) {
            createInfoModalIfNeeded();
            if (infoModalState.messageBox) {
                infoModalState.messageBox.innerHTML = message;
            }
            if (infoModalState.overlay) {
                infoModalState.overlay.style.display = 'flex';
            }
        }

        function hideInfoModal() {
            if (infoModalState.overlay) {
                infoModalState.overlay.style.display = 'none';
            }
        }

        function createModalIfNeeded() {
            if (modalState.overlay) return;

            // Overlay
            const overlay = document.createElement('div');
            overlay.id = 'sku-injector-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                inset: '0',
                background: 'rgba(0, 0, 0, 0.45)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '100000',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            });

            // Container
            const container = document.createElement('div');
            Object.assign(container.style, {
                background: '#ffffff',
                borderRadius: '10px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25)',
                width: 'min(90vw, 640px)',
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            });

            // Header (bandeau BLEU)
            const header = document.createElement('div');
            Object.assign(header.style, {
                padding: '12px 20px',
                borderBottom: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#0066cc',
                color: '#ffffff'
            });

            const title = document.createElement('div');
            title.textContent = 'Cultura SKU Injector';
            Object.assign(title.style, {
                fontSize: '16px',
                fontWeight: '600',
                color: '#ffffff'
            });

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            Object.assign(closeBtn.style, {
                border: 'none',
                background: 'transparent',
                fontSize: '20px',
                lineHeight: '1',
                cursor: 'pointer',
                padding: '0 4px',
                color: '#ffffff'
            });

            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.opacity = '0.8';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.opacity = '1';
            });

            closeBtn.addEventListener('click', hideModal);
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) hideModal();
            });

            header.appendChild(title);
            header.appendChild(closeBtn);

            // Body
            const body = document.createElement('div');
            Object.assign(body.style, {
                display: 'flex',
                gap: '16px',
                padding: '16px 20px',
                flex: '1',
                overflow: 'hidden',
                background: '#f9fafb'
            });

            // Colonne catégories
            const colLeft = document.createElement('div');
            Object.assign(colLeft.style, {
                width: '38%',
                borderRight: '1px solid #e5e7eb',
                paddingRight: '12px',
                paddingLeft: '8px',
                display: 'flex',
                flexDirection: 'column',
                background: '#ffffff',
                borderRadius: '8px',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.02)'
            });

            const catTitle = document.createElement('div');
            catTitle.textContent = 'CATÉGORIES';
            Object.assign(catTitle.style, {
                fontSize: '13px',
                fontWeight: '600',
                margin: '10px 10px 6px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#555'
            });

            const catList = document.createElement('div');
            Object.assign(catList.style, {
                overflowY: 'auto',
                padding: '0 6px 10px'
            });

            colLeft.appendChild(catTitle);
            colLeft.appendChild(catList);

            // Colonne produits + saisie
            const colRight = document.createElement('div');
            Object.assign(colRight.style, {
                width: '62%',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: '#ffffff',
                borderRadius: '8px',
                padding: '10px 12px',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.02)'
            });

            const prodTitle = document.createElement('div');
            prodTitle.textContent = 'PRODUITS';
            Object.assign(prodTitle.style, {
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#555'
            });

            const prodList = document.createElement('div');
            Object.assign(prodList.style, {
                flex: '1',
                overflowY: 'auto',
                borderRadius: '6px',
                border: '1px solid #f0f0f0',
                padding: '6px',
                background: '#f9fafb'
            });

            // Zone saisie / actions
            const formArea = document.createElement('div');
            Object.assign(formArea.style, {
                marginTop: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
            });

            const skuLabel = document.createElement('label');
            skuLabel.textContent = 'SKU à ajouter au panier';
            Object.assign(skuLabel.style, {
                fontSize: '13px',
                fontWeight: '500'
            });

            const skuInput = document.createElement('input');
            skuInput.type = 'text';
            skuInput.placeholder = 'Ex : 12212415 (doit commencer par 1xxxxx)';
            Object.assign(skuInput.style, {
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                outline: 'none',
                background: '#f9fafb'
            });
            skuInput.addEventListener('focus', () => {
                skuInput.style.borderColor = '#2563eb';
                skuInput.style.boxShadow = '0 0 0 1px rgba(37, 99, 235, 0.4)';
                skuInput.style.background = '#ffffff';
            });
            skuInput.addEventListener('blur', () => {
                skuInput.style.borderColor = '#d1d5db';
                skuInput.style.boxShadow = 'none';
                skuInput.style.background = '#f9fafb';
            });

            const actionsRow = document.createElement('div');
            Object.assign(actionsRow.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginTop: '4px'
            });

            const hint = document.createElement('div');
            hint.textContent = 'Clique sur un produit pour remplir le SKU, ou saisis-le manuellement.';
            Object.assign(hint.style, {
                fontSize: '11px',
                color: '#6b7280'
            });

            const addButton = document.createElement('button');
            addButton.textContent = 'Ajouter au panier';
            Object.assign(addButton.style, {
                whiteSpace: 'nowrap',
                padding: '8px 12px',
                background: '#2563eb',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                boxShadow: '0 1px 4px rgba(37,99,235,0.35)'
            });

            addButton.addEventListener('mouseenter', () => {
                if (!addButton.disabled) {
                    addButton.style.background = '#1d4ed8';
                }
            });
            addButton.addEventListener('mouseleave', () => {
                if (!addButton.disabled) {
                    addButton.style.background = '#2563eb';
                }
            });

            const errorBox = document.createElement('div');
            Object.assign(errorBox.style, {
                fontSize: '11px',
                color: '#b91c1c',
                minHeight: '14px'
            });

            actionsRow.appendChild(hint);
            actionsRow.appendChild(addButton);

            formArea.appendChild(skuLabel);
            formArea.appendChild(skuInput);
            formArea.appendChild(actionsRow);
            formArea.appendChild(errorBox);

            colRight.appendChild(prodTitle);
            colRight.appendChild(prodList);
            colRight.appendChild(formArea);

            body.appendChild(colLeft);
            body.appendChild(colRight);

            container.appendChild(header);
            container.appendChild(body);
            overlay.appendChild(container);
            document.body.appendChild(overlay);

            // Stockage des références
            modalState.overlay = overlay;
            modalState.container = container;
            modalState.skuInput = skuInput;
            modalState.addButton = addButton;
            modalState.errorBox = errorBox;
            modalState.categoryList = catList;
            modalState.productList = prodList;

            setupCategoriesUI();
            setupAddButtonLogic();
        }

        function setupCategoriesUI() {
            const catList = modalState.categoryList;
            const prodList = modalState.productList;
            if (!catList || !prodList) return;

            catList.innerHTML = '';
            prodList.innerHTML = '';

            let activeCategoryIndex = 0;

            function renderCategories() {
                catList.innerHTML = '';
                SKU_CATEGORIES.forEach((cat, index) => {
                    const item = document.createElement('div');
                    item.textContent = cat.name;
                    Object.assign(item.style, {
                        padding: '6px 10px',
                        marginBottom: '4px',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        border: index === activeCategoryIndex ? '1px solid #2563eb' : '1px solid transparent',
                        background: index === activeCategoryIndex ? 'rgba(37,99,235,0.08)' : 'transparent',
                        color: index === activeCategoryIndex ? '#1d4ed8' : '#111827'
                    });
                    item.addEventListener('click', () => {
                        activeCategoryIndex = index;
                        renderCategories();
                        renderProducts();
                    });
                    catList.appendChild(item);
                });
            }

            function renderProducts() {
                prodList.innerHTML = '';
                const cat = SKU_CATEGORIES[activeCategoryIndex];
                if (!cat) return;

                cat.products.forEach(prod => {
                    const row = document.createElement('button');
                    row.type = 'button';
                    Object.assign(row.style, {
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '6px 8px',
                        marginBottom: '4px',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb',
                        background: '#ffffff',
                        cursor: 'pointer',
                        fontSize: '12px',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.05)'
                    });

                    row.addEventListener('mouseenter', () => {
                        row.style.borderColor = '#2563eb';
                        row.style.background = '#f9fafb';
                    });
                    row.addEventListener('mouseleave', () => {
                        row.style.borderColor = '#e5e7eb';
                        row.style.background = '#ffffff';
                    });

                    const line1 = document.createElement('div');
                    line1.textContent = prod.label;
                    Object.assign(line1.style, {
                        fontWeight: '500',
                        marginBottom: '2px'
                    });

                    const line2 = document.createElement('div');
                    line2.textContent = 'SKU ' + prod.sku;
                    Object.assign(line2.style, {
                        color: '#4b5563',
                        fontFamily: 'monospace',
                        fontSize: '11px'
                    });

                    row.appendChild(line1);
                    row.appendChild(line2);

                    row.addEventListener('click', () => {
                        if (modalState.skuInput) {
                            modalState.skuInput.value = prod.sku;
                            modalState.skuInput.focus();
                            modalState.skuInput.select();
                        }
                    });

                    prodList.appendChild(row);
                });
            }

            renderCategories();
            renderProducts();
        }

        function setupAddButtonLogic() {
            const btn = modalState.addButton;
            const input = modalState.skuInput;
            const errorBox = modalState.errorBox;
            if (!btn || !input) return;

            function setLoading(isLoading) {
                btn.disabled = isLoading;
                btn.textContent = isLoading ? 'Ajout en cours...' : 'Ajouter au panier';
                btn.style.opacity = isLoading ? '0.7' : '1';
                btn.style.cursor = isLoading ? 'default' : 'pointer';
            }

            btn.addEventListener('click', async () => {
                if (!input.value.trim()) {
                    if (errorBox) {
                        errorBox.textContent = 'Merci de saisir ou de sélectionner un SKU.';
                    }
                    input.focus();
                    return;
                }

                if (errorBox) errorBox.textContent = '';

                setLoading(true);
                try {
                    await sendAddToCartWithSku(input.value);
                    hideModal();
                    window.open("https://www.cultura.com/checkout#panier", "_blank");
                } catch (e) {
                    alert("SKU Injector : " + e.message);
                    if (errorBox) {
                        errorBox.textContent = e.message || 'Une erreur est survenue.';
                    }
                } finally {
                    setLoading(false);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    btn.click();
                }
            });
        }

        function showModal() {
            createModalIfNeeded();
            if (modalState.overlay) {
                modalState.overlay.style.display = 'flex';
            }
            if (modalState.skuInput) {
                modalState.skuInput.focus();
                modalState.skuInput.select();
            }
            if (modalState.errorBox) {
                modalState.errorBox.textContent = '';
            }
        }

        function hideModal() {
            if (modalState.overlay) {
                modalState.overlay.style.display = 'none';
            }
        }

        // =========================
        //   Bouton flottant principal
        // =========================
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

            btn.addEventListener('click', () => {
                const hasTemplate = !!(state.url || state.storedUrl) && !!(state.init || state.storedInit);
                if (!hasTemplate) {
                showInfoModal(
    "Aucun panier de référence détecté.<br><br>" +
    "<strong>Étapes nécessaires :</strong><br><br>" +
    "1️⃣ Ajoute d’abord un article au panier <strong>à la main</strong> sur le site Cultura.<br>" +
    "&nbsp;&nbsp;&nbsp;&nbsp;→ Utilise le bouton « Ajouter au panier » sur n’importe quel produit.<br><br>" +
    "2️⃣ Reviens ensuite cliquer sur « SKU Injector » pour débloquer l’outil.<br><br>" +
    "ℹ️ Astuce : n’importe quel article fonctionne, il sert juste à initialiser le panier."
);


                    return;
                }

                showModal();
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
