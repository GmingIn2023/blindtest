// Gestion de l'état local avec sessionStorage

const STATE_KEYS = {
  ROOM_CODE: 'blindtest_roomCode',
  CLIENT_ID: 'blindtest_clientId',
  IS_HOST: 'blindtest_isHost',
  PLAYER_NAME: 'blindtest_playerName',
  PLAYER_AVATAR: 'blindtest_playerAvatar',
};

function saveState(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function loadState(key, defaultValue = null) {
  const val = sessionStorage.getItem(key);
  return val ? JSON.parse(val) : defaultValue;
}

function clearState() {
  sessionStorage.clear();
}

// Objet d'état accessible globalement
const AppState = {
  get roomCode() { return loadState(STATE_KEYS.ROOM_CODE); },
  set roomCode(value) { saveState(STATE_KEYS.ROOM_CODE, value); },

  get clientId() { return loadState(STATE_KEYS.CLIENT_ID); },
  set clientId(value) { saveState(STATE_KEYS.CLIENT_ID, value); },

  get isHost() { return loadState(STATE_KEYS.IS_HOST, false); },
  set isHost(value) { saveState(STATE_KEYS.IS_HOST, value); },

  get playerName() { return loadState(STATE_KEYS.PLAYER_NAME, ''); },
  set playerName(value) { saveState(STATE_KEYS.PLAYER_NAME, value); },

  get playerAvatar() { return loadState(STATE_KEYS.PLAYER_AVATAR, '🐶'); },
  set playerAvatar(value) { saveState(STATE_KEYS.PLAYER_AVATAR, value); },

  clear() { clearState(); }
};

window.AppState = AppState;
