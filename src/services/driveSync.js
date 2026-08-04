/**
 * Google Drive AppData Zero-Backend Synchronization Service for SpeedSuivi
 * Client ID: 603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com
 * Scope: https://www.googleapis.com/auth/drive.appdata
 */

const CLIENT_ID = '603945258667-0a9970mtho016qrg3tpv5vqcgupsaqk3.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'speedsuivi_data.json';
const TOKEN_KEY = 'speedsuivi_gdrive_token';
const USER_KEY = 'speedsuivi_gdrive_user';

let tokenClient = null;
let accessToken = null;
let driveFileId = null;
let saveDebounceTimer = null;

export const driveState = {
  isConnected: false,
  isSyncing: false,
  user: null, // { email, name, picture }
  lastSyncTime: null,
  error: null
};

/**
 * Initialize Google Token Client via Google Identity Services (GIS)
 */
export function initDriveSync(onStatusChange, onDataReceived) {
  // Restore cached session token if available
  const cachedToken = sessionStorage.getItem(TOKEN_KEY);
  const cachedUser = localStorage.getItem(USER_KEY);

  if (cachedUser) {
    try {
      driveState.user = JSON.parse(cachedUser);
    } catch (e) {}
  }

  if (cachedToken) {
    accessToken = cachedToken;
    driveState.isConnected = true;
    if (onStatusChange) onStatusChange(driveState);
  }

  const checkGISLoaded = () => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: async (response) => {
          if (response.error) {
            console.error('OAuth Error:', response.error);
            driveState.error = response.error;
            driveState.isSyncing = false;
            if (onStatusChange) onStatusChange(driveState);
            return;
          }

          accessToken = response.access_token;
          sessionStorage.setItem(TOKEN_KEY, accessToken);
          driveState.isConnected = true;
          driveState.error = null;

          // Fetch basic user profile using Google userInfo
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (userRes.ok) {
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

          // Perform initial sync with Google Drive appDataFolder
          if (onDataReceived) {
            await syncWithDrive(onDataReceived, onStatusChange);
          }
        }
      });
    } else {
      setTimeout(checkGISLoaded, 300);
    }
  };

  checkGISLoaded();
}

/**
 * Trigger OAuth login flow
 */
export function loginGoogleDrive() {
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    alert("Le service Google Identity n'est pas encore prêt. Veuillez réessayer dans un instant.");
  }
}

/**
 * Logout from Google Drive sync
 */
export function logoutGoogleDrive(onStatusChange) {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  driveFileId = null;
  sessionStorage.removeItem(TOKEN_KEY);
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
  if (!accessToken) return null;
  try {
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27${FILE_NAME}%27%20and%20trashed%3Dfalse`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      if (res.status === 401) {
        // Token expired
        driveState.isConnected = false;
        sessionStorage.removeItem(TOKEN_KEY);
      }
      return null;
    }
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
  if (!accessToken || !fileId) return null;
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
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
  if (!accessToken) return null;
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

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    });
    if (!res.ok) return null;
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
  if (!accessToken || !fileId) return false;
  try {
    const fileContent = JSON.stringify(collection, null, 2);
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: fileContent
    });
    return res.ok;
  } catch (e) {
    console.error('Error updating Drive file:', e);
    return false;
  }
}

/**
 * Merge local collection with remote collection (backward compatibility & conflict resolution)
 */
export function mergeCollections(localItems, remoteItems) {
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
