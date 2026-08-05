/**
 * Google Drive AppData Zero-Backend Synchronization Service for SpeedSuivi
 * Client ID: 603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com
 * Scope: https://www.googleapis.com/auth/drive.appdata
 *
 * AUTH STRATEGY (v1.4.9): OAuth2 Implicit Redirect Flow.
 * We no longer use Google Identity Services (`initTokenClient` / popups / iFrames).
 * Popups are blocked by strict third-party-cookie browsers (Brave, hardened Chrome/Edge)
 * and by mobile browsers that refuse non-synchronous window.open() calls.
 * A full-page redirect (`window.location.href = authUrl`) has none of those restrictions:
 * it works identically on mobile and desktop, with or without third-party cookies.
 */

const CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID)
  ? import.meta.env.VITE_GOOGLE_CLIENT_ID
  : '603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const FILE_NAME = 'speedsuivi_data.json';
const TOKEN_INFO_KEY = 'gdrive_token_info';
const USER_KEY = 'speedsuivi_gdrive_user';
const OAUTH_STATE_KEY = 'gdrive_oauth_state';

let accessToken = null;
let tokenExpiryTime = 0;
let driveFileId = null;
let saveDebounceTimer = null;
let statusChangeCallback = null;

export const driveState = {
  isConnected: false,
  isSyncing: false,
  user: null, // { email, name, picture }
  lastSyncTime: null,
  error: null
};

/**
 * Compute the redirect_uri dynamically from the current page location.
 * MUST exactly match (including trailing slash) an "Authorized redirect URI"
 * configured on the Google Cloud OAuth Client, e.g.:
 *   https://raphdespeed.github.io/SpeedSuivi/
 *   http://localhost:5173/ (for local dev)
 */
function getRedirectUri() {
  return window.location.origin + window.location.pathname;
}

/**
 * Generate a short random string used as CSRF protection (OAuth `state` param).
 */
function generateState() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Build the full Google OAuth2 implicit-flow authorization URL.
 */
