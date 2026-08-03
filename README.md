# 🍿 SpeedSuivi - Suivi de Films, Séries, Animés & K-Dramas

![SpeedSuivi Preview](assets/preview.png)

**SpeedSuivi** est une application Web moderne, fluide et réactive conçue pour suivre facilement l'avancement de vos séries, animés, K-Dramas et films en temps réel grâce à l'API **TMDB** via un proxy Nginx sécurisé.

---

## ✨ Fonctionnalités Principales

- **⚡ Application Web Standalone (100% Statique) :** 
  Déployée sous la forme d'un fichier `index.html` autonome. Aucun serveur Node.js ou `npm run dev` requis pour l'exécuter : un simple double-clic sur `index.html` suffit pour lancer l'application !

- **🔍 Recherche Globale Tolérante (Fuzzy Search TMDB) :**
  Barre de recherche réactive avec système anti-perte de focus et débogage (debounce 300ms) interrogeant le catalogue TMDB. Elle gère automatiquement les fautes de frappe (*ex: "quenn" trouvera "Queen Woo"*).

- **📊 Dashboard & Gestion du Visionnage :**
  - 🚀 **En cours :** Suivi prioritaire avec boutons d'incrémentation `+` et `-` de l'épisode vu et barre de progression dynamique en pourcentage (%).
  - 📌 **À voir :** Liste d'attente des contenus à découvrir.
  - ✅ **Terminés :** Historique complet des œuvres entièrement visionnées.
  - 🔄 **À revoir :** Section dédiée aux coups de cœur et médias à réadapter/re-visionner.

- **📺 Plateformes de Streaming en France (Watch Providers) :**
  Affichage automatique des logos des plateformes de streaming disponibles en France (*Netflix, Disney+, Prime Video, Crunchyroll, Paramount+*) sur les fiches et filtres rapides par plateforme.

- **🇰🇷 Détection Automatique des K-Dramas & Animés :**
  Filtrage précis identifiant automatiquement les K-Dramas coréens et les animés japonais avec des badges de couleur dédiés.

- **🔽 Pagination & Scroll Infini :**
  Chargement automatique des pages suivantes lors du défilement vers le bas de la page.

- **💡 Modal Détaillée & Carrousel de Recommandations :**
  Consultez le synopsis, la note ⭐, l'année de sortie, les plateformes disponibles et parcourez une sélection de **Titres similaires et recommandations TMDB** au bas de la fiche.

- **🔒 Proxy Reverse Nginx Sécurisé :**
  Toutes les requêtes transitent par le sous-domaine proxy `https://api-speedsuivi.raphdespeed.online/3` avec injection de clé serveur, garantissant qu'aucune clé API privée ne soit exposée dans le code JavaScript du navigateur.

---

## 🚀 Installation & Utilisation

Aucune installation complexe n'est nécessaire !

1. **Directement depuis votre navigateur :**
   Double-cliquez simplement sur le fichier [`index.html`](index.html) pour ouvrir l'application dans n'importe quel navigateur (Chrome, Firefox, Edge, Safari).

2. **Via un serveur local (optionnel) :**
   Vous pouvez également servir le dossier avec `npx serve` ou l'extension *Live Server* de VS Code.

---

## 💾 Gestion des Données (Import / Export JSON)

SpeedSuivi sauvegarde automatiquement l'intégralité de vos séries, épisodes et statuts dans le stockage local de votre navigateur (`localStorage`).

### 📥 Exporter ses données
1. Cliquez sur le bouton **📥 Exporter JSON** situé en haut à droite du header.
2. Un fichier horodaté du type `speedsuivi_backup_YYYY-MM-DD.json` sera immédiatement téléchargé sur votre ordinateur.
3. Ce fichier contient une sauvegarde complète et lisible de l'ensemble de votre collection.

### 📤 Importer une sauvegarde
1. Cliquez sur le bouton **📤 Importer JSON** dans le header.
2. Sélectionnez un fichier `.json` de sauvegarde SpeedSuivi sur votre machine.
3. Vos séries, films et avancements d'épisodes seront instantanément restaurés et synchronisés dans l'application !

---

## 🛠️ Technologies Utilisées

- **HTML5 & CSS3 Vanilla**
- **Tailwind CSS (CDN)** pour le design dark mode moderne et le verre poli (glassmorphism).
- **Vue 3 (CDN Standalone)** pour la réactivité sans build step.
- **TMDB API via Nginx Proxy** pour la récupération dynamique des métadonnées et visuels HD.

---

© 2026 **SpeedSuivi** - Développé avec passion pour le suivi de médias.
