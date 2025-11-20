// ==UserScript==
// @name         MDLP - anti-déconnexion
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Auto login + keep-alive sur la page Stitch Noël, avec panneau d’état et logs debug.
// @match        https://www.maisondelapresse.com/mini-figurine-stitch-edition-noel.html
// @run-at       document-end
// @grant        none
// @updateURL    https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/MDLP%20-%20AntiDeco.user.js
// @downloadURL  https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/MDLP%20-%20AntiDeco.user.js
// ==/UserScript==

(function() {
    'use strict';

    /************************************
     * ⚙️ CONFIG UTILISATEUR
     ************************************/

    const AUTO_LOGIN_ENABLED = true;

    // ⚠️ Mets ton email + mot de passe ici
    const USER_EMAIL = "VOTRE MAIL";
    const USER_PASSWORD = "VOTRE MOT DE PASSE";

    // Ne pas changer ça au début, on stabilise
    const PING_INTERVAL_MINUTES = 1;
    const PING_INTERVAL_MS = PING_INTERVAL_MINUTES * 60 * 1000;

    const KEEP_ALIVE_URL = "https://www.maisondelapresse.com/customer/section/load/?sections=messages&force_new_section_timestamp=true";

    /************************************
     * 🧱 GESTION DE LA PAGE CIBLE
     ************************************/

    function isTargetPage() {
        // On ne fait quelque chose que si l’URL contient bien le slug du produit
        return location.pathname.indexOf("mini-figurine-stitch-edition-noel") !== -1;
    }

    if (!isTargetPage()) {
        // On ne fait rien sur les autres pages
        console.debug("[MDP Script] Pas la page Stitch, script inactif sur cette URL :", location.href);
        return;
    }

    console.debug("[MDP Script] Script chargé sur la page Stitch :", location.href);

    /************************************
     * 🧱 Panneau d’état en bas à droite
     ************************************/

    let statusPanel = null;
    let statusList = null;
    let statusStateSpan = null;
    const MAX_LOG_LINES = 15;

    function createStatusPanel() {
        if (statusPanel) return;

        statusPanel = document.createElement('div');
        statusPanel.id = "mdp-keepalive-panel";
        statusPanel.style.position = "fixed";
        statusPanel.style.bottom = "10px";
        statusPanel.style.right = "10px";
        statusPanel.style.zIndex = "999999";
        statusPanel.style.background = "rgba(0,0,0,0.85)";
        statusPanel.style.color = "#fff";
        statusPanel.style.fontSize = "12px";
        statusPanel.style.fontFamily = "sans-serif";
        statusPanel.style.padding = "8px 10px";
        statusPanel.style.borderRadius = "6px";
        statusPanel.style.maxWidth = "280px";
        statusPanel.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";

        const title = document.createElement('div');
        title.textContent = "⚙️ Script MDP (Stitch)";
        title.style.fontWeight = "bold";
        title.style.marginBottom = "4px";

        const stateLine = document.createElement('div');
        stateLine.style.marginBottom = "4px";
        stateLine.innerHTML = 'État : <span id="mdp-keepalive-state">initialisation…</span>';
        statusStateSpan = stateLine.querySelector('#mdp-keepalive-state');

        const logContainer = document.createElement('div');
        logContainer.style.maxHeight = "180px";
        logContainer.style.overflowY = "auto";
        logContainer.style.borderTop = "1px solid rgba(255,255,255,0.2)";
        logContainer.style.paddingTop = "4px";
        logContainer.style.marginTop = "4px";

        statusList = document.createElement('ul');
        statusList.style.listStyle = "none";
        statusList.style.padding = "0";
        statusList.style.margin = "0";

        logContainer.appendChild(statusList);

        statusPanel.appendChild(title);
        statusPanel.appendChild(stateLine);
        statusPanel.appendChild(logContainer);

        document.body.appendChild(statusPanel);

        console.debug("[MDP Script] Panneau d’état créé.");
    }

    function setState(text) {
        if (!statusPanel) createStatusPanel();
        if (statusStateSpan) {
            statusStateSpan.textContent = text;
        }
    }

    function logStatus(message) {
        if (!statusPanel) createStatusPanel();

        const li = document.createElement('li');
        const now = new Date();
        const timeStr = now.toLocaleTimeString('fr-FR', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        li.textContent = "[" + timeStr + "] " + message;
        statusList.appendChild(li);

        while (statusList.children.length > MAX_LOG_LINES) {
            statusList.removeChild(statusList.firstChild);
        }

        statusList.parentElement.scrollTop = statusList.parentElement.scrollHeight;
        console.debug("[MDP Script]", message);
    }

    /************************************
     * 🔍 Détection de connexion
     ************************************/

    function isUserLoggedIn() {
        // Lien de déconnexion typique Magento
        const logoutLink = document.querySelector('a[href*="/customer/account/logout"]');
        return !!logoutLink;
    }

    /************************************
     * 🔁 Keep-alive
     ************************************/

    function sendKeepAlive() {
        if (!isUserLoggedIn()) {
            setState("non connecté");
            logStatus("Pas de ping : utilisateur non connecté.");
            return;
        }

        setState("connecté (ping en cours…)");
        logStatus("Ping session vers le serveur…");

        fetch(KEEP_ALIVE_URL, {
            method: "GET",
            credentials: "include",
            cache: "no-cache"
        })
        .then(function(response) {
            logStatus("Réponse du ping : HTTP " + response.status);
            if (response.status === 401 || response.status === 403) {
                setState("session expirée");
                logStatus("Session probablement expirée (401/403).");
            } else {
                setState("connecté (session maintenue)");
            }
        })
        .catch(function(err) {
            logStatus("Erreur pendant le ping : " + err);
        });
    }

    function startKeepAliveLoop() {
    // Premier ping 15s après le chargement
    setTimeout(sendKeepAlive, 15000);

    // Ensuite ping régulier, même si l’onglet n’est pas visible
    setInterval(function() {
        sendKeepAlive();
    }, PING_INTERVAL_MS);
}


    /************************************
     * 🔐 Connexion automatique
     ************************************/

    var loginInProgress = false;

    function tryClickLoginLinkIfExists() {
        var selectors = [
            '.authorization-link a',
            'a[href*="/customer/account/login"]',
            'a[href*="customer/account/login"]',
            'button[data-action*="login"]',
            'a[title*="Connexion"]',
            'a[title*="Mon compte"]'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var sel = selectors[i];
            var el = document.querySelector(sel);
            if (el) {
                logStatus("Lien/bouton de connexion trouvé (" + sel + "), clic automatique…");
                el.click();
                return true;
            }
        }
        logStatus("Lien de connexion introuvable. Clique toi-même sur Connexion/Mon compte, je surveille le formulaire.");
        return false;
    }

    function fillAndSubmitLoginForm() {
        var possibleForms = document.querySelectorAll(
            'form[action*="customer/account/login"], ' +
            'form[action*="customer/account/loginPost"], ' +
            'form[id*="login"], form[class*="login"]'
        );
        var loginForm = null;
        for (var i = 0; i < possibleForms.length; i++) {
            var f = possibleForms[i];
            if (f.querySelector('input[type="email"], input[name*="login[username]"], input[name*="email"]')) {
                loginForm = f;
                break;
            }
        }

        if (!loginForm) {
            return false;
        }

        var emailInput =
            loginForm.querySelector('input[type="email"], input[name*="login[username]"], input[name*="email"]');
        var passwordInput =
            loginForm.querySelector('input[type="password"], input[name*="login[password]"], input[name*="password"]');
        var submitButton =
            loginForm.querySelector('button[type="submit"], button.action.login, button[class*="login"]');

        if (!emailInput || !passwordInput || !submitButton) {
            logStatus("Formulaire trouvé mais champs email/mot de passe/bouton manquants.");
            return false;
        }

        emailInput.focus();
        emailInput.value = USER_EMAIL;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));

        passwordInput.focus();
        passwordInput.value = USER_PASSWORD;
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

        logStatus("Champs email & mot de passe remplis, envoi du formulaire…");
        submitButton.click();
        return true;
    }

    function tryAutoLogin() {
        if (!AUTO_LOGIN_ENABLED) {
            logStatus("Connexion automatique désactivée.");
            return;
        }
        if (loginInProgress) return;

        if (isUserLoggedIn()) {
            setState("connecté");
            logStatus("Déjà connecté, pas besoin de login automatique.");
            return;
        }

        loginInProgress = true;
        setState("connexion en cours…");
        logStatus("Utilisateur non connecté, tentative de connexion automatique…");

        tryClickLoginLinkIfExists();

        var startTime = Date.now();
        var timeoutMs = 20000;
        var intervalMs = 500;

        var intervalId = setInterval(function() {
            if (isUserLoggedIn()) {
                clearInterval(intervalId);
                loginInProgress = false;
                setState("connecté");
                logStatus("Connexion déjà établie pendant l’attente.");
                return;
            }

            var ok = fillAndSubmitLoginForm();
            if (ok) {
                logStatus("Formulaire soumis, attente de la connexion…");
                clearInterval(intervalId);

                setTimeout(function() {
                    if (isUserLoggedIn()) {
                        setState("connecté");
                        logStatus("Connexion automatique réussie ✅");
                    } else {
                        setState("non connecté");
                        logStatus("Connexion automatique : toujours non connecté après soumission.");
                    }
                    loginInProgress = false;
                }, 5000);
            } else {
                var elapsed = Date.now() - startTime;
                if (elapsed > timeoutMs) {
                    clearInterval(intervalId);
                    loginInProgress = false;
                    setState("non connecté");
                    logStatus("Timeout : formulaire de login introuvable. Clique sur Connexion et je remplirai si je vois le formulaire.");
                } else {
                    logStatus("Formulaire de login pas encore détecté, nouvelle tentative dans 0,5 s…");
                }
            }
        }, intervalMs);
    }

    /************************************
     * 🚀 Initialisation
     ************************************/

    function init() {
        try {
            createStatusPanel();
            logStatus("Script initialisé sur la page Stitch.");
            if (isUserLoggedIn()) {
                setState("connecté");
                logStatus("Page chargée : utilisateur déjà connecté.");
            } else {
                setState("non connecté");
                logStatus("Page chargée : utilisateur non connecté.");
                tryAutoLogin();
            }

            startKeepAliveLoop();

            setInterval(function() {
                if (isUserLoggedIn()) {
                    setState("connecté");
                } else {
                    setState("non connecté");
                    if (!loginInProgress) {
                        logStatus("Déconnexion détectée, nouvelle tentative de connexion automatique…");
                        tryAutoLogin();
                    }
                }
            }, 30000);
        } catch (e) {
            console.error("[MDP Script] ERREUR INIT :", e);
            alert("Erreur dans le script MDP (voir console) : " + e);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
