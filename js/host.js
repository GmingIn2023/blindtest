// Fonctions spécifiques à l'hôte
function initHostGame() {
  const roomCode = AppState.roomCode;
  if (!roomCode) return;
  const roomRef = db.ref('rooms/' + roomCode);
  const gameStateRef = roomRef.child('gameState');
  const playersRef = roomRef.child('players');

  let gameSongs = [];
  let gameScores = {};
  let currentSongIndex = 0;
  let roundActive = false;
  let roundStartTime = 0;

  // Éléments DOM
  const hostSongCounter = document.getElementById('hostSongCounter');
  const hostTimer = document.getElementById('hostTimer');
  const hostNotification = document.getElementById('hostNotification');
  const hostScoreboard = document.getElementById('hostScoreboard');
  const hostNext = document.getElementById('hostNext');
  const hostPlay = document.getElementById('hostPlay');
  const hostReveal = document.getElementById('hostReveal');

  // Écouter les changements du gameState
  gameStateRef.on('value', (snap) => {
    const gs = snap.val() || {};
    gameSongs = gs.songs || [];
    gameScores = gs.scores || {};
    currentSongIndex = gs.currentSongIndex || 0;
    roundActive = gs.roundActive || false;
    roundStartTime = gs.roundStartTime || 0;

    if (gameSongs.length > 0) {
      hostSongCounter.textContent = `Chanson ${currentSongIndex+1} / ${gameSongs.length}`;
    }
    updateHostScoreboard();
    hostNext.disabled = roundActive; // On peut passer à la suivante seulement quand le round est fini
  });

  // Timer
  setInterval(() => {
    if (roundActive && roundStartTime > 0) {
      const elapsed = Date.now() - roundStartTime;
      hostTimer.textContent = formatTimer(elapsed);
    }
  }, 100);

  function updateHostScoreboard() {
    playersRef.once('value', (snap) => {
      const players = snap.val() || {};
      let html = '<strong>Scores:</strong><br>';
      Object.entries(players).forEach(([id, p]) => {
        html += `<div>${p.avatar} ${p.name}: ${gameScores[id] || 0} pts</div>`;
      });
      hostScoreboard.innerHTML = html;
    });
  }

  hostPlay.addEventListener('click', () => {
    if (roundActive) return;
    const startTime = Date.now();
    gameStateRef.update({
      roundStartTime: startTime,
      roundActive: true,
      buzzer: null
    });
  });

  hostNext.addEventListener('click', () => {
    if (currentSongIndex + 1 < gameSongs.length) {
      gameStateRef.update({
        currentSongIndex: currentSongIndex + 1,
        roundActive: false,
        buzzer: null
      });
    } else {
      alert('Fin du jeu !');
      // Rediriger vers le podium (à faire)
    }
  });

  hostReveal.addEventListener('click', () => {
    // Afficher la réponse (à implémenter selon le mode)
    // Pour l'instant, on peut afficher un message
    alert('Réponse révélée (à implémenter)');
  });

  // Écouter les résultats des joueurs
  gameStateRef.child('answerResult').on('value', (snap) => {
    const res = snap.val();
    if (res) {
      playersRef.child(res.playerId).once('value', (pSnap) => {
        const player = pSnap.val();
        if (player) {
          hostNotification.textContent = `${player.name}: ${res.correct ? '✅' : '❌'} ${res.points} pts`;
          setTimeout(() => hostNotification.textContent = '', 3000);
        }
      });
      snap.ref.remove(); // nettoyer
    }
  });
}
