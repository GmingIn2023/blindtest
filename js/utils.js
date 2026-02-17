// Utilitaires communs

// Générer un code de partie aléatoire (6 caractères)
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Normaliser une chaîne pour la tolérance (enlève accents, caractères spéciaux, met en minuscules)
function normalize(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
