// Gestion de l'état local avec sessionStorage
// (robuste : si le stockage est indisponible ou corrompu — navigation privée, quota — on garde l'état en mémoire)

const STATE_KEYS = {
  ROOM_CODE: 'blindtest_roomCode',
  CLIENT_ID: 'blindtest_clientId',
  IS_HOST: 'blindtest_isHost',
  PLAYER_NAME: 'blindtest_playerName',
  PLAYER_AVATAR: 'blindtest_playerAvatar',
};

const _memState = {};

function saveState(key, value) {
  _memState[key] = value;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function loadState(key, defaultValue = null) {
  try {
    const val = sessionStorage.getItem(key);
    if (val !== null && val !== undefined) return JSON.parse(val);
  } catch (e) {}
  return Object.prototype.hasOwnProperty.call(_memState, key) ? _memState[key] : defaultValue;
}

function clearState() {
  Object.keys(_memState).forEach(k => delete _memState[k]);
  try { sessionStorage.clear(); } catch (e) {}
  try { localStorage.removeItem('blindtest_resume'); localStorage.removeItem('blindtest_host_resume'); } catch (e) {}
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
