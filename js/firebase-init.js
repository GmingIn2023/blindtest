// Configuration Firebase (config publique : OK côté client)
const firebaseConfig = {
  apiKey: "AIzaSyBOEU9kg6YuXllGEGS9iod_SsBRu9NOPro",
  authDomain: "blind-test-kahoot.firebaseapp.com",
  databaseURL: "https://blind-test-kahoot-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "blind-test-kahoot",
  storageBucket: "blind-test-kahoot.firebasestorage.app",
  messagingSenderId: "798773649205",
  appId: "1:798773649205:web:de5dd5cbce41ea2ec5b67c"
};

// Petit bandeau d'état (erreur de chargement / connexion perdue). Aucun style de page n'est modifié.
function _showNetBanner(text, id) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement('div');
    b.id = id;
    b.style.cssText = 'position:fixed;left:50%;top:.6rem;transform:translateX(-50%);z-index:5000;max-width:92vw;' +
      'background:#5a1e1e;border:1px solid #ff6b6b;color:#fff;padding:.5rem 1rem;border-radius:60px;' +
      'font:600 .85rem -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.6)';
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = text;
}
function _hideNetBanner(id) { const b = document.getElementById(id); if (b) b.remove(); }

if (typeof firebase === 'undefined') {
  // SDK bloqué (hors-ligne, bloqueur de contenu…) : on le dit clairement au lieu d'une page blanche
  const warn = () => _showNetBanner('⚠️ Impossible de charger le service de jeu. Vérifie ta connexion puis recharge la page.', 'netFatal');
  if (document.body) warn(); else document.addEventListener('DOMContentLoaded', warn);
} else {
  // Initialiser Firebase (une seule fois même si le script est inclus deux fois)
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  var db = firebase.database();

  // Exporter db pour l'utiliser dans les autres scripts
  window.db = db;

  // Bandeau "reconnexion" si la connexion reste coupée plus de 4 secondes
  let _offTimer = null;
  db.ref('.info/connected').on('value', s => {
    if (s.val() === true) {
      clearTimeout(_offTimer); _offTimer = null;
      _hideNetBanner('netLost');
    } else if (!_offTimer) {
      _offTimer = setTimeout(() => {
        _offTimer = null;
        _showNetBanner('📡 Connexion perdue… reconnexion en cours', 'netLost');
      }, 4000);
    }
  });
}
