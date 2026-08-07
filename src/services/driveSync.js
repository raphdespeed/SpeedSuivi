/**
 * Google Drive AppData Zero-Backend Synchronization Service for SpeedSuivi
 * Client ID: 603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com
 * Scope: https://www.googleapis.com/auth/drive.appdata
 */

const CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID)
  ? import.meta.env.VITE_GOOGLE_CLIENT_ID
  : '603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const FILE_NAME = 'speedsuivi_data.json';
const TOKEN_INFO_KEY = 'gdrive_token_info';
const USER_KEY = 'speedsuivi_gdrive_user';
const TOMBSTONES_KEY = 'speedsuivi_deleted_ids';

let tokenClient = null;
let accessToken = null;
let tokenExpiryTime = 0;
let driveFileId = null;
let saveDebounceTimer = null;
let statusChangeCallback = null;
let silentRefreshResolver = null;
let refreshCheckTimer = null;

const SILENT_REFRESH_TIMEOUT_MS = 5000;
const PROACTIVE_REFRESH_CHECK_MS = 5 * 60 * 1000;
const PROACTIVE_REFRESH_WINDOW_MS = 10 * 60 * 1000;

export const driveState = {
  isConnected: false,
  isSyncing: false,
  user: null, // { email, name, picture }
  lastSyncTime: null,
  error: null
};

/**
 * Save active token info into localStorage ({ accessToken, expiresAt })
 */
function saveTokenInfo(token, expiresInSeconds) {
  accessToken = token;
  const expiresIn = expiresInSeconds || 3600;
  tokenExpiryTime = Date.now() + (expiresIn * 1000);
  console.info(`[DriveSync] Nouveau token reçu, expire dans ${expiresIn}s (à ${new Date(tokenExpiryTime).toLocaleTimeString()}).`);

  try {
    localStorage.setItem(TOKEN_INFO_KEY, JSON.stringify({
      accessToken: accessToken,
      expiresAt: tokenExpiryTime
    }));
  } catch (e) {
    console.error('Error storing gdrive_token_info:', e);
  }
}

/**
 * Active polling / promise helper to guarantee Google Identity Services (GIS) script loading.
 */
function ensureGISLoaded(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve(true);
      return;
    }

    let elapsed = 0;
    const interval = 100;
    const checkTimer = setInterval(() => {
      elapsed += interval;
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(checkTimer);
        resolve(true);
        return;
      }

      if (elapsed >= timeoutMs) {
        clearInterval(checkTimer);
        const scriptId = 'google-gsi-script-dynamic';
        let script = document.getElementById(scriptId);
        if (!script) {
          script = document.createElement('script');
          script.id = scriptId;
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);
        }

        let retryElapsed = 0;
        const retryTimer = setInterval(() => {
          retryElapsed += interval;
          if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            clearInterval(retryTimer);
            resolve(true);
          } else if (retryElapsed >= 3000) {
            clearInterval(retryTimer);
            resolve(false);
          }
        }, interval);
      }
    }, interval);
  });
}

/**
 * Helper to initialize GIS Token Client
 */