function buildAuthUrl() {
  const state = generateState();
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch (e) {
    console.warn('Unable to persist OAuth state in sessionStorage:', e);
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Save active token info into localStorage ({ accessToken, expiresAt })
 */
function saveTokenInfo(token, expiresInSeconds) {
  accessToken = token;
  const expiresIn = expiresInSeconds || 3600;
  tokenExpiryTime = Date.now() + (expiresIn * 1000);

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
 * Parse the URL hash fragment for an OAuth2 implicit-flow response
 * (`#access_token=...&expires_in=...&state=...` or `#error=...&state=...`).
 * Cleans the hash from the address bar immediately via history.replaceState
 * so the token never lingers in the URL, browser history, or gets re-parsed
 * on refresh.
 * Returns: { accessToken, expiresIn } | { error } | null (nothing to parse)
 */
function consumeAuthRedirectHash() {
  if (!window.location.hash || window.location.hash.length < 2) return null;

  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const hasOAuthPayload = hashParams.has('access_token') || hashParams.has('error');
  if (!hasOAuthPayload) return null;

  const cleanUrl = window.location.pathname + window.location.search;
  history.replaceState(null, '', cleanUrl);

  let expectedState = null;
  try {
    expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch (e) {}

  const returnedState = hashParams.get('state');
  if (expectedState && returnedState && returnedState !== expectedState) {
    console.warn('OAuth state mismatch: discarding response for safety.');
    return { error: 'state_mismatch' };
  }

  const error = hashParams.get('error');
  if (error) {
    return { error };
  }

  const accessTokenValue = hashParams.get('access_token');
  const expiresIn = parseInt(hashParams.get('expires_in'), 10) || 3600;
  if (accessTokenValue) {
    return { accessToken: accessTokenValue, expiresIn };
  }

  return null;
}

/**
 * Translate an OAuth error code into a user-facing French message.
 */
function describeOAuthError(errorCode) {
  switch (errorCode) {
    case 'access_denied':
      return "L'accès à Google Drive a été refusé.";
    case 'state_mismatch':
      return 'Connexion Google Drive annulée pour des raisons de sécurité. Merci de réessayer.';
    case 'invalid_request':
    case 'invalid_client':
    case 'redirect_uri_mismatch':
      return "Configuration Google OAuth invalide (redirect_uri). Contactez le développeur de l'application.";
    default:
      return `Erreur de connexion Google Drive : ${errorCode}`;
  }
}

/**
 * Proactively check if the cached token is still valid.
 * The implicit flow never returns a refresh token, so there is no silent
 * renewal possible: once expired, the user must click "Se connecter" again
 * (which redirects — no popup involved).
 */
function isTokenValid() {
  return !!(accessToken && tokenExpiryTime && tokenExpiryTime > Date.now());
}

/**
 * Central HTTP fetch wrapper for Drive API requests.
 * On 401/403 the token is considered dead: clear it and flip to disconnected
 * state (no silent popup-based retry is possible in the redirect flow).
 */
async function fetchWithDriveAuth(url, options = {}) {
  if (!isTokenValid()) {
    if (accessToken) {
      // Token expired
      accessToken = null;
      tokenExpiryTime = 0;
      localStorage.removeItem(TOKEN_INFO_KEY);
      driveState.isConnected = false;
      if (statusChangeCallback) statusChangeCallback(driveState);
    }
    return null;
  }

  const makeRequest = () => {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(url, { ...options, headers });
  };

  let response = null;
  try {
    response = await makeRequest();
  } catch (err) {
    console.error('Network error calling Drive API:', err);
    return null;
  }

  if (response && (response.status === 401 || response.status === 403)) {
    console.error(`Drive API persistent HTTP ${response.status}. Disconnecting user session.`);
    accessToken = null;
    tokenExpiryTime = 0;
    localStorage.removeItem(TOKEN_INFO_KEY);
    driveState.isConnected = false;
    if (statusChangeCallback) statusChangeCallback(driveState);
    return response;
  }

  return response;
}

/**
 * Initialize Google Drive sync on app load.
 * Order of operations (all passive — nothing here ever navigates or opens a window):
 *   1. Restore cached user profile from localStorage.
 *   2. Check if we just came back from the Google OAuth redirect (URL hash).
 *      - If it carries a fresh token: store it, clean the URL, sync.
 *      - If it carries an error: surface it, clean the URL.
 *   3. Otherwise, restore a still-valid cached token from localStorage silently.
 *   4. Otherwise, stay in "Déconnecté" state. Never redirect automatically.
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

    // 2. Check for a fresh redirect result in the URL hash
    const redirectResult = consumeAuthRedirectHash();

    if (redirectResult && redirectResult.error) {
      driveState.error = redirectResult.error;
      driveState.isConnected = false;
      if (onStatusChange) onStatusChange(driveState);
      alert(describeOAuthError(redirectResult.error));
      return;
    }

    if (redirectResult && redirectResult.accessToken) {
      saveTokenInfo(redirectResult.accessToken, redirectResult.expiresIn);
      driveState.isConnected = true;
      driveState.error = null;
      if (onStatusChange) onStatusChange(driveState);

      fetchUserProfile().finally(() => {
        if (onStatusChange) onStatusChange(driveState);
        if (onDataReceived) syncWithDrive(onDataReceived, onStatusChange);
      });
      return;
    }

    // 3. No redirect result — try restoring a still-valid cached token
    const cachedTokenInfoStr = localStorage.getItem(TOKEN_INFO_KEY);

    if (cachedTokenInfoStr) {
      try {
        const tokenInfo = JSON.parse(cachedTokenInfoStr);
        const token = tokenInfo.accessToken || tokenInfo.token;
        const expiresAt = parseInt(tokenInfo.expiresAt || tokenInfo.expiry, 10) || 0;

        if (token && expiresAt && expiresAt > Date.now()) {
          accessToken = token;
          tokenExpiryTime = expiresAt;
          driveState.isConnected = true;
          if (onStatusChange) onStatusChange(driveState);

          // Passive sync using the valid cached token — no prompt, no redirect.
          if (onDataReceived) syncWithDrive(onDataReceived, onStatusChange);
        } else {
          // Token expired -> Reset to disconnected state, no auto-redirect.
          localStorage.removeItem(TOKEN_INFO_KEY);
          driveState.isConnected = false;
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
  } catch (initErr) {
    console.error('initDriveSync top-level error caught gracefully:', initErr);
    driveState.isConnected = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Fetch the connected user's profile (name, email, picture) via the Drive-scoped token.
 */
async function fetchUserProfile() {
  try {
    const userRes = await fetchWithDriveAuth('https://www.googleapis.com/oauth2/v3/userinfo');
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
    console.warn('UserInfo fetch warning:', ue);
  }
}

/**
 * Trigger the OAuth2 implicit-flow login by redirecting the full page to Google.
 * CRITICAL: This must stay a plain, synchronous `window.location.href` assignment,
 * called directly from the click handler — no async/await, no setTimeout before it.
 * A full-page redirect is not subject to popup-blocking or third-party-cookie
 * restrictions, so this works identically on mobile and desktop.
 */
export function loginGoogleDrive() {
  try {
    window.location.href = buildAuthUrl();
  } catch (e) {
    console.error('Error triggering Google Drive login redirect:', e);
    alert("Impossible de lancer la connexion Google Drive. Veuillez réessayer.");
  }
}

/**
 * Logout from Google Drive sync and clean localStorage.
 * Revokes the token via Google's standard revoke endpoint (no GIS library required).
 */
export function logoutGoogleDrive(onStatusChange) {
  const tokenToRevoke = accessToken;

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

  if (tokenToRevoke) {
    fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokenToRevoke)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }).catch(() => {});
  }
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
 * Intelligent Conflict Resolution Engine
 * Merges local and remote collections based on item ID and latest updatedAt timestamp.
 * Protects un-synced offline local items from being overwritten.
 */
export function mergeCollections(localItems, remoteItems) {
  const map = new Map();

  // 1. Load local items
  (localItems || []).forEach(item => {
    if (item && item.id) {
      map.set(item.id, { ...item });
    }
  });

  // 2. Merge remote items intelligently
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

  return Array.from(map.values());
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

    if (driveFileId) {
      const remoteCollection = await downloadDriveFile(driveFileId);
      if (Array.isArray(remoteCollection)) {
        const merged = mergeCollections(localCollection, remoteCollection);

        // Save merged collection back to localStorage and Drive
        localStorage.setItem('media_tracker_v2', JSON.stringify(merged));
        await updateDriveFile(driveFileId, merged);

        if (onDataReceived) onDataReceived(merged);
      }
    } else {
      // First time sync: Create file in Drive appDataFolder with local collection
      driveFileId = await createDriveFile(localCollection);
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

    const remoteCollection = await downloadDriveFile(driveFileId);
    if (!Array.isArray(remoteCollection)) {
      throw new Error("Fichier distant corrompu ou au format invalide.");
    }

    localStorage.setItem('media_tracker_v2', JSON.stringify(remoteCollection));
    driveState.lastSyncTime = new Date();
    if (onDataReceived) onDataReceived(remoteCollection);
    return remoteCollection.length;
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

    if (driveFileId) {
      await updateDriveFile(driveFileId, currentCollection);
    } else {
      driveFileId = await createDriveFile(currentCollection);
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

      if (driveFileId) {
        await updateDriveFile(driveFileId, currentCollection);
      } else {
        driveFileId = await createDriveFile(currentCollection);
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
