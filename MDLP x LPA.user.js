// ==UserScript==
// @name         MDLP x LPA
// @namespace    https://example.com/
// @version      1.4
// @description  Ouvre un onglet si "MAISONDELAPRESSE" est détecté dans un message Discord récent (±3 minutes). Une seule ouverture par chargement de page, avec refresh auto.
// @author       Vous
// @match        https://discord.com/channels*
// @grant        GM_openInTab
// @run-at       document-end
// ==/UserScript==
(function () {
    'use strict';

    const TARGET_WORD = "MAISONDELAPRESSE";
    const TARGET_URL = "https://www.maisondelapresse.com/customer/account/";
    let alreadyOpened = false;

    // Récupère l'heure HH:MM la plus proche dans le sous-arbre d'un noeud donné (le message)
    function getPostTimeFromNode(node) {
        if (!node) return null;

        // On remonte un peu dans le DOM pour se rapprocher du conteneur du message
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let depth = 0;
        while (current && depth < 6) {
            // Heuristique : conteneur de message Discord
            if (
                (current.getAttribute && current.getAttribute("role") === "article") ||
                (current.getAttribute && current.getAttribute("data-list-item-id"))
            ) {
                break;
            }
            current = current.parentElement;
            depth++;
        }
        if (!current) {
            current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        }

        const timeRegex = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
        let lastMatch = null;

        const walker = document.createTreeWalker(current, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            const text = walker.currentNode.textContent;
            if (!text) continue;

            let match;
            while ((match = timeRegex.exec(text)) !== null) {
                lastMatch = match;
            }
        }

        if (!lastMatch) {
            console.warn("[UserScript] Aucune heure de post trouvée autour du message.");
            return null;
        }

        const hours = parseInt(lastMatch[1], 10);
        const minutes = parseInt(lastMatch[2], 10);

        const now = new Date();
        const postTime = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            hours,
            minutes,
            0,
            0
        );

        console.log("[UserScript] Heure trouvée pour le message :", postTime.toTimeString());
        return postTime;
    }

    function isPostTimeCloseToNowFromNode(node, maxDiffMinutes = 1) {
        const postTime = getPostTimeFromNode(node);
        if (!postTime) {
            console.warn("[UserScript] Pas d'heure détectée pour ce message -> blocage de l'ouverture.");
            return false;
        }

        const now = new Date();
        const diffMs = Math.abs(now.getTime() - postTime.getTime());
        const diffMinutes = diffMs / 60000;

        console.log("[UserScript] Différence d'heure (min) pour ce message :", diffMinutes.toFixed(2));
        return diffMinutes <= maxDiffMinutes;
    }

    // Cherche le mot cible et renvoie le noeud texte qui le contient (ou null)
    function checkForTargetWord(root) {
        if (!root) return null;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            const text = walker.currentNode.textContent;
            if (text && text.includes(TARGET_WORD)) {
                console.log(`[UserScript] Mot détecté (scan) : ${text}`);
                return walker.currentNode; // noeud texte contenant le mot
            }
        }
        return null;
    }

    // Affiche un bandeau avec compte à rebours avant refresh
    function showOverlayMessage(countdownSeconds) {
        // Supprimer un éventuel ancien bandeau
        const old = document.getElementById('mdlp-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = "mdlp-overlay";
        overlay.style.position = 'fixed';
        overlay.style.top = '20px';
        overlay.style.right = '20px';
        overlay.style.padding = '10px 15px';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.color = '#fff';
        overlay.style.fontSize = '14px';
        overlay.style.zIndex = '999999';
        overlay.style.borderRadius = '6px';
        overlay.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.4)';
        overlay.style.fontFamily = 'sans-serif';

        const textSpan = document.createElement('span');
        textSpan.textContent = "Onglet Maison de la Presse Ouvert, Refresh du script dans ";

        const countdownSpan = document.createElement('span');
        countdownSpan.id = "mdlp-countdown";
        countdownSpan.textContent = countdownSeconds + "s";

        overlay.appendChild(textSpan);
        overlay.appendChild(countdownSpan);

        document.body.appendChild(overlay);
    }

    function openTabOnce(matchNode) {
        if (alreadyOpened) return;

        // Vérifie l'écart d'heure à partir du message contenant le mot clé
        if (!isPostTimeCloseToNowFromNode(matchNode, 3)) {
            console.log("[UserScript] Heure du message MAISONDELAPRESSE trop éloignée de l'heure PC -> onglet NON ouvert.");
            return;
        }

        alreadyOpened = true;

        try {
            console.log(`[UserScript] Ouverture de l'onglet : ${TARGET_URL}`);
            GM_openInTab(TARGET_URL, { active: true, insert: true });

            const totalSeconds = 61;
            showOverlayMessage(totalSeconds);

            // Gestion du compte à rebours visuel
            let remaining = totalSeconds;
            const countdownSpan = document.getElementById('mdlp-countdown');

            const countdownInterval = setInterval(() => {
                remaining--;
                if (remaining < 0) {
                    clearInterval(countdownInterval);
                    return;
                }
                if (countdownSpan) {
                    countdownSpan.textContent = remaining + "s";
                }
            }, 1000);

            // Refresh de la page après 61 secondes
            console.log("[UserScript] Refresh automatique dans 61 secondes...");
            setTimeout(() => {
                location.reload();
            }, totalSeconds * 1000);

        } catch (error) {
            console.error("[UserScript] Erreur lors de l'ouverture de l'onglet :", error);
        }
    }

    // Observer des nouveaux messages
    const observer = new MutationObserver((mutations) => {
        if (alreadyOpened) return;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (alreadyOpened) return;

                if (node.nodeType === Node.TEXT_NODE && node.textContent.includes(TARGET_WORD)) {
                    console.log(`[UserScript] Mot détecté (observer texte): ${node.textContent}`);
                    openTabOnce(node);
                    return;
                }

                if (node.nodeType === Node.ELEMENT_NODE) {
                    const matchNode = checkForTargetWord(node);
                    if (matchNode) {
                        openTabOnce(matchNode);
                        return;
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Scan périodique du DOM au cas où l'observer raterait quelque chose
    const intervalId = setInterval(() => {
        if (alreadyOpened) {
            clearInterval(intervalId);
            return;
        }

        const matchNode = checkForTargetWord(document.body);
        if (matchNode) {
            openTabOnce(matchNode);
        }
    }, 50); // Intervalle de check en ms

    console.log("[UserScript] Surveillance DOM + intervalle de détection activés.");
})();
