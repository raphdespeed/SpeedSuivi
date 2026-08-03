import { exportDataAsJSON, importDataFromJSON, getCollection } from '../services/storage.js';
import { toast } from './Toast.js';

export class HeaderNav {
  constructor(container, onTabChange, onSearchQuery, onFilterChange) {
    this.container = container;
    this.onTabChange = onTabChange;
    this.onSearchQuery = onSearchQuery;
    this.onFilterChange = onFilterChange;
    this.activeTab = 'in_progress';
    this.activeCategoryFilter = 'all';
    this.render();
  }

  render() {
    const collection = getCollection();
    const countInProgress = collection.filter(i => i.status === 'in_progress').length;
    const countWatchlist = collection.filter(i => i.status === 'watchlist').length;
    const countCompleted = collection.filter(i => i.status === 'completed').length;

    this.container.innerHTML = `
      <header class="app-header">
        <div class="header-main-bar">
          <div class="logo-container" id="app-logo">
            <div class="logo-icon">🍿</div>
            <h1 class="logo-text">MediaTrack<span class="accent-text">.tv</span></h1>
          </div>

          <!-- Main Desktop Navigation Tabs -->
          <nav class="nav-tabs-desktop">
            <button class="nav-tab ${this.activeTab === 'in_progress' ? 'active' : ''}" data-tab="in_progress">
              <span class="tab-icon">🚀</span>
              <span class="tab-label">En cours</span>
              ${countInProgress > 0 ? `<span class="tab-counter">${countInProgress}</span>` : ''}
            </button>
            <button class="nav-tab ${this.activeTab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">
              <span class="tab-icon">📌</span>
              <span class="tab-label">À voir</span>
              ${countWatchlist > 0 ? `<span class="tab-counter">${countWatchlist}</span>` : ''}
            </button>
            <button class="nav-tab ${this.activeTab === 'completed' ? 'active' : ''}" data-tab="completed">
              <span class="tab-icon">✅</span>
              <span class="tab-label">Terminés</span>
              ${countCompleted > 0 ? `<span class="tab-counter">${countCompleted}</span>` : ''}
            </button>
            <button class="nav-tab ${this.activeTab === 'search' ? 'active' : ''}" data-tab="search">
              <span class="tab-icon">🔍</span>
              <span class="tab-label">Recherche</span>
            </button>
          </nav>

          <!-- Export / Import JSON actions -->
          <div class="header-json-actions">
            <button class="btn btn-sm btn-outline" id="export-json-btn" title="Télécharger mes données JSON">
              📥 Exporter JSON
            </button>
            <label class="btn btn-sm btn-outline btn-file-label" title="Restaurer des données JSON">
              📤 Importer JSON
              <input type="file" id="import-json-input" accept=".json" style="display: none;" />
            </label>
          </div>
        </div>

        <!-- Sub-header Category Filter Pills -->
        <div class="header-sub-bar">
          <div class="category-pills">
            <button class="pill ${this.activeCategoryFilter === 'all' ? 'active' : ''}" data-filter="all">Tous</button>
            <button class="pill ${this.activeCategoryFilter === 'series' ? 'active' : ''}" data-filter="series">📺 Séries</button>
            <button class="pill ${this.activeCategoryFilter === 'anime' ? 'active' : ''}" data-filter="anime">🇯🇵 Animés</button>
            <button class="pill ${this.activeCategoryFilter === 'kdrama' ? 'active' : ''}" data-filter="kdrama">🇰🇷 K-Dramas</button>
            <button class="pill ${this.activeCategoryFilter === 'movie' ? 'active' : ''}" data-filter="movie">🎬 Films</button>
          </div>
        </div>
      </header>

      <!-- Mobile Bottom Navigation Bar -->
      <nav class="mobile-bottom-nav">
        <button class="mobile-nav-btn ${this.activeTab === 'in_progress' ? 'active' : ''}" data-tab="in_progress">
          <span class="nav-icon">🚀</span>
          <span class="nav-text">En cours</span>
          ${countInProgress > 0 ? `<span class="mobile-badge">${countInProgress}</span>` : ''}
        </button>
        <button class="mobile-nav-btn ${this.activeTab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">
          <span class="nav-icon">📌</span>
          <span class="nav-text">À voir</span>
        </button>
        <button class="mobile-nav-btn ${this.activeTab === 'completed' ? 'active' : ''}" data-tab="completed">
          <span class="nav-icon">✅</span>
          <span class="nav-text">Terminés</span>
        </button>
        <button class="mobile-nav-btn ${this.activeTab === 'search' ? 'active' : ''}" data-tab="search">
          <span class="nav-icon">🔍</span>
          <span class="nav-text">Recherche</span>
        </button>
      </nav>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Tab Switching (Desktop & Mobile)
    const tabButtons = this.container.querySelectorAll('[data-tab]');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedTab = btn.dataset.tab;
        this.activeTab = selectedTab;
        this.render();
        this.onTabChange(selectedTab);
      });
    });

    // Logo Click -> Go to main "in_progress" tab
    const logo = this.container.querySelector('#app-logo');
    if (logo) {
      logo.addEventListener('click', () => {
        this.activeTab = 'in_progress';
        this.render();
        this.onTabChange('in_progress');
      });
    }

    // Category Filter Pills
    const filterPills = this.container.querySelectorAll('[data-filter]');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const filterVal = pill.dataset.filter;
        this.activeCategoryFilter = filterVal;
        this.render();
        this.onFilterChange(filterVal);
      });
    });

    // JSON Export Button
    const exportBtn = this.container.querySelector('#export-json-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        exportDataAsJSON();
        toast.show('Exportation JSON réussie ! Le fichier a été téléchargé.', 'success');
      });
    }

    // JSON Import Input
    const importInput = this.container.querySelector('#import-json-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const result = importDataFromJSON(event.target.result);
          if (result.success) {
            toast.show(`Importation réussie ! ${result.count} médias restaurés.`, 'success');
            this.render();
            this.onTabChange(this.activeTab);
          } else {
            toast.show(`Erreur d'importation : ${result.message}`, 'error');
          }
        };
        reader.readAsText(file);
      });
    }
  }

  updateCounters() {
    this.render();
  }
}
