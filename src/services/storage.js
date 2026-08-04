const STORAGE_KEY = 'media_tracker_v2';
const FALLBACK_KEY = 'media_tracker_library_v1';

/**
 * Get all media items stored in localStorage
 */
export function getCollection() {
  try {
    const data = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(FALLBACK_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading localStorage:', error);
    return [];
  }
}

/**
 * Save collection to localStorage synchronously
 */
export function saveCollection(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('storage-updated', { detail: items }));
    return true;
  } catch (error) {
    console.error('Error saving to localStorage:', error);
    return false;
  }
}

/**
 * Helper to generate unique item key
 */
export function getItemKey(mediaType, tmdbId) {
  return `${mediaType}_${tmdbId}`;
}

/**
 * Add or update a media item in collection
 * status: 'in_progress' | 'watchlist' | 'completed'
 */
export function saveMediaItem(mediaItem, targetStatus = 'in_progress', seasonEpState = {}) {
  const collection = getCollection();
  const itemKey = getItemKey(mediaItem.mediaType, mediaItem.id);
  const existingIndex = collection.findIndex(item => item.id === itemKey);

  const isMovie = mediaItem.mediaType === 'movie';
  const defaultTotalEp = mediaItem.numberOfEpisodes || (isMovie ? 1 : 12);
  const defaultTotalSeasons = mediaItem.numberOfSeasons || 1;

  let currentSeason = seasonEpState.currentSeason || 1;
  let currentEpisode = seasonEpState.currentEpisode;

  if (currentEpisode === undefined) {
    if (targetStatus === 'completed') {
      currentEpisode = defaultTotalEp;
    } else if (targetStatus === 'in_progress') {
      currentEpisode = isMovie ? 0 : 1;
    } else {
      currentEpisode = 0;
    }
  }

  const updatedEntry = {
    id: itemKey,
    tmdbId: mediaItem.id,
    mediaType: mediaItem.mediaType,
    category: mediaItem.category || 'series',
    title: mediaItem.title,
    originalTitle: mediaItem.originalTitle || '',
    posterPath: mediaItem.posterPath,
    backdropPath: mediaItem.backdropPath || null,
    overview: mediaItem.overview || '',
    releaseDate: mediaItem.releaseDate || '',
    year: mediaItem.year || '',
    voteAverage: mediaItem.voteAverage || null,
    genres: mediaItem.genres || [],
    
    // Status & Tracking progress
    status: targetStatus,
    currentSeason: currentSeason,
    currentEpisode: currentEpisode,
    totalSeasons: defaultTotalSeasons,
    totalEpisodes: defaultTotalEp,
    episodesPerSeason: mediaItem.seasons || [],
    
    userRating: seasonEpState.userRating || null,
    addedAt: existingIndex >= 0 ? collection[existingIndex].addedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    collection[existingIndex] = { ...collection[existingIndex], ...updatedEntry };
  } else {
    collection.push(updatedEntry);
  }

  saveCollection(collection);
  return updatedEntry;
}

/**
 * Increment or decrement current episode
 */
export function updateEpisodeCount(itemId, delta) {
  const collection = getCollection();
  const item = collection.find(i => i.id === itemId);
  if (!item) return null;

  const isMovie = item.mediaType === 'movie';
  const maxEpisodes = isMovie ? 1 : (item.totalEpisodes || 999);
  
  let newEpisode = (item.currentEpisode || 0) + delta;
  newEpisode = Math.max(0, Math.min(maxEpisodes, newEpisode));

  item.currentEpisode = newEpisode;
  item.updatedAt = new Date().toISOString();

  // If episodes completed, auto switch status to completed
  if (maxEpisodes > 0 && newEpisode >= maxEpisodes && item.status === 'in_progress') {
    item.status = 'completed';
  } else if (newEpisode < maxEpisodes && item.status === 'completed') {
    item.status = 'in_progress';
  }

  saveCollection(collection);
  return item;
}

/**
 * Change media status ('in_progress' | 'watchlist' | 'completed')
 */
export function updateMediaStatus(itemId, newStatus) {
  const collection = getCollection();
  const item = collection.find(i => i.id === itemId);
  if (!item) return null;

  item.status = newStatus;
  item.updatedAt = new Date().toISOString();

  if (newStatus === 'completed') {
    if (item.totalEpisodes > 0) {
      item.currentEpisode = item.totalEpisodes;
    }
  } else if (newStatus === 'in_progress' && item.currentEpisode === 0) {
    item.currentEpisode = 1;
  }

  saveCollection(collection);
  return item;
}

/**
 * Update media season and episode numbers
 */
export function updateMediaProgress(itemId, season, episode) {
  const collection = getCollection();
  const item = collection.find(i => i.id === itemId);
  if (!item) return null;

  if (season !== undefined) item.currentSeason = Math.max(1, parseInt(season) || 1);
  if (episode !== undefined) {
    const maxEp = item.totalEpisodes || 999;
    item.currentEpisode = Math.max(0, Math.min(maxEp, parseInt(episode) || 0));
  }

  item.updatedAt = new Date().toISOString();
  saveCollection(collection);
  return item;
}

/**
 * Delete item from collection
 */
export function removeMediaFromCollection(itemId) {
  const collection = getCollection();
  const filtered = collection.filter(i => i.id !== itemId);
  saveCollection(filtered);
  return true;
}

/**
 * Calculate progress percentage
 */
export function getProgressPercentage(item) {
  if (item.mediaType === 'movie') {
    return item.status === 'completed' ? 100 : (item.currentEpisode > 0 ? 50 : 0);
  }
  const total = item.totalEpisodes || 1;
  const current = item.currentEpisode || 0;
  return Math.min(100, Math.round((current / total) * 100));
}

/**
 * Export collection data to downloadable JSON file
 */
export function exportDataAsJSON() {
  const collection = getCollection();
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(collection, null, 2));
  const downloadAnchor = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `media_tracker_backup_${dateStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

/**
 * Import collection data from a JSON string or file object
 */
export function importDataFromJSON(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    if (!Array.isArray(parsed)) {
      throw new Error("Format JSON invalide : Un tableau d'éléments est attendu.");
    }

    // Basic schema check
    const isValid = parsed.every(item => item.id && item.title && item.status);
    if (!isValid && parsed.length > 0) {
      throw new Error("Certains éléments du fichier n'ont pas les champs requis (id, title, status).");
    }

    saveCollection(parsed);
    return { success: true, count: parsed.length };
  } catch (error) {
    console.error('Import Error:', error);
    return { success: false, message: error.message || 'Échec de la lecture du fichier JSON.' };
  }
}
