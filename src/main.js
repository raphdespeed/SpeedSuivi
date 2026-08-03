import { HeaderNav } from './components/Header.js';
import { createMediaCardHTML, bindMediaCardEvents } from './components/MediaCard.js';
import { MediaModal } from './components/MediaModal.js';
import { getCollection } from './services/storage.js';
import { searchMulti, getTrendingMedia } from './services/tmdb.js';

class App {
  constructor() {
    this.currentTab = 'in_progress';
    this.currentCategoryFilter = 'all';
    this.searchQuery = '';
    this.searchResults = [];
    this.trendingResults = [];
    this.isLoading = false;
    this.debounceTimer = null;

    this.headerContainer = document.getElementById('app-header-container');
    this.mainContent = document.getElementById('app-main-content');

    this.modal = new MediaModal();
    this.headerNav = null;

    this.init();
  }

  init() {
    // Render Header Navigation
    this.headerNav = new HeaderNav(
      this.headerContainer,
      (newTab) => this.handleTabChange(newTab),
      (query) => this.handleSearchInput(query),
      (filterVal) => this.handleFilterChange(filterVal)
    );

    // Re-render when local storage updates anywhere
    window.addEventListener('storage-updated', () => {
      this.headerNav.updateCounters();
      if (this.currentTab !== 'search') {
        this.renderCurrentView();
      }
    });

    // Render initial view
    this.renderCurrentView();
  }

  handleTabChange(tab) {
    this.currentTab = tab;
    this.renderCurrentView();
  }

  handleFilterChange(filterVal) {
    this.currentCategoryFilter = filterVal;
    this.renderCurrentView();
  }

  handleSearchInput(query) {
    this.searchQuery = query;
    clearTimeout(this.debounceTimer);

    if (!query.trim()) {
      this.searchResults = [];
      this.renderSearchView();
      return;
    }

    this.debounceTimer = setTimeout(async () => {
      this.isLoading = true;
      this.renderSearchView();

      const data = await searchMulti(query);
      this.searchResults = data.results;
      this.isLoading = false;
      this.renderSearchView();
    }, 350);
  }

  filterItemsByCategory(items) {
    if (this.currentCategoryFilter === 'all') return items;
    return items.filter(item => item.category === this.currentCategoryFilter);
  }

  renderCurrentView() {
    switch (this.currentTab) {
      case 'in_progress':
        this.renderLibraryView('in_progress', '🚀 En cours', 'Vos séries, animés et films actuellement en cours de visionnage.');
        break;
      case 'watchlist':
        this.renderLibraryView('watchlist', '📌 À voir', 'Votre liste d\'attente de pépites à découvrir prochainement.');
        break;
      case 'completed':
        this.renderLibraryView('completed', '✅ Terminés', 'Historique complet de tous vos médias visionnés.');
        break;
      case 'search':
        this.renderSearchView();
        break;
    }
  }

