// ==UserScript==
// @name         Cultura SKU Injector
// @namespace    http://tampermonkey.net/
// @version      4
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

        const TEMPLATE_STORAGE_KEY = 'culturaSkuInjectorTemplate';
        const CUSTOM_CATEGORIES_STORAGE_KEY = 'culturaSkuInjectorCustomCategories';
        const CATEGORY_ORDER_STORAGE_KEY = 'culturaSkuInjectorCategoryOrder';
        const PRODUCT_ORDER_STORAGE_KEY = 'culturaSkuInjectorProductOrder';
        const RETRY_DELAY_STORAGE_KEY = 'culturaSkuInjectorRetryDelayMs';
        const RETRY_STATE_STORAGE_KEY = 'culturaSkuInjectorRetryState';
        const RETRY_STOP_STORAGE_KEY = 'culturaSkuInjectorRetryStopRequested';
        const DEFAULT_RETRY_DELAY_MS = 250;

        const state = {
            url: null,
            init: null,
            storedUrl: null,
            storedInit: null,
            retryTimerId: null,
            retryLoopRunning: false,
            isMobileLayout: false
        };

        const catalogState = {
            customCategories: [],
            activeCategoryName: null,
            isEditorOpen: false,
            isRetryPanelOpen: false,
            isCategoryPanelOpen: false,
            categoryOrder: [],
            productOrder: {},
            retryDelayMs: DEFAULT_RETRY_DELAY_MS
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
                const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
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

        (function loadStoredCategories() {
            try {
                const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    catalogState.customCategories = parsed
                        .filter(cat => cat && typeof cat.name === 'string' && Array.isArray(cat.products))
                        .map(cat => ({
                            name: cat.name.trim(),
                            products: cat.products
                                .filter(prod => prod && typeof prod.label === 'string' && typeof prod.sku === 'string')
                                .map(prod => ({
                                    label: prod.label.trim(),
                                    sku: prod.sku.trim()
                                }))
                                .filter(prod => prod.label && prod.sku)
                        }))
                        .filter(cat => cat.name);
                }
            } catch (e) {
                console.warn('[SKU Injector] Impossible de charger les catégories personnalisées', e);
            }
        })();

        (function loadStoredOrdering() {
            try {
                const rawCategoryOrder = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
                const parsedCategoryOrder = rawCategoryOrder ? JSON.parse(rawCategoryOrder) : [];
                if (Array.isArray(parsedCategoryOrder)) {
                    catalogState.categoryOrder = parsedCategoryOrder.filter(name => typeof name === 'string' && name.trim());
                }
            } catch (e) {
                console.warn('[SKU Injector] Impossible de charger l’ordre des catégories', e);
            }

            try {
                const rawProductOrder = localStorage.getItem(PRODUCT_ORDER_STORAGE_KEY);
                const parsedProductOrder = rawProductOrder ? JSON.parse(rawProductOrder) : {};
                if (parsedProductOrder && typeof parsedProductOrder === 'object') {
                    catalogState.productOrder = Object.keys(parsedProductOrder).reduce((acc, key) => {
                        const value = parsedProductOrder[key];
                        if (Array.isArray(value)) {
                            acc[key] = value.filter(id => typeof id === 'string' && id.trim());
                        }
                        return acc;
                    }, {});
                }
            } catch (e) {
                console.warn('[SKU Injector] Impossible de charger l’ordre des produits', e);
            }
        })();

        (function loadRetryDelay() {
            try {
                const raw = localStorage.getItem(RETRY_DELAY_STORAGE_KEY);
                const parsed = raw ? Number(raw) : NaN;
                if (Number.isFinite(parsed) && parsed >= 0) {
                    catalogState.retryDelayMs = Math.round(parsed);
                }
            } catch (e) {
                console.warn('[SKU Injector] Impossible de charger le délai de retry', e);
            }
        })();

        function saveRetryDelay(delayMs) {
            catalogState.retryDelayMs = delayMs;
            localStorage.setItem(RETRY_DELAY_STORAGE_KEY, String(delayMs));
        }

        function getRetryState() {
            try {
                const raw = sessionStorage.getItem(RETRY_STATE_STORAGE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.active || !parsed.sku) return null;
                return {
                    active: true,
                    sku: String(parsed.sku).trim(),
                    delayMs: Math.max(0, Math.round(Number(parsed.delayMs) || DEFAULT_RETRY_DELAY_MS)),
                    count: Math.max(0, Math.round(Number(parsed.count) || 0)),
                    status: parsed.status ? String(parsed.status) : 'Retry actif'
                };
            } catch (e) {
                console.warn('[SKU Injector] Impossible de lire l’état du retry', e);
                return null;
            }
        }

        function setRetryState(retryState) {
            sessionStorage.setItem(RETRY_STATE_STORAGE_KEY, JSON.stringify(retryState));
        }

        function clearRetryState() {
            sessionStorage.removeItem(RETRY_STATE_STORAGE_KEY);
        }

        function setRetryStopRequested(isRequested) {
            if (isRequested) {
                sessionStorage.setItem(RETRY_STOP_STORAGE_KEY, '1');
            } else {
                sessionStorage.removeItem(RETRY_STOP_STORAGE_KEY);
            }
        }

        function isRetryStopRequested() {
            return sessionStorage.getItem(RETRY_STOP_STORAGE_KEY) === '1';
        }

        function wait(ms) {
            return new Promise(resolve => {
                state.retryTimerId = window.setTimeout(resolve, ms);
            });
        }

        function isMobileViewport() {
            return window.innerWidth <= 760;
        }

        function isCartPage() {
            return window.location.href.includes('/checkout#panier');
        }

        function saveCategoryOrder() {
            localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(catalogState.categoryOrder));
        }

        function saveProductOrder() {
            localStorage.setItem(PRODUCT_ORDER_STORAGE_KEY, JSON.stringify(catalogState.productOrder));
        }

        function productId(product) {
            return product.sku + '::' + product.label;
        }

        function ensureCategoryOrder(categories) {
            const names = categories.map(cat => cat.name);
            const known = catalogState.categoryOrder.filter(name => names.includes(name));
            const missing = names.filter(name => !known.includes(name));
            const next = known.concat(missing);

            if (next.length !== catalogState.categoryOrder.length || next.some((name, index) => catalogState.categoryOrder[index] !== name)) {
                catalogState.categoryOrder = next;
                saveCategoryOrder();
            }

            return next;
        }

        function ensureProductOrderForCategory(category) {
            const ids = category.products.map(productId);
            const current = Array.isArray(catalogState.productOrder[category.name]) ? catalogState.productOrder[category.name] : [];
            const known = current.filter(id => ids.includes(id));
            const missing = ids.filter(id => !known.includes(id));
            const next = known.concat(missing);

            if (next.length !== current.length || next.some((id, index) => current[index] !== id)) {
                catalogState.productOrder[category.name] = next;
                saveProductOrder();
            }

            return next;
        }

        function moveInArray(items, fromIndex, toIndex) {
            if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
                return items.slice();
            }

            const next = items.slice();
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        }

        function moveCategory(categoryName, direction) {
            const categories = getAllCategories();
            const order = ensureCategoryOrder(categories);
            const index = order.indexOf(categoryName);
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return;

            catalogState.categoryOrder = moveInArray(order, index, targetIndex);
            saveCategoryOrder();
        }

        function moveProduct(categoryName, product, direction) {
            const categories = getAllCategories();
            const category = categories.find(cat => cat.name === categoryName);
            if (!category) return;

            const order = ensureProductOrderForCategory(category);
            const id = productId(product);
            const index = order.indexOf(id);
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return;

            catalogState.productOrder[categoryName] = moveInArray(order, index, targetIndex);
            saveProductOrder();
        }

        function getAllCategories() {
            const merged = DEFAULT_SKU_CATEGORIES.map(cat => ({
                name: cat.name,
                products: cat.products.map(prod => ({
                    label: prod.label,
                    sku: prod.sku
                }))
            }));

            catalogState.customCategories.forEach(customCat => {
                const existing = merged.find(cat => cat.name.toLowerCase() === customCat.name.toLowerCase());
                if (!existing) {
                    merged.push({
                        name: customCat.name,
                        products: customCat.products.map(prod => ({
                            label: prod.label,
                            sku: prod.sku
                        }))
                    });
                    return;
                }

                customCat.products.forEach(customProd => {
                    const existingProduct = existing.products.find(
                        prod => prod.sku === customProd.sku || prod.label.toLowerCase() === customProd.label.toLowerCase()
                    );

                    if (existingProduct) {
                        existingProduct.label = customProd.label;
                        existingProduct.sku = customProd.sku;
                    } else {
                        existing.products.push({
                            label: customProd.label,
                            sku: customProd.sku
                        });
                    }
                });
            });

            const categoryOrder = ensureCategoryOrder(merged);
            const orderedCategories = categoryOrder
                .map(name => merged.find(cat => cat.name === name))
                .filter(Boolean);

            orderedCategories.forEach(category => {
                const productOrder = ensureProductOrderForCategory(category);
                category.products = productOrder
                    .map(id => category.products.find(prod => productId(prod) === id))
                    .filter(Boolean);
            });

            return orderedCategories;
        }

        function saveCustomCategories() {
            localStorage.setItem(
                CUSTOM_CATEGORIES_STORAGE_KEY,
                JSON.stringify(catalogState.customCategories)
            );
        }

        function addCustomProduct(categoryName, label, sku) {
            const cleanCategoryName = categoryName.trim();
            const cleanLabel = label.trim();
            const cleanSku = sku.trim();

            if (!cleanCategoryName || !cleanLabel || !cleanSku) {
                throw new Error('Merci de renseigner une catégorie, un article et un SKU.');
            }

            const existingCategory = catalogState.customCategories.find(
                cat => cat.name.toLowerCase() === cleanCategoryName.toLowerCase()
            );

            if (existingCategory) {
                const existingProduct = existingCategory.products.find(
                    prod => prod.sku === cleanSku || prod.label.toLowerCase() === cleanLabel.toLowerCase()
                );
                if (existingProduct) {
                    existingProduct.label = cleanLabel;
                    existingProduct.sku = cleanSku;
                } else {
                    existingCategory.products.push({
                        label: cleanLabel,
                        sku: cleanSku
                    });
                }
            } else {
                catalogState.customCategories.push({
                    name: cleanCategoryName,
                    products: [
                        {
                            label: cleanLabel,
                            sku: cleanSku
                        }
                    ]
                });
            }

            saveCustomCategories();

            return {
                categoryName: cleanCategoryName,
                wasDefaultCategory: false
            };
        }

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
                            TEMPLATE_STORAGE_KEY,
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

            const baseUrl = state.url || state.storedUrl;
            const baseInit = state.init || state.storedInit;

            if (!baseUrl || !baseInit) {
                throw new Error(
                    'Ajoute d’abord un article au panier manuellement sur Cultura, puis relance le script.'
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
        const DEFAULT_SKU_CATEGORIES = [
            {
                name: '30 ans',
                products: [
                    { label: 'Collection illustration premiers partenaires Pokémon - Série 1', sku: '12768537' },
                    { label: 'Coffret Journée Pokémon Day 26', sku: '12768532' }
                ]
            },
            {
                name: 'ME3 Equilibre parfait',
                products: [
                    { label: 'Booster', sku: '12768545' },
                    { label: 'Tripack', sku: '12768533' },
                    { label: 'ETB', sku: '12768539' },
                    { label: 'Bundle', sku: '12768536' }
                ]
            },
            {
                name: 'ME2.5 Héros transcendants',
                products: [
                    { label: "Pin's Deluxe", sku: '12768535' },
                    { label: 'Collection poster', sku: '12768540' }
                ]
            },
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
                    { label: 'Booster', sku: '12369059' },
                    { label: 'ETB', sku: '11987409' }
                ]
            },
            {
                name: 'EV10.5',
                products: [
                    { label: 'Bundle Foudre Noire', sku: '11987412' },
                    { label: 'ETB Flamme Blanche', sku: '11987401' },
                    { label: 'ETB Foudre Noire', sku: '11987402' }
                ]
            },
            {
                name: 'EV10 Rivalités Destinées',
                products: [
                    { label: 'ETB', sku: '11903647' }
                ]
            },
            {
                name: 'EV8.5 Evolutions Prismatiques',
                products: [
                    { label: 'Coffret Premium Figurine', sku: '12169595' }
                ]
            },
            {
                name: 'EV8 Étincelles Déferlantes',
                products: [
                    { label: 'Booster', sku: '12435442' }
                ]
            },
            {
                name: 'ARTICLE TEST',
                products: [
                    { label: 'Calendrier de l’Avent en bois - Sapin tradition - Créalia', sku: '11896492' }
                ]
            },
            {
                name: 'Autres',
                products: [
                    { label: 'Booster Origine Perdue', sku: '12435444' }
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
            retryButton: null,
            retryDelayInput: null,
            errorBox: null,
            categoryList: null,
            productList: null,
            categoryInput: null,
            itemLabelInput: null,
            itemSkuInput: null,
            saveItemButton: null,
            saveItemMessage: null,
            editorPanel: null,
            editorToggleButton: null,
            categoryToggleButton: null
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

            const container = document.createElement('div');
            Object.assign(container.style, {
                background: '#ffffff',
                borderRadius: '14px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25)',
                width: 'min(92vw, 760px)',
                maxHeight: '84vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            });

            const header = document.createElement('div');
            Object.assign(header.style, {
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#0066cc',
                color: '#ffffff'
            });

            const headerLeft = document.createElement('div');
            Object.assign(headerLeft.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            });

            const editorToggleButton = document.createElement('button');
            editorToggleButton.type = 'button';
            Object.assign(editorToggleButton.style, {
                border: '1px solid rgba(255,255,255,0.45)',
                background: 'rgba(255,255,255,0.14)',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: '600',
                padding: '7px 12px',
                borderRadius: '999px',
                cursor: 'pointer'
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

            headerLeft.appendChild(editorToggleButton);
            headerLeft.appendChild(title);
            header.appendChild(headerLeft);
            header.appendChild(closeBtn);

            const body = document.createElement('div');
            Object.assign(body.style, {
                display: 'flex',
                gap: '16px',
                padding: '16px',
                flex: '1',
                overflow: 'hidden',
                background: '#f9fafb'
            });

            const colLeft = document.createElement('div');
            Object.assign(colLeft.style, {
                width: '250px',
                minWidth: '250px',
                display: 'flex',
                flexDirection: 'column',
                background: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 0 0 1px rgba(15,23,42,0.06)',
                overflow: 'hidden'
            });

            const catHeader = document.createElement('div');
            Object.assign(catHeader.style, {
                padding: '14px 14px 10px',
                borderBottom: '1px solid #eef2f7',
                background: '#f8fafc'
            });

            const catTitle = document.createElement('div');
            catTitle.textContent = 'Categories';
            Object.assign(catTitle.style, {
                fontSize: '12px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#64748b'
            });

            const catList = document.createElement('div');
            Object.assign(catList.style, {
                overflowY: 'auto',
                padding: '10px',
                flex: '1'
            });

            catHeader.appendChild(catTitle);
            colLeft.appendChild(catHeader);
            colLeft.appendChild(catList);

            const colRight = document.createElement('div');
            Object.assign(colRight.style, {
                flex: '1',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                background: '#ffffff',
                borderRadius: '12px',
                padding: '14px',
                boxShadow: '0 0 0 1px rgba(15,23,42,0.06)',
                overflow: 'hidden'
            });

            const editorPanel = document.createElement('div');
            Object.assign(editorPanel.style, {
                display: 'none',
                flexDirection: 'column',
                gap: '8px',
                padding: '14px',
                borderRadius: '10px',
                border: '1px solid #dbeafe',
                background: '#f8fbff'
            });

            const prodHeader = document.createElement('div');
            Object.assign(prodHeader.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
            });

            const categoryToggleButton = document.createElement('button');
            categoryToggleButton.type = 'button';
            categoryToggleButton.textContent = 'Categories';
            Object.assign(categoryToggleButton.style, {
                display: 'none',
                whiteSpace: 'nowrap',
                padding: '7px 12px',
                background: '#eef4ff',
                color: '#1d4ed8',
                borderRadius: '999px',
                border: '1px solid #bfdbfe',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600'
            });
            categoryToggleButton.addEventListener('click', () => {
                catalogState.isCategoryPanelOpen = !catalogState.isCategoryPanelOpen;
                applyResponsiveLayout();
                if (catalogState.isCategoryPanelOpen && modalState.categoryList) {
                    window.requestAnimationFrame(() => {
                        const categoryPanel = modalState.categoryList.parentElement;
                        if (categoryPanel && typeof categoryPanel.scrollIntoView === 'function') {
                            categoryPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                    });
                }
            });

            const prodHeaderText = document.createElement('div');
            Object.assign(prodHeaderText.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
            });

            const prodTitle = document.createElement('div');
            prodTitle.textContent = 'Produits enregistres';
            Object.assign(prodTitle.style, {
                fontSize: '15px',
                fontWeight: '700',
                color: '#111827'
            });

            const prodSubtitle = document.createElement('div');
            prodSubtitle.textContent = 'Clique sur un article pour remplir automatiquement le SKU.';
            Object.assign(prodSubtitle.style, {
                fontSize: '12px',
                color: '#6b7280'
            });

            prodHeaderText.appendChild(prodTitle);
            prodHeaderText.appendChild(prodSubtitle);
            prodHeader.appendChild(prodHeaderText);
            prodHeader.appendChild(categoryToggleButton);

            const prodList = document.createElement('div');
            Object.assign(prodList.style, {
                flex: '1',
                overflowY: 'auto',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
                padding: '8px',
                background: '#f8fafc',
                minHeight: '220px'
            });

            const formArea = document.createElement('div');
            Object.assign(formArea.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '14px',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
                background: '#ffffff'
            });

            const skuLabel = document.createElement('label');
            skuLabel.textContent = 'SKU a ajouter au panier';
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
                height: '38px',
                minHeight: '38px',
                lineHeight: '20px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                outline: 'none',
                background: '#ffffff',
                boxSizing: 'border-box'
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
                marginTop: '2px'
            });

            const actionsRight = document.createElement('div');
            Object.assign(actionsRight.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexShrink: '0',
                flexWrap: 'wrap',
                justifyContent: 'flex-end'
            });

            const hint = document.createElement('div');
            hint.textContent = 'Clique sur un produit pour remplir le SKU, ou saisis-le manuellement.';
            Object.assign(hint.style, {
                fontSize: '11px',
                color: '#6b7280',
                lineHeight: '1.4',
                flex: '1'
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

            const retryDelayInput = document.createElement('input');
            retryDelayInput.type = 'number';
            retryDelayInput.min = '0';
            retryDelayInput.step = '50';
            retryDelayInput.value = String(catalogState.retryDelayMs);
            retryDelayInput.title = 'Délai entre chaque tentative (ms)';
            Object.assign(retryDelayInput.style, {
                width: '78px',
                padding: '8px 10px',
                height: '36px',
                minHeight: '36px',
                lineHeight: '20px',
                borderRadius: '999px',
                border: '1px solid #d1d5db',
                fontSize: '12px',
                background: '#ffffff',
                boxSizing: 'border-box',
                textAlign: 'center'
            });

            const retryDelaySuffix = document.createElement('div');
            retryDelaySuffix.textContent = 'ms';
            Object.assign(retryDelaySuffix.style, {
                fontSize: '12px',
                color: '#64748b',
                marginLeft: '-4px'
            });

            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.textContent = 'Retry';
            Object.assign(retryButton.style, {
                whiteSpace: 'nowrap',
                padding: '8px 12px',
                background: '#0f766e',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                boxShadow: '0 1px 4px rgba(15,118,110,0.28)'
            });

            retryButton.addEventListener('mouseenter', () => {
                if (!retryButton.disabled) {
                    retryButton.style.background = '#0b5f59';
                }
            });
            retryButton.addEventListener('mouseleave', () => {
                if (!retryButton.disabled) {
                    retryButton.style.background = '#0f766e';
                }
            });

            const errorBox = document.createElement('div');
            Object.assign(errorBox.style, {
                fontSize: '11px',
                color: '#b91c1c',
                minHeight: '14px'
            });

            const saveBox = document.createElement('div');
            Object.assign(saveBox.style, {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
            });

            const saveTitle = document.createElement('div');
            saveTitle.textContent = 'Ajouter une categorie / un article';
            Object.assign(saveTitle.style, {
                fontSize: '13px',
                fontWeight: '600',
                color: '#111827'
            });

            const saveHint = document.createElement('div');
            saveHint.textContent = 'Choisis une categorie existante ou tape un nouveau nom.';
            Object.assign(saveHint.style, {
                fontSize: '11px',
                color: '#6b7280',
                lineHeight: '1.4'
            });

            const categoryInput = document.createElement('input');
            categoryInput.type = 'text';
            categoryInput.placeholder = 'Catégorie existante ou nouvelle';
            Object.assign(categoryInput.style, {
                width: '100%',
                padding: '8px 10px',
                height: '38px',
                minHeight: '38px',
                lineHeight: '20px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                background: '#ffffff',
                boxSizing: 'border-box'
            });

            const itemLabelInput = document.createElement('input');
            itemLabelInput.type = 'text';
            itemLabelInput.placeholder = "Nom de l'article";
            Object.assign(itemLabelInput.style, {
                width: '100%',
                padding: '8px 10px',
                height: '38px',
                minHeight: '38px',
                lineHeight: '20px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                background: '#ffffff',
                boxSizing: 'border-box'
            });

            const itemSkuInput = document.createElement('input');
            itemSkuInput.type = 'text';
            itemSkuInput.placeholder = 'SKU de l’article';
            Object.assign(itemSkuInput.style, {
                width: '100%',
                padding: '8px 10px',
                height: '38px',
                minHeight: '38px',
                lineHeight: '20px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                background: '#ffffff',
                boxSizing: 'border-box'
            });

            const saveItemRow = document.createElement('div');
            Object.assign(saveItemRow.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px'
            });

            const saveItemButton = document.createElement('button');
            saveItemButton.type = 'button';
            saveItemButton.textContent = 'Enregistrer';
            Object.assign(saveItemButton.style, {
                whiteSpace: 'nowrap',
                padding: '8px 12px',
                background: '#0f766e',
                color: '#ffffff',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
            });

            const saveItemMessage = document.createElement('div');
            Object.assign(saveItemMessage.style, {
                fontSize: '11px',
                minHeight: '14px',
                color: '#065f46',
                flex: '1'
            });

            saveItemRow.appendChild(saveItemMessage);
            saveItemRow.appendChild(saveItemButton);

            saveBox.appendChild(saveTitle);
            saveBox.appendChild(saveHint);
            saveBox.appendChild(categoryInput);
            saveBox.appendChild(itemLabelInput);
            saveBox.appendChild(itemSkuInput);
            saveBox.appendChild(saveItemRow);

            editorPanel.appendChild(saveBox);

            actionsRight.appendChild(retryDelayInput);
            actionsRight.appendChild(retryDelaySuffix);
            actionsRight.appendChild(retryButton);
            actionsRight.appendChild(addButton);

            actionsRow.appendChild(hint);
            actionsRow.appendChild(actionsRight);

            formArea.appendChild(skuLabel);
            formArea.appendChild(skuInput);
            formArea.appendChild(actionsRow);
            formArea.appendChild(errorBox);

            colRight.appendChild(editorPanel);
            colRight.appendChild(prodHeader);
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
            modalState.retryButton = retryButton;
            modalState.retryDelayInput = retryDelayInput;
            modalState.errorBox = errorBox;
            modalState.categoryList = catList;
            modalState.productList = prodList;
            modalState.categoryInput = categoryInput;
            modalState.itemLabelInput = itemLabelInput;
            modalState.itemSkuInput = itemSkuInput;
            modalState.saveItemButton = saveItemButton;
            modalState.saveItemMessage = saveItemMessage;
            modalState.editorPanel = editorPanel;
            modalState.editorToggleButton = editorToggleButton;
            modalState.categoryToggleButton = categoryToggleButton;

            setupCategoriesUI();
            setupAddButtonLogic();
            setupCatalogFormLogic();
            applyResponsiveLayout();
        }

        function setupCategoriesUI() {
            const catList = modalState.categoryList;
            const prodList = modalState.productList;
            if (!catList || !prodList) return;

            catList.innerHTML = '';
            prodList.innerHTML = '';

            const categories = getAllCategories();
            if (!categories.length) return;

            if (
                !catalogState.activeCategoryName ||
                !categories.some(cat => cat.name === catalogState.activeCategoryName)
            ) {
                catalogState.activeCategoryName = categories[0].name;
            }

            function renderCategories() {
                catList.innerHTML = '';
                const orderedCategories = getAllCategories();
                orderedCategories.forEach((cat, index) => {
                    const isActive = cat.name === catalogState.activeCategoryName;
                    const item = document.createElement('div');
                    Object.assign(item.style, {
                        padding: '10px 12px',
                        marginBottom: '6px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        lineHeight: '1.35',
                        wordBreak: 'break-word',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        border: isActive ? '1px solid #2563eb' : '1px solid transparent',
                        background: isActive ? 'rgba(37,99,235,0.10)' : '#ffffff',
                        color: isActive ? '#1d4ed8' : '#111827'
                    });

                    const label = document.createElement('button');
                    label.type = 'button';
                    label.textContent = cat.name;
                    Object.assign(label.style, {
                        border: 'none',
                        background: 'transparent',
                        padding: '0',
                        margin: '0',
                        fontSize: '13px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'inherit',
                        flex: '1',
                        lineHeight: '1.35'
                    });

                    label.addEventListener('click', () => {
                        catalogState.activeCategoryName = cat.name;
                        if (modalState.categoryInput) {
                            modalState.categoryInput.value = cat.name;
                        }
                        renderCategories();
                        renderProducts();
                    });

                    const controls = document.createElement('div');
                    Object.assign(controls.style, {
                        display: 'flex',
                        gap: '4px',
                        flexShrink: '0'
                    });

                    function createMoveButton(symbol, disabled, direction) {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = symbol;
                        btn.disabled = disabled;
                        Object.assign(btn.style, {
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            border: '1px solid #d1d5db',
                            background: disabled ? '#f8fafc' : '#ffffff',
                            color: disabled ? '#cbd5e1' : '#475569',
                            cursor: disabled ? 'default' : 'pointer',
                            fontSize: '12px',
                            lineHeight: '1'
                        });
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (disabled) return;
                            moveCategory(cat.name, direction);
                            setupCategoriesUI();
                        });
                        return btn;
                    }

                    controls.appendChild(createMoveButton('↑', index === 0, 'up'));
                    controls.appendChild(createMoveButton('↓', index === orderedCategories.length - 1, 'down'));

                    item.appendChild(label);
                    item.appendChild(controls);
                    catList.appendChild(item);
                });
            }

            function renderProducts() {
                prodList.innerHTML = '';
                const cat = getAllCategories().find(category => category.name === catalogState.activeCategoryName);
                if (!cat) return;

                cat.products.forEach((prod, index) => {
                    const row = document.createElement('div');
                    Object.assign(row.style, {
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        padding: '10px 12px',
                        marginBottom: '6px',
                        borderRadius: '10px',
                        border: '1px solid #e5e7eb',
                        background: '#ffffff',
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

                    const infoButton = document.createElement('button');
                    infoButton.type = 'button';
                    Object.assign(infoButton.style, {
                        border: 'none',
                        background: 'transparent',
                        padding: '0',
                        margin: '0',
                        cursor: 'pointer',
                        textAlign: 'left',
                        flex: '1',
                        display: 'flex',
                        flexDirection: 'column'
                    });

                    const line1 = document.createElement('div');
                    line1.textContent = prod.label;
                    Object.assign(line1.style, {
                        fontWeight: '600',
                        marginBottom: '4px',
                        color: '#0f172a'
                    });

                    const line2 = document.createElement('div');
                    line2.textContent = 'SKU ' + prod.sku;
                    Object.assign(line2.style, {
                        color: '#4b5563',
                        fontFamily: 'monospace',
                        fontSize: '11px'
                    });

                    infoButton.appendChild(line1);
                    infoButton.appendChild(line2);

                    infoButton.addEventListener('click', () => {
                        if (modalState.skuInput) {
                            modalState.skuInput.value = prod.sku;
                            modalState.skuInput.focus();
                            modalState.skuInput.select();
                        }
                        const retrySkuInput = document.getElementById('sku-injector-retry-sku');
                        if (retrySkuInput) {
                            retrySkuInput.value = prod.sku;
                        }
                    });

                    const controls = document.createElement('div');
                    Object.assign(controls.style, {
                        display: 'flex',
                        gap: '4px',
                        flexShrink: '0'
                    });

                    function createMoveButton(symbol, disabled, direction) {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = symbol;
                        btn.disabled = disabled;
                        Object.assign(btn.style, {
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            border: '1px solid #d1d5db',
                            background: disabled ? '#f8fafc' : '#ffffff',
                            color: disabled ? '#cbd5e1' : '#475569',
                            cursor: disabled ? 'default' : 'pointer',
                            fontSize: '12px',
                            lineHeight: '1'
                        });
                        btn.addEventListener('click', () => {
                            if (disabled) return;
                            moveProduct(cat.name, prod, direction);
                            setupCategoriesUI();
                        });
                        return btn;
                    }

                    controls.appendChild(createMoveButton('↑', index === 0, 'up'));
                    controls.appendChild(createMoveButton('↓', index === cat.products.length - 1, 'down'));

                    row.appendChild(infoButton);
                    row.appendChild(controls);

                    prodList.appendChild(row);
                });
            }

            renderCategories();
            renderProducts();
        }

        function setupCatalogFormLogic() {
            const categoryInput = modalState.categoryInput;
            const itemLabelInput = modalState.itemLabelInput;
            const itemSkuInput = modalState.itemSkuInput;
            const saveItemButton = modalState.saveItemButton;
            const saveItemMessage = modalState.saveItemMessage;
            const editorPanel = modalState.editorPanel;
            const editorToggleButton = modalState.editorToggleButton;

            if (!categoryInput || !itemLabelInput || !itemSkuInput || !saveItemButton || !saveItemMessage || !editorPanel || !editorToggleButton) {
                return;
            }

            function syncEditorVisibility() {
                editorPanel.style.display = catalogState.isEditorOpen ? 'flex' : 'none';
                editorToggleButton.textContent = catalogState.isEditorOpen ? 'Fermer' : '+ Ajouter';
                editorToggleButton.style.background = catalogState.isEditorOpen ? '#ffffff' : 'rgba(255,255,255,0.14)';
                editorToggleButton.style.color = catalogState.isEditorOpen ? '#0f4ea8' : '#ffffff';
            }

            function setSaveMessage(message, isError) {
                saveItemMessage.textContent = message;
                saveItemMessage.style.color = isError ? '#b91c1c' : '#065f46';
            }

            editorToggleButton.addEventListener('click', () => {
                catalogState.isEditorOpen = !catalogState.isEditorOpen;
                syncEditorVisibility();
                if (catalogState.isEditorOpen) {
                    categoryInput.focus();
                    categoryInput.select();
                }
            });

            saveItemButton.addEventListener('click', () => {
                try {
                    const result = addCustomProduct(
                        categoryInput.value,
                        itemLabelInput.value,
                        itemSkuInput.value
                    );

                    catalogState.activeCategoryName = result.categoryName;
                    setupCategoriesUI();

                    if (modalState.skuInput) {
                        modalState.skuInput.value = itemSkuInput.value.trim();
                    }

                    itemLabelInput.value = '';
                    itemSkuInput.value = '';
                    catalogState.isEditorOpen = false;
                    syncEditorVisibility();
                    setSaveMessage('Article enregistré dans "' + result.categoryName + '".', false);
                } catch (e) {
                    setSaveMessage((e && e.message) || 'Impossible d’enregistrer cet article.', true);
                }
            });

            syncEditorVisibility();
        }

        function setupAddButtonLogic() {
            const btn = modalState.addButton;
            const retryBtn = modalState.retryButton;
            const retryDelayInput = modalState.retryDelayInput;
            const input = modalState.skuInput;
            const errorBox = modalState.errorBox;
            if (!btn || !retryBtn || !retryDelayInput || !input) return;

            function getRetryDelayMs() {
                const parsed = Number(retryDelayInput.value);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    throw new Error('Le délai de retry doit être un nombre en millisecondes.');
                }
                const normalized = Math.round(parsed);
                retryDelayInput.value = String(normalized);
                saveRetryDelay(normalized);
                return normalized;
            }

            function setLoading(isLoading) {
                btn.disabled = isLoading;
                retryBtn.disabled = isLoading;
                retryDelayInput.disabled = isLoading;
                btn.textContent = isLoading ? 'Ajout en cours...' : 'Ajouter au panier';
                btn.style.opacity = isLoading ? '0.7' : '1';
                btn.style.cursor = isLoading ? 'default' : 'pointer';
                retryBtn.style.opacity = isLoading ? '0.7' : '1';
                retryBtn.style.cursor = isLoading ? 'default' : 'pointer';
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

            retryBtn.addEventListener('click', () => {
                if (!input.value.trim()) {
                    if (errorBox) {
                        errorBox.textContent = 'Merci de saisir ou de sélectionner un SKU.';
                    }
                    input.focus();
                    return;
                }

                let delayMs;
                try {
                    delayMs = getRetryDelayMs();
                } catch (e) {
                    if (errorBox) {
                        errorBox.textContent = e.message || 'Délai de retry invalide.';
                    }
                    retryDelayInput.focus();
                    retryDelayInput.select();
                    return;
                }

                setRetryState({
                    active: true,
                    sku: input.value.trim(),
                    delayMs,
                    count: 0,
                    status: 'Retry actif'
                });

                catalogState.isRetryPanelOpen = true;
                hideModal();
                syncRetryControls();
                goToCartAndRunRetry();
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    btn.click();
                }
            });
        }

        function stopRetryLoop() {
            setRetryStopRequested(true);
            if (state.retryTimerId) {
                clearTimeout(state.retryTimerId);
                state.retryTimerId = null;
            }
            state.retryLoopRunning = false;
            clearRetryState();
            syncRetryControls();
        }

        function createFabContainerIfNeeded() {
            let container = document.getElementById('sku-injector-fab-container');
            if (container) return container;

            container = document.createElement('div');
            container.id = 'sku-injector-fab-container';
            Object.assign(container.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '99999',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                maxWidth: 'min(92vw, 900px)'
            });

            document.body.appendChild(container);
            return container;
        }

        function applyFabResponsiveLayout() {
            const container = document.getElementById('sku-injector-fab-container');
            if (!container) return;

            const isMobile = isMobileViewport();
            Object.assign(container.style, isMobile ? {
                bottom: '12px',
                right: '12px',
                left: '12px',
                maxWidth: 'none',
                justifyContent: 'space-between'
            } : {
                bottom: '20px',
                right: '20px',
                left: '',
                maxWidth: 'min(92vw, 900px)',
                justifyContent: 'flex-end'
            });
        }

        function syncRetryControls() {
            const container = document.getElementById('sku-injector-fab-container');
            if (!container) return;
            applyFabResponsiveLayout();

            const retryState = getRetryState();
            const isRunning = !!retryState;
            if (isRunning) {
                catalogState.isRetryPanelOpen = true;
            }

            let wrapper = document.getElementById('sku-injector-retry-wrapper');
            let launcherButton = document.getElementById('sku-injector-retry-launcher');
            let panel = document.getElementById('sku-injector-retry-panel');
            let skuInput = document.getElementById('sku-injector-retry-sku');
            let delayInput = document.getElementById('sku-injector-retry-delay');
            let toggleButton = document.getElementById('sku-injector-retry-toggle');

            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.id = 'sku-injector-retry-wrapper';
                Object.assign(wrapper.style, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end'
                });

                launcherButton = document.createElement('button');
                launcherButton.id = 'sku-injector-retry-launcher';
                launcherButton.type = 'button';
                launcherButton.textContent = 'Auto-Retry';
                Object.assign(launcherButton.style, {
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

                launcherButton.addEventListener('mouseenter', () => {
                    launcherButton.style.background = '#0050a8';
                });
                launcherButton.addEventListener('mouseleave', () => {
                    launcherButton.style.background = '#0066cc';
                });
                launcherButton.addEventListener('click', () => {
                    catalogState.isRetryPanelOpen = !catalogState.isRetryPanelOpen;
                    syncRetryControls();
                });

                panel = document.createElement('div');
                panel.id = 'sku-injector-retry-panel';
                Object.assign(panel.style, {
                    display: 'none',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px',
                    background: '#ffffff',
                    borderRadius: '999px',
                    boxShadow: '0 2px 10px rgba(15,23,42,0.14)',
                    border: '1px solid #dbe2ea'
                });

                skuInput = document.createElement('input');
                skuInput.id = 'sku-injector-retry-sku';
                skuInput.type = 'text';
                skuInput.placeholder = 'SKU';
                Object.assign(skuInput.style, {
                    width: '110px',
                    height: '34px',
                    padding: '6px 10px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '999px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    background: '#ffffff'
                });

                delayInput = document.createElement('input');
                delayInput.id = 'sku-injector-retry-delay';
                delayInput.type = 'number';
                delayInput.min = '0';
                delayInput.step = '50';
                Object.assign(delayInput.style, {
                    width: '72px',
                    height: '34px',
                    padding: '6px 10px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '999px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    textAlign: 'center',
                    background: '#ffffff'
                });

                const msLabel = document.createElement('div');
                msLabel.textContent = 'ms';
                Object.assign(msLabel.style, {
                    fontSize: '12px',
                    color: '#64748b'
                });

                toggleButton = document.createElement('button');
                toggleButton.id = 'sku-injector-retry-toggle';
                toggleButton.type = 'button';
                Object.assign(toggleButton.style, {
                    height: '34px',
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: '999px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '700',
                    whiteSpace: 'nowrap'
                });

                toggleButton.addEventListener('click', () => {
                    const currentRetryState = getRetryState();
                    if (currentRetryState) {
                        stopRetryLoop();
                        return;
                    }

                    const sku = skuInput.value.trim();
                    const delayMs = Math.max(0, Math.round(Number(delayInput.value) || 0));
                    if (!sku) {
                        skuInput.focus();
                        return;
                    }

                    setRetryStopRequested(false);
                    delayInput.value = String(delayMs);
                    saveRetryDelay(delayMs);
                    setRetryState({
                        active: true,
                        sku,
                        delayMs,
                        count: 0,
                        status: 'Retry actif'
                    });
                    syncRetryControls();
                    goToCartAndRunRetry();
                });

                skuInput.addEventListener('change', () => {
                    const currentRetryState = getRetryState();
                    if (currentRetryState) {
                        setRetryState({
                            ...currentRetryState,
                            sku: skuInput.value.trim()
                        });
                    }
                });

                delayInput.addEventListener('change', () => {
                    const delayMs = Math.max(0, Math.round(Number(delayInput.value) || 0));
                    delayInput.value = String(delayMs);
                    saveRetryDelay(delayMs);
                    const currentRetryState = getRetryState();
                    if (currentRetryState) {
                        setRetryState({
                            ...currentRetryState,
                            delayMs
                        });
                    }
                    syncRetryControls();
                });

                panel.appendChild(skuInput);
                panel.appendChild(delayInput);
                panel.appendChild(msLabel);
                panel.appendChild(toggleButton);
                wrapper.appendChild(launcherButton);
                wrapper.appendChild(panel);
                container.appendChild(wrapper);
            }

            skuInput.value = retryState ? retryState.sku : (skuInput.value || '');
            delayInput.value = String(retryState ? retryState.delayMs : catalogState.retryDelayMs);

            launcherButton.textContent = isRunning ? 'Auto-Retry actif' : 'Auto-Retry';
            launcherButton.style.background = isRunning ? '#0f766e' : '#0066cc';
            panel.style.display = (catalogState.isRetryPanelOpen || isRunning) ? 'flex' : 'none';
            toggleButton.textContent = isRunning
                ? 'Retry ON (' + retryState.count + ')'
                : 'Retry OFF';
            toggleButton.title = isRunning ? (retryState.status || 'Retry actif') : 'Démarrer le retry';
            toggleButton.style.background = isRunning ? '#0f766e' : '#b91c1c';
            toggleButton.style.boxShadow = isRunning
                ? '0 2px 6px rgba(15,118,110,0.30)'
                : '0 2px 6px rgba(185,28,28,0.30)';
            skuInput.disabled = false;
            delayInput.disabled = false;
        }

        async function startRetryLoop() {
            const retryState = getRetryState();
            if (!retryState || state.retryLoopRunning) return;
            if (isRetryStopRequested()) {
                setRetryStopRequested(false);
                clearRetryState();
                syncRetryControls();
                return;
            }

            state.retryLoopRunning = true;
            syncRetryControls();

            while (getRetryState()) {
                if (isRetryStopRequested()) {
                    setRetryStopRequested(false);
                    clearRetryState();
                    break;
                }

                const currentState = getRetryState();
                if (!currentState) break;

                const attemptState = {
                    ...currentState,
                    count: currentState.count + 1,
                    status: 'Tentative ' + (currentState.count + 1)
                };
                setRetryState(attemptState);
                syncRetryControls();

                try {
                    await sendAddToCartWithSku(attemptState.sku);
                    const successState = {
                        ...attemptState,
                        status: 'Tentative ' + attemptState.count + ' envoyée'
                    };
                    setRetryState(successState);
                    syncRetryControls();
                } catch (e) {
                    const nextState = {
                        ...attemptState,
                        status: (e && e.message) || 'Tentative échouée'
                    };
                    setRetryState(nextState);
                    syncRetryControls();
                }

                const latestState = getRetryState();
                if (!latestState) break;

                await wait(latestState.delayMs);

                if (getRetryState()) {
                    if (isRetryStopRequested()) {
                        setRetryStopRequested(false);
                        clearRetryState();
                        break;
                    }
                    if (!isCartPage()) {
                        window.location.href = 'https://www.cultura.com/checkout#panier';
                        state.retryLoopRunning = false;
                        return;
                    }
                    window.location.reload();
                    state.retryLoopRunning = false;
                    return;
                }
            }

            state.retryLoopRunning = false;
            syncRetryControls();
        }

        function goToCartAndRunRetry() {
            if (isCartPage()) {
                startRetryLoop();
                return;
            }

            window.location.href = 'https://www.cultura.com/checkout#panier';

            window.setTimeout(() => {
                if (getRetryState()) {
                    startRetryLoop();
                }
            }, 900);
        }

        function showModal() {
            createModalIfNeeded();
            applyResponsiveLayout();
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
            if (modalState.saveItemMessage) {
                modalState.saveItemMessage.textContent = '';
            }
            if (modalState.categoryInput) {
                modalState.categoryInput.value = catalogState.activeCategoryName || '';
            }
            if (modalState.retryDelayInput) {
                modalState.retryDelayInput.value = String(catalogState.retryDelayMs);
            }
            if (modalState.editorPanel && modalState.editorToggleButton) {
                modalState.editorPanel.style.display = catalogState.isEditorOpen ? 'flex' : 'none';
                modalState.editorToggleButton.textContent = catalogState.isEditorOpen ? 'Fermer' : '+ Ajouter';
                modalState.editorToggleButton.style.background = catalogState.isEditorOpen ? '#ffffff' : 'rgba(255,255,255,0.14)';
                modalState.editorToggleButton.style.color = catalogState.isEditorOpen ? '#0f4ea8' : '#ffffff';
            }
        }

        function hideModal() {
            if (modalState.overlay) {
                modalState.overlay.style.display = 'none';
            }
        }

        function applyResponsiveLayout() {
            if (!modalState.container || !modalState.container.firstChild) return;

            const isMobile = isMobileViewport();
            state.isMobileLayout = isMobile;

            const container = modalState.container;
            const header = container.firstChild;
            const body = header && header.nextSibling;
            if (!body) return;

            const colLeft = body.firstChild;
            const colRight = colLeft && colLeft.nextSibling;
            const formArea = colRight && colRight.lastChild;
            const actionsRow = formArea && formArea.children && formArea.children[2];
            const hint = actionsRow && actionsRow.firstChild;
            const actionsRight = actionsRow && actionsRow.lastChild;
            const prodHeader = colRight && colRight.children && colRight.children[1];
            const categoryToggleButton = modalState.categoryToggleButton;

            Object.assign(container.style, isMobile ? {
                width: 'calc(100vw - 24px)',
                maxHeight: 'calc(100vh - 24px)'
            } : {
                width: 'min(92vw, 760px)',
                maxHeight: '84vh'
            });

            Object.assign(header.style, isMobile ? {
                padding: '10px 12px'
            } : {
                padding: '12px 16px'
            });

            Object.assign(body.style, isMobile ? {
                flexDirection: 'column',
                gap: '12px',
                padding: '12px',
                overflow: 'auto'
            } : {
                flexDirection: 'row',
                gap: '16px',
                padding: '16px',
                overflow: 'hidden'
            });

            if (colLeft) {
                Object.assign(colLeft.style, isMobile ? {
                    display: catalogState.isCategoryPanelOpen ? 'flex' : 'none',
                    width: '100%',
                    minWidth: '0',
                    maxHeight: '180px'
                } : {
                    display: 'flex',
                    width: '250px',
                    minWidth: '250px',
                    maxHeight: ''
                });
            }

            if (colRight) {
                Object.assign(colRight.style, isMobile ? {
                    width: '100%',
                    minWidth: '0',
                    flex: 'unset',
                    overflow: 'visible'
                } : {
                    width: '',
                    minWidth: '',
                    flex: '1',
                    overflow: 'hidden'
                });
            }

            if (formArea) {
                Object.assign(formArea.style, isMobile ? {
                    padding: '12px'
                } : {
                    padding: '14px'
                });
            }

            if (actionsRow) {
                Object.assign(actionsRow.style, isMobile ? {
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: '10px'
                } : {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '8px'
                });
            }

            if (hint) {
                Object.assign(hint.style, isMobile ? {
                    width: '100%'
                } : {
                    width: ''
                });
            }

            if (actionsRight) {
                Object.assign(actionsRight.style, isMobile ? {
                    width: '100%',
                    justifyContent: 'flex-start'
                } : {
                    width: '',
                    justifyContent: 'flex-end'
                });
            }

            if (prodHeader) {
                Object.assign(prodHeader.style, isMobile ? {
                    flexWrap: 'wrap'
                } : {
                    flexWrap: 'nowrap'
                });
            }

            if (categoryToggleButton) {
                categoryToggleButton.style.display = isMobile ? 'inline-block' : 'none';
                categoryToggleButton.textContent = catalogState.isCategoryPanelOpen ? 'Masquer categories' : 'Categories';
            }
        }

        // =========================
        //   Bouton flottant principal
        // =========================
        function createButton() {
            const container = createFabContainerIfNeeded();
            if (document.getElementById('sku-injector-btn')) {
                syncRetryControls();
                return;
            }

            const btn = document.createElement('button');
            btn.id = 'sku-injector-btn';
            btn.textContent = 'SKU Injector';

            Object.assign(btn.style, {
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
                        "Ajoute d'abord un article au panier manuellement sur Cultura pour initialiser la session.<br><br>" +
                        "Une fois cet article ajouté, reclique sur <strong>SKU Injector</strong> pour utiliser l'ajout par SKU."
                    );
                    return;
                }

                showModal();
            });

            container.appendChild(btn);
            syncRetryControls();
        }

        function bootRetryIfNeeded() {
            const retryState = getRetryState();
            if (!retryState) {
                syncRetryControls();
                return;
            }

            syncRetryControls();
            goToCartAndRunRetry();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                createButton();
                bootRetryIfNeeded();
            });
        } else {
            createButton();
            bootRetryIfNeeded();
        }

        window.addEventListener('hashchange', () => {
            if (getRetryState()) {
                createButton();
                startRetryLoop();
            } else {
                createButton();
                syncRetryControls();
            }
        });

        window.addEventListener('resize', () => {
            applyResponsiveLayout();
            applyFabResponsiveLayout();
            syncRetryControls();
        });
    });
})();
