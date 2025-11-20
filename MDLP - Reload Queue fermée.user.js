// ==UserScript==
// @name         MDLP - Reload Queue fermée TEST
// @namespace    Reload Queue fermée
// @version      0.1
// @description  Si la page affiche "Cette file d'attente est maintenant fermée.", fait un F5 périodique. Sinon ne fait rien.
// @match        https://maisondelapresse.queue-fair.net/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/MDLP%20-%20Reload%20Queue%20ferm%C3%A9e.user.js
// @downloadURL  https://github.com/Groshaq/GroshaqScript/raw/refs/heads/main/MDLP%20-%20Reload%20Queue%20ferm%C3%A9e.user.js
// ==/UserScript==

// Empeche l'onglet de se mettre en inactif
const keepAlive = document.createElement("audio");
keepAlive.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="; // son vide
keepAlive.loop = true;
keepAlive.volume = 0;
keepAlive.play().catch(() => {});



(function () {
  'use strict';

  // === CONFIG ===
  // Texte exact à détecter (ne pas modifier si tu veux la correspondance précise)
  const CLOSED_TEXT = "Cette file d'attente est maintenant fermée.";
  // Intervalle entre reloads en millisecondes quand on détecte le message.
  // Ajuste ici si tu veux plus ou moins fréquent. Par défaut 500 ms.
  const RELOAD_INTERVAL_MS = 10;

  // === LOGIQUE SIMPLE ===

  // Retourne true si le texte apparaît quelque part dans le body
  function pageIndiqueFermee() {
    const body = document.body && document.body.innerText ? document.body.innerText : "";
    return body.includes(CLOSED_TEXT);
  }

  // Si le message est présent au chargement => on déclenche un reload périodique
  if (pageIndiqueFermee()) {
    console.log('[MDP Simple] Message détecté — démarrage reload toutes les', RELOAD_INTERVAL_MS, 'ms');
    const id = setInterval(() => {
      // Avant de reload, on vérifie à nouveau : si le message a disparu, on arrête
      if (!pageIndiqueFermee()) {
        console.log('[MDP Simple] Message disparu — arrêt des reloads.');
        clearInterval(id);
        return;
      }
      console.log('[MDP Simple] Reload (F5).');
      try { location.reload(); } catch (e) { console.error(e); }
    }, RELOAD_INTERVAL_MS);
  } else {
    // Si le message n'est pas présent au chargement, on ne fait rien.
    console.log('[MDP Simple] Message absent au chargement — pas de reload.');
  }

})();
