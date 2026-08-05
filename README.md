# 🍿 SpeedSuivi - Suivi de Films, Séries, Animés & K-Dramas

🚀 **Application disponible en ligne :** [https://raphdespeed.github.io/SpeedSuivi/](https://raphdespeed.github.io/SpeedSuivi/)

![SpeedSuivi Preview](assets/preview.png)

**SpeedSuivi** est une application Web moderne, fluide et réactive conçue pour suivre facilement l'avancement de vos séries, animés, K-Dramas et films préférés.

---

## ✨ Fonctionnalités Principales

- **⚡ Application Web Standalone (100% Statique) :** 
  Déployée sous la forme d'un fichier `index.html` autonome. Aucun serveur ou installation requis : elle s'exécute directement dans n'importe quel navigateur !

- **🔍 Recherche Globale Tolérante :**
  Barre de recherche réactive avec système anti-perte de focus (debounce 300ms) pour trouver instantanément n'importe quel film ou série, même avec des fautes de frappe (*ex: "quenn" trouvera "Queen Woo"*).

- **📊 Dashboard & Gestion du Visionnage :**
  - 🚀 **En cours :** Suivi prioritaire avec boutons d'incrémentation `+` et `-` de l'épisode vu et barre de progression dynamique en pourcentage (%).
  - 📌 **À voir :** Liste d'attente des contenus à découvrir.
  - ✅ **Terminés :** Historique complet des œuvres entièrement visionnées.
  - 🔄 **À revoir :** Section dédiée aux coups de cœur et médias à re-visionner.

- **📺 Plateformes de Streaming en France :**
  Affichage des logos des plateformes de streaming disponibles en France (*Netflix, Disney+, Prime Video, Crunchyroll, Paramount+*) et filtres rapides par plateforme.

- **🇰🇷 Détection Automatique des K-Dramas & Animés :**
  Filtrage précis identifiant automatiquement les K-Dramas coréens et les animés japonais avec des badges de couleur dédiés.

- **🔽 Pagination & Scroll Infini :**
  Chargement dynamique des résultats lors du défilement vers le bas de la page.

- **💡 Fiche Détaillée & Recommandations :**
  Consultez le synopsis, la note ⭐, l'année de sortie, les plateformes disponibles et découvrez une sélection de **Titres similaires et recommandations** au bas de la fiche.

---

## 🚀 Installation & Utilisation

Vous pouvez utiliser l'application de deux manières très simples :

1. **Accès direct en ligne :**
   Rendez-vous simplement sur [https://raphdespeed.github.io/SpeedSuivi/](https://raphdespeed.github.io/SpeedSuivi/).

2. **Utilisation locale :**
   Double-cliquez simplement sur le fichier [`index.html`](index.html) pour ouvrir l'application dans n'importe quel navigateur (Chrome, Firefox, Edge, Safari).

---

## 💾 Gestion des Données (Import / Export JSON)

SpeedSuivi sauvegarde automatiquement l'intégralité de vos séries, épisodes et statuts directement dans le stockage local de votre navigateur (`localStorage`).

### 📥 Exporter ses données
1. Cliquez sur le bouton **📥 Exporter JSON** situé en haut à droite dans le header.
2. Un fichier horodaté du type `speedsuivi_backup_YYYY-MM-DD.json` sera immédiatement téléchargé sur votre appareil.
3. Ce fichier contient une sauvegarde complète et lisible de l'ensemble de votre collection.

### 📤 Importer une sauvegarde
1. Cliquez sur le bouton **📤 Importer JSON** dans le header.
2. Sélectionnez un fichier `.json` de sauvegarde SpeedSuivi sur votre machine.
3. Vos séries, films et avancements d'épisodes seront instantanément restaurés et synchronisés dans l'application !

---

## 🛠️ Technologies Utilisées

- **HTML5** (Structure sémantique)
- **CSS3 & Tailwind CSS (CDN)** (Design moderne dark mode et effets de verre poli)
- **JavaScript & Vue 3 (CDN Standalone)** (Réactivité dynamique sans build step)

---

© 2026 **SpeedSuivi** - Développé avec passion pour le suivi de médias.
