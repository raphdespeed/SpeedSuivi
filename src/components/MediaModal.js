import { saveMediaItem, updateMediaStatus, updateMediaProgress, removeMediaFromCollection, getCollection } from '../services/storage.js';
import { getMediaDetails } from '../services/tmdb.js';
import { toast } from './Toast.js';

export class MediaModal {
  constructor() {
    this.modalOverlay = null;
    this.activeItem = null;
    this.init();
  }

  init() {
    let overlay = document.getElementById('media-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'media-modal-overlay';
      overlay.className = 'modal-overlay hidden';
      document.body.appendChild(overlay);
    }
    this.modalOverlay = overlay;

    // Close on overlay click outside content
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) {
        this.close();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modalOverlay.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  async open(item, initialStatus = null) {
    this.modalOverlay.innerHTML = `<div class="modal-card loading-state"><div class="spinner"></div></div>`;
    this.modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Enrich with full TMDB details if needed
    let detailedItem = item;
    if (!item.genres || item.genres.length === 0 || !item.seasons) {
      const fullDetails = await getMediaDetails(item.tmdbId || item.id, item.mediaType);
      if (fullDetails) {
        detailedItem = { ...item, ...fullDetails };
      }
    }

    // Check if item is already in saved collection
    const collection = getCollection();
    const existing = collection.find(i => i.id === (item.id || `${item.mediaType}_${item.tmdbId || item.id}`));
    if (existing) {
      detailedItem = { ...detailedItem, ...existing };
    }

    this.activeItem = detailedItem;
    this.render(initialStatus);
  }

  close() {
    this.modalOverlay.classList.add('hidden');
    this.modalOverlay.innerHTML = '';
    document.body.style.overflow = '';
  }

  render(initialStatus = null) {
    const item = this.activeItem;
    const isMovie = item.mediaType === 'movie';
    const collection = getCollection();
    const savedEntry = collection.find(i => i.id === (item.id || `${item.mediaType}_${item.tmdbId || item.id}`));
    
    const currentStatus = savedEntry ? savedEntry.status : (initialStatus || null);
    const currentSeason = savedEntry ? savedEntry.currentSeason : (item.currentSeason || 1);
    const currentEp = savedEntry ? savedEntry.currentEpisode : (item.currentEpisode || (isMovie ? 0 : 0));
    const totalEp = item.totalEpisodes || item.numberOfEpisodes || (isMovie ? 1 : 12);

    const categoryLabels = {
      movie: '🎬 Film',
      series: '📺 Série',
      anime: '🇯🇵 Animé',
      kdrama: '🇰🇷 K-Drama'
    };

    const categoryBadge = categoryLabels[item.category] || categoryLabels.series;

    this.modalOverlay.innerHTML = `
      <div class="modal-card">
        <button class="modal-close-btn" id="modal-close" aria-label="Fermer">&times;</button>
        
        <div class="modal-header-backdrop" style="${item.backdropPath ? `background-image: linear-gradient(to bottom, rgba(11, 13, 18, 0.4), rgba(11, 13, 18, 0.95)), url('${item.backdropPath}')` : ''}">
          <div class="modal-header-content">
            <img class="modal-poster" src="${item.posterPath}" alt="${item.title}" />
            <div class="modal-meta-primary">
              <div class="modal-badges">
                <span class="badge badge-category">${categoryBadge}</span>
                ${item.year ? `<span class="badge badge-year">${item.year}</span>` : ''}
                ${item.voteAverage ? `<span class="badge badge-rating">⭐ ${item.voteAverage}/10</span>` : ''}
              </div>
              <h2 class="modal-title">${item.title}</h2>
              ${item.originalTitle && item.originalTitle !== item.title ? `<p class="modal-original-title">${item.originalTitle}</p>` : ''}
            </div>
          </div>
        </div>

        <div class="modal-body">
          <div class="modal-section">
            <h3 class="section-subtitle">Synopsis</h3>
            <p class="modal-overview">${item.overview || 'Aucun synopsis disponible.'}</p>
          </div>

          ${item.genres && item.genres.length > 0 ? `
            <div class="modal-section">
              <h3 class="section-subtitle">Genres</h3>
              <div class="genres-tags">
                ${item.genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Status & Progression Controls -->
          <div class="modal-section tracker-control-box">
            <h3 class="section-subtitle">Statut de visionnage</h3>
            <div class="status-buttons-group">
              <button class="btn btn-status ${currentStatus === 'in_progress' ? 'active status-in-progress' : ''}" data-status="in_progress">
                🚀 En cours
              </button>
              <button class="btn btn-status ${currentStatus === 'watchlist' ? 'active status-watchlist' : ''}" data-status="watchlist">
                📌 À voir
              </button>
              <button class="btn btn-status ${currentStatus === 'completed' ? 'active status-completed' : ''}" data-status="completed">
                ✅ Terminé
              </button>
            </div>

            ${!isMovie ? `
              <div class="progress-edit-box">
                <div class="progress-input-group">
                  <label for="modal-season-input">Saison :</label>
                  <input type="number" id="modal-season-input" min="1" max="${item.totalSeasons || 99}" value="${currentSeason}" class="input-number" />
                </div>
                <div class="progress-input-group">
                  <label for="modal-episode-input">Épisode vu :</label>
                  <input type="number" id="modal-episode-input" min="0" max="${totalEp}" value="${currentEp}" class="input-number" />
                  <span class="total-ep-label">/ ${totalEp} ép.</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="modal-actions-footer">
            ${savedEntry ? `
              <button class="btn btn-danger" id="modal-delete-btn">
                🗑️ Retirer de ma liste
              </button>
            ` : ''}
            <button class="btn btn-primary" id="modal-save-btn">
              💾 Enregistrer les modifications
            </button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this.modalOverlay.querySelector('#modal-close').addEventListener('click', () => this.close());

    // Status selection
    const statusBtns = this.modalOverlay.querySelectorAll('.btn-status');
    let selectedStatus = currentStatus;

    statusBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        statusBtns.forEach(b => b.classList.remove('active', 'status-in-progress', 'status-watchlist', 'status-completed'));
        selectedStatus = btn.dataset.status;
        btn.classList.add('active', `status-${btn.dataset.status.replace('_', '-')}`);
      });
    });

    // Delete handler
    const deleteBtn = this.modalOverlay.querySelector('#modal-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (savedEntry) {
          removeMediaFromCollection(savedEntry.id);
          toast.show(`"${item.title}" a été retiré de votre liste.`, 'info');
          this.close();
        }
      });
    }

    // Save handler
    this.modalOverlay.querySelector('#modal-save-btn').addEventListener('click', () => {
      const seasonInput = this.modalOverlay.querySelector('#modal-season-input');
      const epInput = this.modalOverlay.querySelector('#modal-episode-input');

      const seasonVal = seasonInput ? parseInt(seasonInput.value) || 1 : 1;
      const epVal = epInput ? parseInt(epInput.value) || 0 : (selectedStatus === 'completed' ? totalEp : 0);

      const targetSt = selectedStatus || 'in_progress';

      saveMediaItem(item, targetSt, {
        currentSeason: seasonVal,
        currentEpisode: epVal
      });

      toast.show(`"${item.title}" mis à jour (${targetSt === 'in_progress' ? 'En cours' : targetSt === 'completed' ? 'Terminé' : 'À voir'})`, 'success');
      this.close();
    });
  }
}
