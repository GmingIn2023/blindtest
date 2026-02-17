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
  let mode = 'normal';

  // Éléments DOM
  const playerSongInfo = document.getElementById('playerSongInfo');
  const playerTimer = document.getElementById('playerTimer');
  const playerScore = document.getElementById('playerScore');
  const playerAttemptsDiv = document.getElementById('playerAttempts');
  const cooldownDisplay = document.getElementById('cooldownDisplay');
  const playerBuzzer = document.getElementById('playerBuzzer');
  const playerFeedback = document.getElementById('playerFeedback');

  // Éléments des popups
  const popupAnswer = document.getElementById('popupAnswer');
  const popupChoice = document.getElementById('popupChoice');
  const popupResult = document.getElementById('popupResult');
  const answerInput = document.getElementById('answerInput');
  const submitAnswer = document.getElementById('submitAnswer');
  const answerTimerSpan = document.getElementById('answerTimer');
  const choiceGrid = document.getElementById('choiceGrid');
  const choiceTimerSpan = document.getElementById('choiceTimer');
  const resultTitle = document.getElementById('resultTitle');
  const resultMessage = document.getElementById('resultMessage');

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
    mode = gs.mode || 'normal'; // à stocker dans config

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
    playerAttemptsDiv.textContent = `Essais restants: ${attempts.attemptsLeft}`;

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

  // Gestion des popups
  // Quand le buzzer correspond à ce joueur, on affiche la popup appropriée
  gameStateRef.child('buzzer').on('value', (snap) => {
    const buzzerId = snap.val();
    if (buzzerId === clientId) {
      // Afficher la popup selon le mode
      if (mode === 'kahoot') {
        showChoicePopup();
      } else {
        showAnswerPopup();
      }
    }
  });

  // Fonction pour la popup de réponse écrite
  let answerTimer = null;
  function showAnswerPopup() {
    popupAnswer.classList.remove('hidden');
    answerInput.value = '';
    answerInput.focus();
    let timeLeft = 10;
    answerTimerSpan.textContent = timeLeft;
    if (answerTimer) clearInterval(answerTimer);
    answerTimer = setInterval(() => {
      timeLeft--;
      answerTimerSpan.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(answerTimer);
        submitAnswer('');
      }
    }, 1000);
  }

  submitAnswer.addEventListener('click', () => {
    const ans = answerInput.value.trim();
    submitAnswer(ans);
  });

  async function submitAnswer(answer) {
    if (answerTimer) clearInterval(answerTimer);
    popupAnswer.classList.add('hidden');
    const song = gameSongs[currentSongIndex];
    const correct = song.title;
    const normAnswer = normalize(answer);
    const normCorrect = normalize(correct);
    const isCorrect = normAnswer === normCorrect || normCorrect.includes(normAnswer) || normAnswer.includes(normCorrect);
    const elapsed = roundActive ? Date.now() - roundStartTime : 0;
    let points = 0;
    if (isCorrect) {
      if (mode === 'kahoot') {
        const seconds = elapsed / 1000;
        points = Math.max(20, 100 - Math.floor(seconds * 10));
      } else {
        points = 50;
      }
    } else {
      points = -50;
    }
    await sendResult(points, isCorrect, correct);
  }

  // Popup choix multiple
  let choiceTimer = null;
  function showChoicePopup() {
    const currentSong = gameSongs[currentSongIndex];
    // Générer 4 propositions (dont la bonne)
    // Pour simplifier, on prend une liste fictive
    // Idéalement, on devrait utiliser une liste de chansons, mais on peut improviser
    const fakeSongs = [
      { title: 'Billie Jean' },
      { title: 'Shape of You' },
      { title: 'Uptown Funk' },
      { title: 'Blinding Lights' },
      { title: 'Despacito' },
      { title: 'Rolling in the Deep' }
    ];
    let others = fakeSongs.filter(s => s.title !== currentSong.title);
    while (others.length < 3) others = others.concat(fakeSongs);
    shuffleArray(others);
    const choices = [currentSong, ...others.slice(0, 3)];
    shuffleArray(choices);
    choiceGrid.innerHTML = '';
    choices.forEach(song => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = song.title;
      btn.onclick = () => handleChoice(song, currentSong);
      choiceGrid.appendChild(btn);
    });
    popupChoice.classList.remove('hidden');
    let timeLeft = 5;
    choiceTimerSpan.textContent = timeLeft;
    if (choiceTimer) clearInterval(choiceTimer);
    choiceTimer = setInterval(() => {
      timeLeft--;
      choiceTimerSpan.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(choiceTimer);
        handleChoice(null, currentSong);
      }
    }, 1000);
  }

  async function handleChoice(selected, correct) {
    if (choiceTimer) clearInterval(choiceTimer);
    popupChoice.classList.add('hidden');
    const isCorrect = selected && selected.title === correct.title;
    const elapsed = roundActive ? Date.now() - roundStartTime : 0;
    let points = 0;
    if (isCorrect) {
      const seconds = elapsed / 1000;
      points = Math.max(20, 100 - Math.floor(seconds * 10));
    } else {
      points = -50;
    }
    await sendResult(points, isCorrect, correct.title);
  }

  // Fonction commune pour envoyer le résultat
  async function sendResult(points, success, correctTitle) {
    const scores = { ...scores };
    scores[clientId] = (scores[clientId] || 0) + points;

    // Mise à jour des tentatives
    let attemptsData = playerAttempts[clientId] || { attemptsLeft: 3, cooldownUntil: 0, attemptCount: 0 };
    if (!success) {
      attemptsData.attemptsLeft = Math.max(0, attemptsData.attemptsLeft - 1);
      attemptsData.attemptCount = (attemptsData.attemptCount || 0) + 1;
      const cooldown = 3000 + (attemptsData.attemptCount - 1) * 2000;
      attemptsData.cooldownUntil = Date.now() + cooldown;
    } else {
      attemptsData.attemptsLeft = 0;
      attemptsData.cooldownUntil = 0;
    }

    await gameStateRef.update({
      scores: scores,
      playerAttempts: { ...playerAttempts, [clientId]: attemptsData },
      answerResult: { playerId: clientId, correct: success, points, correctTitle },
      buzzer: null
    });

    // Afficher popup résultat
    resultTitle.textContent = success ? '🎉 Bravo !' : '❌ Faux !';
    resultMessage.textContent = success ? `+${points} points` : `-50 points (c'était ${correctTitle})`;
    popupResult.classList.remove('hidden');
    setTimeout(() => popupResult.classList.add('hidden'), 2000);
  }
}
