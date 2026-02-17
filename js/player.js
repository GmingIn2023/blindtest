// Fonctions spécifiques aux joueurs
function initPlayerGame() {
  const roomCode = AppState.roomCode;
  const clientId = AppState.clientId;
  if (!roomCode || !clientId) return;
  const roomRef = db.ref('rooms/' + roomCode);
  const gameStateRef = roomRef.child('gameState');
  const playersRef = roomRef.child('players');

  let gameSongs = [];
  let currentSongIndex = 0;
  let roundActive = false;
  let roundStartTime = 0;
  let scores = {};
  let playerAttempts = {};
  let buzzer = null;

  // Éléments DOM
  const playerSongInfo = document.getElementById('playerSongInfo');
  const playerTimer = document.getElementById('playerTimer');
  const playerScore = document.getElementById('playerScore');
  const playerAttemptsDiv = document.getElementById('playerAttempts');
  const cooldownDisplay = document.getElementById('cooldownDisplay');
  const playerBuzzer = document.getElementById('playerBuzzer');
  const playerFeedback = document.getElementById('playerFeedback');

  // Écouter gameState
  gameStateRef.on('value', (snap) => {
    const gs = snap.val() || {};
    gameSongs = gs.songs || [];
    currentSongIndex = gs.currentSongIndex || 0;
    roundActive = gs.roundActive || false;
    roundStartTime = gs.roundStartTime || 0;
    scores = gs.scores || {};
    playerAttempts = gs.playerAttempts || {};
    buzzer = gs.buzzer;

    updateUI();
  });

  function updateUI() {
    // Infos chanson
    if (gameSongs[currentSongIndex]) {
      playerSongInfo.textContent = `Chanson ${currentSongIndex+1} / ${gameSongs.length}`;
    }
    // Score
    playerScore.textContent = (scores[clientId] || 0) + ' pts';

    // Essais
    const attempts = playerAttempts[clientId] || { attemptsLeft: 3, cooldownUntil: 0 };
    playerAttemptsDiv.textContent = `Essais restants: ${attempts.attemptsLeft === 0 ? '0' : attempts.attemptsLeft}`;

    // Cooldown
    const now = Date.now();
    if (attempts.cooldownUntil && now < attempts.cooldownUntil) {
      const sec = Math.ceil((attempts.cooldownUntil - now)/1000);
      cooldownDisplay.textContent = `⏳ Cooldown: ${sec}s`;
      playerBuzzer.disabled = true;
    } else {
      cooldownDisplay.textContent = '';
      // Gérer activation du buzzer
      if (buzzer) {
        playerBuzzer.disabled = true;
        playerFeedback.textContent = '⏳ Quelqu\'un a buzzé...';
      } else if (attempts.attemptsLeft === 0) {
        playerBuzzer.disabled = true;
        playerFeedback.textContent = '❌ Plus d\'essais';
      } else {
        playerBuzzer.disabled = false;
        playerFeedback.textContent = '';
      }
    }
  }

  playerBuzzer.addEventListener('click', () => {
    if (playerBuzzer.disabled) return;
    gameStateRef.update({ buzzer: clientId });
  });

  // Gestion des popups (simplifiée, à développer)
  // ...
}
