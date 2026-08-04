/**
 * Google Drive AppData Zero-Backend Synchronization Service for SpeedSuivi
 * Client ID: 603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com
 * Scope: https://www.googleapis.com/auth/drive.appdata
 */

const CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID)
  ? import.meta.env.VITE_GOOGLE_CLIENT_ID
  : '603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'speedsuivi_data.json';
const TOKEN_INFO_KEY = 'gdrive_token_info';
const USER_KEY = 'speedsuivi_gdrive_user';

let tokenClient = null;
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
 * Active polling / promise helper to guarantee Google Identity Services (GIS) script loading.
 * Dynamically reloads script if missing after 3 seconds.
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
        console.warn('GIS SDK not ready after 3s, dynamically injecting script...');

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
            console.error('Failed to load Google Identity Services SDK.');
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
      callback: async (response) => {
        if (response.error) {
          console.warn('OAuth GIS Response error:', response.error);
          driveState.error = response.error;
          driveState.isSyncing = false;
          driveState.isConnected = false;
          localStorage.removeItem(TOKEN_INFO_KEY);
          if (onStatusChange) onStatusChange(driveState);
          return;
        }

        // Save fresh token to localStorage ({ accessToken, expiresAt })
        saveTokenInfo(response.access_token, response.expires_in);

        driveState.isConnected = true;
        driveState.error = null;

        // Fetch user profile using Google userInfo API
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

        if (onStatusChange) onStatusChange(driveState);

        // Perform sync with Google Drive appDataFolder
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
 * Proactively check if token is valid or expiring within 5 minutes.
 * Performs silent refresh ONLY when an active user session token exists.
 */
async function ensureValidToken() {
  if (!accessToken) return false;

  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;

  // Token is valid with >5 minutes remaining
  if (tokenExpiryTime && (tokenExpiryTime - now > fiveMinutesMs)) {
    return true;
  }

  // Token expiring soon -> Attempt silent refresh during active API calls
  if (tokenClient) {
    return new Promise((resolve) => {
      try {
        tokenClient.requestAccessToken({ prompt: '' });
        setTimeout(() => {
          if (accessToken && (tokenExpiryTime - Date.now() > 0)) {
            resolve(true);
          } else {
            console.warn('Silent token refresh did not yield a valid token in time.');
            resolve(false);
          }
        }, 2000);
      } catch (e) {
        console.error('Silent token request error:', e);
        resolve(false);
      }
    });
  }

  return false;
}

/**
 * Central HTTP fetch wrapper for Drive API requests with 401/403 retry handling.
 * Does NOT disconnect immediately on 401/403; attempts ONE silent token refresh first.
 */
async function fetchWithDriveAuth(url, options = {}) {
  // Proactive check before request
  await ensureValidToken();

  if (!accessToken) {
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

  // Handle HTTP 401 (Unauthorized) or 403 (Forbidden)
  if (response && (response.status === 401 || response.status === 403)) {
    console.warn(`Drive API returned HTTP ${response.status}. Attempting silent token refresh...`);

    if (tokenClient) {
      const refreshed = await new Promise((resolve) => {
        try {
          tokenClient.requestAccessToken({ prompt: '' });
          setTimeout(() => {
            if (accessToken && (tokenExpiryTime - Date.now() > 0)) {
              resolve(true);
            } else {
              resolve(false);
            }
          }, 2000);
        } catch (e) {
          resolve(false);
        }
      });

      if (refreshed) {
        // Retry request once with new token
        try {
          response = await makeRequest();
        } catch (retryErr) {
          console.error('Network error on retried Drive API request:', retryErr);
          return null;
        }
      }
    }
  }

  // Disconnect ONLY IF silent refresh failed and final response is still 401/403
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
 * Initialize Google Token Client via Google Identity Services (GIS)
 * Secure silent restoration & mobile-friendly user-triggered login flow.
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

          // Perform initial sync using valid cached token without auto-prompting
          syncWithDrive(onDataReceived, onStatusChange);
        } else {
          // Token expired -> Reset to disconnected state, DO NOT auto-trigger requestAccessToken() on load
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

    // 3. Actively ensure GIS script is loaded and initialize TokenClient
    ensureGISLoaded(3000).then((isLoaded) => {
      if (isLoaded) {
        setupTokenClient(onDataReceived, onStatusChange);
      }
    });
  } catch (initErr) {
    console.error('initDriveSync top-level error caught gracefully:', initErr);
    driveState.isConnected = false;
    if (onStatusChange) onStatusChange(driveState);
  }
}

/**
 * Trigger explicit OAuth login flow with user consent upon explicit click
 */
export async function loginGoogleDrive(onDataReceived, onStatusChange) {
  try {
    const isReady = await ensureGISLoaded(2000);
    if (isReady && !tokenClient) {
      setupTokenClient(onDataReceived, onStatusChange || statusChangeCallback);
    }

    if (tokenClient) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      alert("Le service Google Identity n'est pas encore prêt. Veuillez recharger la page ou réessayer dans un instant.");
    }
  } catch (e) {
    console.error('Error triggering Google Drive login:', e);
    alert("Impossible d'ouvrir la fenêtre de connexion Google. Veuillez vérifier votre bloqueur de pop-ups.");
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

  accessToken = null;
  driveFileId = null;
  tokenExpiryTime = 0;

  localStorage.removeItem(TOKEN_INFO_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem('speedsuivi_gdrive_token');
  sessionStorage.removeItem('speedsuivi_gdrive_expiry');

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
