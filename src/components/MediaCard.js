import { updateEpisodeCount, updateMediaStatus, saveMediaItem, getProgressPercentage, getCollection } from '../services/storage.js';
import { toast } from './Toast.js';

/**
 * Creates HTML card string or DOM node for a media item
 */
export function createMediaCardHTML(item, viewContext = 'library', onOpenModal = null) {
  const isMovie = item.mediaType === 'movie';
  const progressPercent = getProgressPercentage(item);

  const categoryLabels = {
    movie: '🎬 Film',
    series: '📺 Série',
    anime: '🇯🇵 Animé',
    kdrama: '🇰🇷 K-Drama'
  };

  const categoryBadge = categoryLabels[item.category] || categoryLabels.series;
  
  // Check if item already saved in user collection
  const collection = getCollection();
  const savedEntry = collection.find(i => i.id === (item.id || `${item.mediaType}_${item.tmdbId || item.id}`));
  const currentStatus = savedEntry ? savedEntry.status : (item.status || null);

  const currentEp = savedEntry ? savedEntry.currentEpisode : (item.currentEpisode || 0);
  const currentSeason = savedEntry ? savedEntry.currentSeason : (item.currentSeason || 1);
  const totalEp = item.totalEpisodes || item.numberOfEpisodes || (isMovie ? 1 : 12);

  return `
    <div class="media-card" data-id="${item.id}" data-tmdb-id="${item.tmdbId || item.id}" data-media-type="${item.mediaType}">
      <div class="card-poster-wrapper">
        <img class="card-poster" src="${item.posterPath}" alt="${item.title}" loading="lazy" />
        <div class="card-badges">
          <span class="badge badge-category badge-${item.category}">${categoryBadge}</span>
          ${item.year ? `<span class="badge badge-year">${item.year}</span>` : ''}
          ${item.voteAverage ? `<span class="badge badge-rating">⭐ ${item.voteAverage}</span>` : ''}
        </div>

        <div class="poster-overlay" data-action="open-modal">
          <button class="btn-icon-overlay" aria-label="Voir détails">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </button>
        </div>
      </div>

      <div class="card-info">
        <h3 class="card-title" title="${item.title}">${item.title}</h3>

        ${currentStatus === 'in_progress' && !isMovie ? `
          <!-- Counter & Progress for IN_PROGRESS series/anime/kdrama -->
          <div class="card-progress-section">
            <div class="season-ep-info">
              <span class="season-badge">S${currentSeason}</span>
              <span class="ep-count-text">Ép. ${currentEp} / ${totalEp}</span>
            </div>
            
            <div class="progress-bar-container" title="${progressPercent}% de visionnage">
              <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div class="progress-percentage-label">${progressPercent}%</div>

            <!-- Quick + and - buttons for UX priority -->
            <div class="card-counter-controls">
              <button class="btn-counter btn-minus" data-action="decrement" aria-label="Décrémenter épisode">-</button>
              <button class="btn-counter btn-plus" data-action="increment" aria-label="Incrémenter épisode">+</button>
              <button class="btn-counter-complete" data-action="mark-complete" title="Marquer comme Terminé">
                ✓ Terminé
              </button>
            </div>
          </div>
        ` : ''}

        ${currentStatus === 'in_progress' && isMovie ? `
          <div class="card-progress-section">
            <div class="progress-bar-container" title="${progressPercent}%">
              <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div class="card-counter-controls" style="margin-top: 8px;">
              <button class="btn-counter-complete" data-action="mark-complete" title="Marquer comme Terminé" style="width: 100%;">
                ✓ Marquer comme vu
              </button>
            </div>
          </div>
        ` : ''}

        ${currentStatus === 'watchlist' ? `
          <div class="card-watchlist-actions">
            <button class="btn btn-sm btn-primary" data-action="start-watching">
              🚀 Commencer
            </button>
            <button class="btn btn-sm btn-secondary" data-action="mark-complete">
              ✓ Terminé
            </button>
          </div>
        ` : ''}

        ${currentStatus === 'completed' ? `
          <div class="card-completed-info">
            <span class="badge badge-completed">✓ Visionné (${totalEp} ép.)</span>
          </div>
        ` : ''}

        ${viewContext === 'search' ? `
          <div class="card-search-actions">
            ${currentStatus ? `
              <button class="btn btn-sm btn-outline status-active-indicator" data-action="open-modal">
                ✓ ${currentStatus === 'in_progress' ? 'En cours' : currentStatus === 'completed' ? 'Terminé' : 'À voir'}
              </button>
            ` : `
              <button class="btn btn-sm btn-primary" data-action="add-in-progress" title="Ajouter à En cours">
                + En cours
              </button>
              <button class="btn btn-sm btn-secondary" data-action="add-watchlist" title="Ajouter à À voir">
                + À voir
              </button>
            `}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Attach event handlers to card element
 */
export function bindMediaCardEvents(cardElement, item, onOpenModal) {
  const itemId = item.id || `${item.mediaType}_${item.tmdbId || item.id}`;

  cardElement.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) {
      // If clicking card body (outside buttons), open modal
      if (!e.target.closest('button')) {
        onOpenModal(item);
      }
      return;
    }

    const action = actionBtn.dataset.action;

    switch (action) {
      case 'open-modal':
        onOpenModal(item);
        break;

      case 'increment':
        {
          const updated = updateEpisodeCount(itemId, 1);
          if (updated) {
            toast.show(`"${updated.title}" : Épisode ${updated.currentEpisode} / ${updated.totalEpisodes}`, 'success');
          }
        }
        break;

      case 'decrement':
        {
          const updated = updateEpisodeCount(itemId, -1);
          if (updated) {
            toast.show(`"${updated.title}" : Épisode ${updated.currentEpisode} / ${updated.totalEpisodes}`, 'info');
          }
        }
        break;

      case 'mark-complete':
        {
          const updated = updateMediaStatus(itemId, 'completed');
          if (updated) {
            toast.show(`"${updated.title}" marqué comme Terminé ! 🎉`, 'success');
          }
        }
        break;

      case 'start-watching':
      case 'add-in-progress':
        {
          const updated = saveMediaItem(item, 'in_progress');
          toast.show(`"${updated.title}" ajouté dans "En cours" 🚀`, 'success');
        }
        break;

      case 'add-watchlist':
        {
          const updated = saveMediaItem(item, 'watchlist');
          toast.show(`"${updated.title}" ajouté dans "À voir" 📌`, 'info');
        }
        break;
    }
  });
}
