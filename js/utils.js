// Utilitaires communs

// Générer un code de partie aléatoire (6 caractères, sans caractères ambigus comme 0/O ou 1/I)
function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = new Uint32Array(6);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 4294967296);
  for (let i = 0; i < 6; i++) code += alphabet[buf[i] % alphabet.length];
  return code;
}

// Normaliser une chaîne pour la tolérance : enlève accents, ponctuation et casse.
// Fonctionne pour TOUS les alphabets (latin, cyrillique, japonais, arabe…), pas seulement a-z.
function normalize(str) {
  if (!str) return '';
  const s = String(str).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  try { return s.replace(/[^\p{L}\p{N}]/gu, ""); }
  catch (e) { return s.replace(/[^a-z0-9]/g, ""); }
}

// Formater le timer (millisecondes -> MM:SS.d)
function formatTimer(ms) {
  if (ms < 0) ms = 0;
  let seconds = Math.floor(ms / 1000);
  let tenth = Math.floor((ms % 1000) / 100);
  let minutes = Math.floor(seconds / 60);
  seconds = seconds % 60;
  return `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}.${tenth}`;
}

// Mélanger un tableau (Fisher-Yates)
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Exporter les fonctions
window.generateRoomCode = generateRoomCode;
window.normalize = normalize;
window.formatTimer = formatTimer;
window.shuffleArray = shuffleArray;

// Échappement HTML (partagé par toutes les pages)
function escapeHTML(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Horloge synchronisée sur Firebase (évite les écarts entre appareils)
let _srvOff=0;
if(window.db){db.ref('.info/serverTimeOffset').on('value',s=>{_srvOff=s.val()||0;});}
function serverNow(){return Date.now()+_srvOff;}
window.escapeHTML=escapeHTML;window.serverNow=serverNow;

// Nettoie un code de partie saisi par l'utilisateur (Firebase refuse . $ # [ ] / dans les chemins)
function cleanRoomCode(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);}
window.cleanRoomCode=cleanRoomCode;