function setupTokenClient(onDataReceived, onStatusChange) {
  if (tokenClient || !window.google || !window.google.accounts || !window.google.accounts.oauth2) return;

  try {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      error_callback: (err) => {
        console.warn('GIS SDK background notice:', err);
      },
      callback: async (response) => {
        const silentResolve = silentRefreshResolver;
        silentRefreshResolver = null;

        if (response.error) {
          if (silentResolve) {
            console.warn(`[DriveSync] Renouvellement silencieux échoué (${response.error}).`);
            silentResolve(false);
            return;
          }

          console.warn('OAuth GIS Response error:', response.error);
          driveState.isSyncing = false;
          driveState.isConnected = false;
          if (onStatusChange) onStatusChange(driveState);

          if (response.error !== 'popup_closed_by_user' && response.error !== 'popup_closed') {
            alert(`Connexion Google interrompue (${response.error}). Veuillez réessayer.`);
          }
          return;
        }

        saveTokenInfo(response.access_token, response.expires_in);

        driveState.isConnected = true;
        driveState.error = null;

        // Direct fetch for user info without routing through fetchWithDriveAuth retry loop
        try {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` }
          });
          if (userRes && userRes.ok) {
            const uData = await userRes.json();
            driveState.user = {
              email: uData.email,
              name: uData.name || uData.email,
              picture: uData.picture || null
            };
            localStorage.setItem(USER_KEY, JSON.stringify(driveState.user));
          }
        } catch (ue) {
          console.warn('UserInfo fetch warning (non-fatal):', ue);
        }

        if (onStatusChange) onStatusChange(driveState);

        if (silentResolve) {
          console.info('[DriveSync] Renouvellement silencieux réussi.');
          silentResolve(true);
          return;
        }

        if (onDataReceived) {
          await syncWithDrive(onDataReceived, onStatusChange);
        }
      }
    });
  } catch (e) {
    console.error('Error setting up TokenClient:', e);
  }
}

/**
 * Attempts a silent token renewal (prompt: '') so an open tab can stay connected
 * for days without a manual reconnect. Bounded by a hard timeout: if GIS doesn't
 * respond within SILENT_REFRESH_TIMEOUT_MS (browser blocks the silent iframe, no
 * active Google session, etc.), this gives up cleanly instead of hanging forever —
 * that hang was exactly the Brave/mobile stuck-spinner regression this used to cause.
 */
function attemptSilentRefresh() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    silentRefreshResolver = finish;

    setTimeout(() => {
      if (!settled) {
        console.warn(`[DriveSync] Renouvellement silencieux : pas de réponse après ${SILENT_REFRESH_TIMEOUT_MS / 1000}s, abandon propre.`);
        finish(false);
      }
    }, SILENT_REFRESH_TIMEOUT_MS);

    try {
      const cachedUserStr = localStorage.getItem(USER_KEY);
      let userEmail = driveState.user?.email;
      if (!userEmail && cachedUserStr) {
        try { userEmail = JSON.parse(cachedUserStr)?.email; } catch (e) {}
      }
      tokenClient.requestAccessToken(userEmail ? { prompt: '', hint: userEmail } : { prompt: '' });
    } catch (e) {
      console.error('[DriveSync] Erreur lors du renouvellement silencieux:', e);
      finish(false);
    }
  });
}

/**
 * Periodically renews the token in the background, well before it actually expires,
 * so a tab left open stays connected across days instead of hitting a hard expiry.
 */
function scheduleProactiveRefreshCheck() {
  clearInterval(refreshCheckTimer);
  refreshCheckTimer = setInterval(async () => {
    if (!accessToken || !tokenExpiryTime) return;
    const remainingMs = tokenExpiryTime - Date.now();
    if (remainingMs > 0 && remainingMs < PROACTIVE_REFRESH_WINDOW_MS) {
      console.info(`[DriveSync] Renouvellement proactif (encore ${Math.round(remainingMs / 1000)}s avant expiration).`);
      const ok = await attemptSilentRefresh();
      if (!ok) {
        console.warn('[DriveSync] Renouvellement proactif silencieux indisponible pour le moment, nouvelle tentative au prochain contrôle.');
      }
    }
  }, PROACTIVE_REFRESH_CHECK_MS);
}

/**
 * Proactively check if token is valid (expiresAt > Date.now()); if not, try a silent
 * renewal before giving up and asking for a manual reconnect.
 */
async function ensureValidToken() {
  if (!accessToken) return false;

  const now = Date.now();
  if (tokenExpiryTime && tokenExpiryTime > now) {
    return true;
  }

  console.warn(`[DriveSync] Token expiré selon l'horloge locale (prévu à ${new Date(tokenExpiryTime).toLocaleTimeString()}, maintenant ${new Date(now).toLocaleTimeString()}) — tentative de renouvellement silencieux.`);

  const refreshed = await attemptSilentRefresh();
  if (refreshed) {
    console.info('[DriveSync] Session prolongée automatiquement.');
    return true;
  }

  console.warn('[DriveSync] Renouvellement silencieux impossible — session effacée, reconnexion manuelle nécessaire.');
  accessToken = null;
  tokenExpiryTime = 0;
  localStorage.removeItem(TOKEN_INFO_KEY);
  driveState.isConnected = false;
  if (statusChangeCallback) statusChangeCallback(driveState);

  return false;
}

/**
 * Central HTTP fetch wrapper for Drive API requests.
 * Only a persistent 401 (token genuinely rejected, confirmed by a retry) clears the session.
 * A 403 (rate limit, quota, permission) never means the token is dead, so it's left untouched.
 */
async function fetchWithDriveAuth(url, options = {}, attempt = 0) {
  const isValid = await ensureValidToken();

  if (!isValid || !accessToken) {
    return null;
  }

  const makeRequest = () => {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(url, { ...options, headers });
  };

  try {
    const response = await makeRequest();

    if (response && (response.status === 401 || response.status === 403)) {
      let detail = '';
      try { detail = JSON.stringify(await response.clone().json()); } catch (e) {}
      console.warn(`[DriveSync] HTTP ${response.status} sur ${url} (tentative ${attempt}): ${detail}`);

      if (response.status === 403) {
        return response;
      }

      if (attempt === 0) {
        console.warn('[DriveSync] 401 reçu, nouvelle tentative avant de considérer la session morte.');
        await new Promise(r => setTimeout(r, 700));
        return fetchWithDriveAuth(url, options, attempt + 1);
      }

      if (attempt === 1) {
        console.warn('[DriveSync] 401 persistant — tentative de renouvellement silencieux avant reconnexion manuelle.');
        const refreshed = await attemptSilentRefresh();
        if (refreshed) {
          console.info('[DriveSync] Session prolongée via renouvellement silencieux, nouvelle tentative de la requête.');
          return fetchWithDriveAuth(url, options, attempt + 1);
        }
      }

      console.warn('[DriveSync] Session invalide de façon persistante: session effacée, reconnexion manuelle nécessaire.');
      accessToken = null;
      tokenExpiryTime = 0;
      localStorage.removeItem(TOKEN_INFO_KEY);
      driveState.isConnected = false;
      if (statusChangeCallback) statusChangeCallback(driveState);
    }
    return response;
  } catch (err) {
    console.error('Network error calling Drive API:', err);
    return null;
  }
}

/**
 * Initialize Google Token Client
 */
export function initDriveSync(onStatusChange, onDataReceived) {
  if (onStatusChange) statusChangeCallback = onStatusChange;

  try {
    // 1. Restore cached user profile from localStorage
    const cachedUser = localStorage.getItem(USER_KEY);
    if (cachedUser) {
      try {
        driveState.user = JSON.parse(cachedUser);
      } catch (e) {}
    }

    // 2. Restore cached token if STILL VALID (expiresAt > Date.now())
    const cachedTokenInfoStr = localStorage.getItem(TOKEN_INFO_KEY);
    let hadExpiredCachedToken = false;

    if (cachedTokenInfoStr) {
      try {
        const tokenInfo = JSON.parse(cachedTokenInfoStr);
        const token = tokenInfo.accessToken || tokenInfo.token;
        const expiresAt = parseInt(tokenInfo.expiresAt || tokenInfo.expiry, 10) || 0;

        if (token && expiresAt && expiresAt > Date.now()) {
          accessToken = token;
          tokenExpiryTime = expiresAt;
          driveState.isConnected = true;
          const remainingMs = expiresAt - Date.now();
          console.info(`[DriveSync] Token restauré depuis le cache local, encore valide ${Math.round(remainingMs / 1000)}s (jusqu'à ${new Date(expiresAt).toLocaleTimeString()}).`);

          // Fetch user profile if not cached yet
          if (!driveState.user) {
            fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            }).then(res => res.ok ? res.json() : null).then(uData => {
              if (uData) {
                driveState.user = {
                  email: uData.email,
                  name: uData.name || uData.email,
                  picture: uData.picture || null
                };
                localStorage.setItem(USER_KEY, JSON.stringify(driveState.user));
                if (onStatusChange) onStatusChange(driveState);
              }
            }).catch(() => {});
          }

          if (onStatusChange) onStatusChange(driveState);

          // Perform initial sync using valid cached token
          syncWithDrive(onDataReceived, onStatusChange);
        } else {
          console.warn('[DriveSync] Token en cache expiré au chargement de la page — tentative de renouvellement silencieux.');
          localStorage.removeItem(TOKEN_INFO_KEY);
          driveState.isConnected = false;
          hadExpiredCachedToken = true;
          if (onStatusChange) onStatusChange(driveState);
        }
      } catch (e) {
        console.error('Error parsing gdrive_token_info:', e);
        localStorage.removeItem(TOKEN_INFO_KEY);
        driveState.isConnected = false;
        if (onStatusChange) onStatusChange(driveState);
      }
    } else {
      driveState.isConnected = false;
      if (onStatusChange) onStatusChange(driveState);
    }

    // 3. Pre-initialize TokenClient eagerly in background
    ensureGISLoaded(3000).then((isLoaded) => {
      if (!isLoaded) return;

      setupTokenClient(onDataReceived, onStatusChange);
      scheduleProactiveRefreshCheck();

      if (hadExpiredCachedToken && driveState.user?.email) {
        attemptSilentRefresh().then((ok) => {
          if (ok) {
            console.info('[DriveSync] Reconnexion silencieuse réussie au chargement de la page.');
            if (onDataReceived) syncWithDrive(onDataReceived, onStatusChange);
          } else {
            console.warn('[DriveSync] Reconnexion silencieuse impossible au chargement — reconnexion manuelle nécessaire.');
          }
        });
      }
    });
  } catch (initErr) {
    console.error('initDriveSync top-level error caught gracefully:', initErr);
    driveState.isConnected = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Trigger OAuth Login Flow via Google Identity Services Popup
 * Uses prompt: 'select_account' to open the account chooser directly without gsiw background loops.
 */
export function loginGoogleDrive(onDataReceived, onStatusChange) {
  try {
    if (!tokenClient && window.google?.accounts?.oauth2) {
      setupTokenClient(onDataReceived, onStatusChange || statusChangeCallback);
    }

    if (tokenClient) {
      silentRefreshResolver = null;
      const cachedUserStr = localStorage.getItem(USER_KEY);
      let userEmail = driveState.user?.email;
      if (!userEmail && cachedUserStr) {
        try { userEmail = JSON.parse(cachedUserStr)?.email; } catch (e) {}
      }

      const requestConfig = {};
      if (userEmail) {
        // Directly target the logged-in Google account without forcing account selector screen
        requestConfig.hint = userEmail;
      } else {
        requestConfig.prompt = 'select_account';
      }

      tokenClient.requestAccessToken(requestConfig);
    } else {
      alert("Le service Google Identity est en cours de chargement. Veuillez recharger la page et réessayer.");
    }
  } catch (e) {
    console.error('Error triggering Google Drive login:', e);
    alert("Impossible d'ouvrir la fenêtre de connexion Google. Veuillez autoriser les fenêtres surgissantes (pop-ups) pour ce site.");
  }
}

/**
 * Logout from Google Drive sync and clean localStorage
 */
export function logoutGoogleDrive(onStatusChange) {
  try {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
  } catch (e) {}

  clearInterval(refreshCheckTimer);
  silentRefreshResolver = null;
  accessToken = null;
  driveFileId = null;
  tokenExpiryTime = 0;

  localStorage.removeItem(TOKEN_INFO_KEY);
  localStorage.removeItem(USER_KEY);

  driveState.isConnected = false;
  driveState.isSyncing = false;
  driveState.user = null;
  driveState.lastSyncTime = null;
  driveState.error = null;

  if (onStatusChange) onStatusChange(driveState);
}

/**
 * Search for existing speedsuivi_data.json file in appDataFolder
 */
async function findDriveFile() {
  try {
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27${FILE_NAME}%27%20and%20trashed%3Dfalse`;
    const res = await fetchWithDriveAuth(url);
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    return null;
  } catch (e) {
    console.error('Error finding Drive file:', e);
    return null;
  }
}

/**
 * Download collection data from Drive file
 */
async function downloadDriveFile(fileId) {
  if (!fileId) return null;
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetchWithDriveAuth(url);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('Error downloading Drive file:', e);
    return null;
  }
}

/**
 * Create a new file in appDataFolder
 */
async function createDriveFile(collection) {
  try {
    const metadata = {
      name: FILE_NAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json'
    };
    const fileContent = JSON.stringify(collection, null, 2);

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileContent], { type: 'application/json' }));

    const res = await fetchWithDriveAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: form
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.id;
  } catch (e) {
    console.error('Error creating Drive file:', e);
    return null;
  }
}

/**
 * Update existing file content in Drive
 */
async function updateDriveFile(fileId, collection) {
  if (!fileId) return false;
  try {
    const fileContent = JSON.stringify(collection, null, 2);
    const res = await fetchWithDriveAuth(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: fileContent
    });
    return res ? res.ok : false;
  } catch (e) {
    console.error('Error updating Drive file:', e);
    return false;
  }
}

/**
 * Deletion tombstones: { [itemId]: deletedAtISOString }
 * Recorded locally whenever an item is explicitly removed, so that a merge with
 * an older copy (this device or another) never silently resurrects it.
 */
function getLocalTombstones() {
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveLocalTombstones(tombstones) {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones || {}));
  } catch (e) {
    console.error('Error storing deletion tombstones:', e);
  }
}

/**
 * Record that an item was explicitly deleted, so future merges keep it deleted
 * unless it gets re-added later with a fresher timestamp.
 */
export function recordDeletion(itemId) {
  if (!itemId) return;
  const tombstones = getLocalTombstones();
  tombstones[itemId] = new Date().toISOString();
  saveLocalTombstones(tombstones);
}

function mergeTombstones(localTombstones, remoteTombstones) {
  const merged = { ...(localTombstones || {}) };
  Object.entries(remoteTombstones || {}).forEach(([id, deletedAt]) => {
    if (!merged[id] || new Date(deletedAt).getTime() > new Date(merged[id]).getTime()) {
      merged[id] = deletedAt;
    }
  });
  return merged;
}

/**
 * Drive files were historically a raw array. Accepts both that legacy shape
 * and the current { items, tombstones } shape.
 */
function normalizeRemotePayload(data) {
  if (Array.isArray(data)) {
    return { items: data, tombstones: {} };
  }
  if (data && Array.isArray(data.items)) {
    return {
      items: data.items,
      tombstones: (data.tombstones && typeof data.tombstones === 'object') ? data.tombstones : {}
    };
  }
  return null;
}

/**
 * Intelligent Conflict Resolution Engine
 */
export function mergeCollections(localItems, remoteItems, localTombstones = {}, remoteTombstones = {}) {
  const tombstones = mergeTombstones(localTombstones, remoteTombstones);
  const map = new Map();

  (localItems || []).forEach(item => {
    if (item && item.id) {
      map.set(item.id, { ...item });
    }
  });

  (remoteItems || []).forEach(remoteItem => {
    if (!remoteItem || !remoteItem.id) return;

    if (!map.has(remoteItem.id)) {
      map.set(remoteItem.id, { ...remoteItem });
    } else {
      const localItem = map.get(remoteItem.id);
      const localTime = new Date(localItem.updatedAt || localItem.addedAt || 0).getTime();
      const remoteTime = new Date(remoteItem.updatedAt || remoteItem.addedAt || 0).getTime();

      if (remoteTime > localTime) {
        map.set(remoteItem.id, { ...localItem, ...remoteItem });
      } else {
        map.set(remoteItem.id, { ...remoteItem, ...localItem });
      }
    }
  });

  const items = Array.from(map.values()).filter(item => {
    const deletedAt = tombstones[item.id];
    if (!deletedAt) return true;
    const itemTime = new Date(item.updatedAt || item.addedAt || 0).getTime();
    return new Date(deletedAt).getTime() < itemTime;
  });

  return { items, tombstones };
}

/**
 * Perform initial synchronization (Download from Drive & Merge with Local)
 */
export async function syncWithDrive(onDataReceived, onStatusChange) {
  if (!accessToken) return;

  driveState.isSyncing = true;
  if (onStatusChange) onStatusChange(driveState);

  try {
    driveFileId = await findDriveFile();

    const localCollection = JSON.parse(localStorage.getItem('media_tracker_v2') || '[]');
    const localTombstones = getLocalTombstones();

    if (driveFileId) {
      const remote = normalizeRemotePayload(await downloadDriveFile(driveFileId));
      if (remote) {
        const { items: merged, tombstones: mergedTombstones } = mergeCollections(
          localCollection, remote.items, localTombstones, remote.tombstones
        );

        localStorage.setItem('media_tracker_v2', JSON.stringify(merged));
        saveLocalTombstones(mergedTombstones);
        await updateDriveFile(driveFileId, { items: merged, tombstones: mergedTombstones });

        if (onDataReceived) onDataReceived(merged);
      }
    } else {
      driveFileId = await createDriveFile({ items: localCollection, tombstones: localTombstones });
    }

    driveState.lastSyncTime = new Date();
  } catch (err) {
    console.error('Drive Sync Error:', err);
    driveState.error = err.message;
  } finally {
    driveState.isSyncing = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Force Downward Sync (Cloud -> Local)
 */
export async function forcePullFromDrive(onDataReceived, onStatusChange) {
  driveState.isSyncing = true;
  if (onStatusChange) onStatusChange(driveState);

  try {
    if (!driveFileId) driveFileId = await findDriveFile();
    if (!driveFileId) {
      throw new Error("Aucun fichier distant trouvé sur Google Drive.");
    }

    const remote = normalizeRemotePayload(await downloadDriveFile(driveFileId));
    if (!remote) {
      throw new Error("Fichier distant corrompu ou au format invalide.");
    }

    localStorage.setItem('media_tracker_v2', JSON.stringify(remote.items));
    saveLocalTombstones(remote.tombstones);
    driveState.lastSyncTime = new Date();
    if (onDataReceived) onDataReceived(remote.items);
    return remote.items.length;
  } finally {
    driveState.isSyncing = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Force Upward Sync (Local -> Cloud)
 */
export async function forcePushToDrive(currentCollection, onStatusChange) {
  driveState.isSyncing = true;
  if (onStatusChange) onStatusChange(driveState);

  try {
    if (!driveFileId) driveFileId = await findDriveFile();
    const payload = { items: currentCollection, tombstones: getLocalTombstones() };

    if (driveFileId) {
      await updateDriveFile(driveFileId, payload);
    } else {
      driveFileId = await createDriveFile(payload);
    }

    driveState.lastSyncTime = new Date();
    return currentCollection.length;
  } finally {
    driveState.isSyncing = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Debounced Save to Google Drive (1.5s) on user data modification
 */
export function triggerAutoSaveToDrive(currentCollection, onStatusChange) {
  if (!accessToken || !driveState.isConnected) return;

  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    driveState.isSyncing = true;
    if (onStatusChange) onStatusChange(driveState);

    try {
      if (!driveFileId) {
        driveFileId = await findDriveFile();
      }

      const payload = { items: currentCollection, tombstones: getLocalTombstones() };

      if (driveFileId) {
        await updateDriveFile(driveFileId, payload);
      } else {
        driveFileId = await createDriveFile(payload);
      }

      driveState.lastSyncTime = new Date();
    } catch (e) {
      console.error('AutoSave to Drive failed:', e);
      driveState.error = e.message;
    } finally {
      driveState.isSyncing = false;
      if (onStatusChange) onStatusChange(driveState);
    }
  }, 1500);
}