  renderLibraryView(statusKey, title, subtitle) {
    const collection = getCollection();
    const itemsOfStatus = collection.filter(i => i.status === statusKey);
    const filteredItems = this.filterItemsByCategory(itemsOfStatus);

    if (filteredItems.length === 0) {
      const categoryNames = {
        all: '',
        series: 'de séries',
        anime: 'd\'animés',
        kdrama: 'de K-Dramas',
        movie: 'de films'
      };

      this.mainContent.innerHTML = `
        <div class="view-header">
          <h2 class="view-title">${title}</h2>
          <p class="view-subtitle">${subtitle}</p>
        </div>

        <div class="empty-state">
          <div class="empty-icon">${statusKey === 'in_progress' ? '🍿' : statusKey === 'watchlist' ? '📌' : '🎉'}</div>
          <h3 class="empty-title">Aucun contenu ${categoryNames[this.currentCategoryFilter]} ici</h3>
          <p class="empty-desc">
            ${statusKey === 'in_progress' 
              ? 'Ajoutez vos séries ou films actuels depuis la recherche pour suivre votre avancée épisode par épisode !' 
              : statusKey === 'watchlist'
              ? 'Explorez le catalogue TMDB et sauvegardez les séries et films à regarder plus tard.'
              : 'Marquez vos contenus comme terminés pour remplir votre historique.'}
          </p>
          <button class="btn btn-primary" id="btn-go-search">
            🔍 Rechercher un média
          </button>
        </div>
      `;

      const searchBtn = this.mainContent.querySelector('#btn-go-search');
      if (searchBtn) {
        searchBtn.addEventListener('click', () => {
          this.headerNav.activeTab = 'search';
          this.headerNav.render();
          this.handleTabChange('search');
        });
      }
      return;
    }

    this.mainContent.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">
          ${title}
          <span class="badge badge-completed">${filteredItems.length} ${filteredItems.length === 1 ? 'élément' : 'éléments'}</span>
        </h2>
        <p class="view-subtitle">${subtitle}</p>
      </div>

      <div class="media-grid" id="library-grid"></div>
    `;

    const grid = this.mainContent.querySelector('#library-grid');
    filteredItems.forEach(item => {
      const cardHTML = createMediaCardHTML(item, 'library');
      const tempWrapper = document.createElement('div');
      tempWrapper.innerHTML = cardHTML.trim();
      const cardNode = tempWrapper.firstChild;

      bindMediaCardEvents(cardNode, item, (selectedItem) => {
        this.modal.open(selectedItem);
      });

      grid.appendChild(cardNode);
    });
  }

  async renderSearchView() {
    this.mainContent.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">🔍 Rechercher sur TMDB</h2>
        <p class="view-subtitle">Trouvez n'importe quel film, série, animé ou K-Drama et ajoutez-le en un clic.</p>
      </div>

      <div class="search-box-container">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input 
            type="text" 
            id="search-input" 
            class="search-input" 
            placeholder="Rechercher par titre (ex: Attack on Titan, Breaking Bad, Inception, Squid Game...)..." 
            value="${this.searchQuery}" 
            autocomplete="off"
            autofocus
          />
          ${this.searchQuery ? `<button class="clear-search-btn" id="clear-search">&times;</button>` : ''}
        </div>
      </div>

      <div id="search-results-container">
        ${this.isLoading ? `<div class="spinner"></div>` : ''}
      </div>
    `;

    const searchInput = this.mainContent.querySelector('#search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
    }

    const clearBtn = this.mainContent.querySelector('#clear-search');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.handleSearchInput('');
      });
    }

    const resultsContainer = this.mainContent.querySelector('#search-results-container');
    if (this.isLoading) return;

    if (this.searchQuery.trim()) {
      const filteredResults = this.filterItemsByCategory(this.searchResults);

      if (filteredResults.length === 0) {
        resultsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🕵️‍♂️</div>
            <h3 class="empty-title">Aucun résultat trouvé</h3>
            <p class="empty-desc">Aucun média ne correspond à "${this.searchQuery}". Essayez un autre mot-clé.</p>
          </div>
        `;
        return;
      }

      resultsContainer.innerHTML = `<div class="media-grid" id="search-grid"></div>`;
      const grid = resultsContainer.querySelector('#search-grid');

      filteredResults.forEach(item => {
        const cardHTML = createMediaCardHTML(item, 'search');
        const tempWrapper = document.createElement('div');
        tempWrapper.innerHTML = cardHTML.trim();
        const cardNode = tempWrapper.firstChild;

        bindMediaCardEvents(cardNode, item, (selectedItem) => {
          this.modal.open(selectedItem);
        });

        grid.appendChild(cardNode);
      });

    } else {
      // Empty search query -> fetch Trending media as recommendations
      if (this.trendingResults.length === 0) {
        this.trendingResults = await getTrendingMedia();
      }

      const filteredTrending = this.filterItemsByCategory(this.trendingResults);

      resultsContainer.innerHTML = `
        <div style="margin-bottom: 16px;">
          <h3 class="section-subtitle" style="font-size: 1.1rem; color: #fff;">🔥 Tendances & Recommandations du moment</h3>
        </div>
        <div class="media-grid" id="trending-grid"></div>
      `;

      const grid = resultsContainer.querySelector('#trending-grid');
      filteredTrending.forEach(item => {
        const cardHTML = createMediaCardHTML(item, 'search');
        const tempWrapper = document.createElement('div');
        tempWrapper.innerHTML = cardHTML.trim();
        const cardNode = tempWrapper.firstChild;

        bindMediaCardEvents(cardNode, item, (selectedItem) => {
          this.modal.open(selectedItem);
        });

        grid.appendChild(cardNode);
      });
    }
  }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
