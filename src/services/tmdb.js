const BASE_URL = 'https://api-speedsuivi.raphdespeed.online/3';
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
export const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
export const PLACEHOLDER_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&auto=format&fit=crop&q=80';

/**
 * Detect precise media category: 'movie' | 'series' | 'anime' | 'kdrama'
 */
export function detectMediaCategory(item) {
  if (item.media_type === 'movie' || (!item.media_type && item.title && !item.name)) {
    return 'movie';
  }

  const originCountries = item.origin_country || item.production_countries?.map(c => c.iso_3166_1) || [];
  const genreIds = item.genre_ids || item.genres?.map(g => g.id) || [];
  const originalLanguage = item.original_language || '';

  // Check if Anime (Japan origin or JP lang + Animation genre)
  const isJapanese = originCountries.includes('JP') || originalLanguage === 'ja';
  const isAnimation = genreIds.includes(16); // Genre ID 16 = Animation
  if (isJapanese && isAnimation) {
    return 'anime';
  }

  // Check if K-Drama (Korea origin or Korean language)
  const isKorean = originCountries.includes('KR') || originalLanguage === 'ko';
  if (isKorean && item.media_type !== 'movie') {
    return 'kdrama';
  }

  // If animation from elsewhere, or standard series
  if (item.media_type === 'tv' || item.name) {
    return isAnimation ? 'anime' : 'series';
  }

  return 'movie';
}

/**
 * Perform TMDB Multi Search (via Nginx Proxy)
 */
export async function searchMulti(query, page = 1) {
  if (!query || !query.trim()) return { results: [], total_pages: 0, total_results: 0 };
  
  try {
    const url = `${BASE_URL}/search/multi?language=fr-FR&query=${encodeURIComponent(query.trim())}&page=${page}&include_adult=false`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    // Filter out person/actor results and process media items
    const filteredResults = data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(formatMediaItem);

    return {
      results: filteredResults,
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results
    };
  } catch (error) {
    console.error('TMDB Search Error:', error);
    return { results: [], total_pages: 0, total_results: 0 };
  }
}

/**
 * Fetch Trending media for recommendations when search is empty (via Nginx Proxy)
 */
export async function getTrendingMedia() {
  try {
    const url = `${BASE_URL}/trending/all/week?language=fr-FR`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    return data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(formatMediaItem);
  } catch (error) {
    console.error('TMDB Trending Error:', error);
    return [];
  }
}

/**
 * Fetch detailed info for a specific media item (Movie or TV via Nginx Proxy)
 */
export async function getMediaDetails(id, mediaType) {
  try {
    const type = (mediaType === 'movie' || mediaType === 'film') ? 'movie' : 'tv';
    const url = `${BASE_URL}/${type}/${id}?language=fr-FR&append_to_response=videos,credits`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    return formatMediaItem({ ...data, media_type: type });
  } catch (error) {
    console.error('TMDB Details Error:', error);
    return null;
  }
}

/**
 * Fetch specific TV season details to get episode list & count (via Nginx Proxy)
 */
export async function getSeasonDetails(tvId, seasonNumber) {
  try {
    const url = `${BASE_URL}/tv/${tvId}/season/${seasonNumber}?language=fr-FR`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`TMDB Season ${seasonNumber} Error:`, error);
    return null;
  }
}

/**
 * Formats a raw TMDB result into a standardized media object
 */
export function formatMediaItem(rawItem) {
  const isMovie = rawItem.media_type === 'movie' || (!rawItem.media_type && rawItem.title);
  const category = detectMediaCategory(rawItem);
  
  const title = rawItem.title || rawItem.name || rawItem.original_title || rawItem.original_name || 'Titre inconnu';
  const originalTitle = rawItem.original_title || rawItem.original_name || '';
  const releaseDate = rawItem.release_date || rawItem.first_air_date || '';
  const year = releaseDate ? releaseDate.substring(0, 4) : 'N/A';
  
  const posterPath = rawItem.poster_path ? `${POSTER_BASE}${rawItem.poster_path}` : PLACEHOLDER_POSTER;
  const backdropPath = rawItem.backdrop_path ? `${BACKDROP_BASE}${rawItem.backdrop_path}` : null;

  return {
    id: rawItem.id,
    tmdbId: rawItem.id,
    mediaType: isMovie ? 'movie' : 'tv',
    category: category, // 'movie' | 'series' | 'anime' | 'kdrama'
    title: title,
    originalTitle: originalTitle,
    overview: rawItem.overview || 'Aucun synopsis disponible.',
    posterPath: posterPath,
    backdropPath: backdropPath,
    releaseDate: releaseDate,
    year: year,
    voteAverage: rawItem.vote_average ? Math.round(rawItem.vote_average * 10) / 10 : null,
    voteCount: rawItem.vote_count || 0,
    genres: rawItem.genres ? rawItem.genres.map(g => g.name) : [],
    // Series / TV specific properties
    numberOfSeasons: rawItem.number_of_seasons || 1,
    numberOfEpisodes: rawItem.number_of_episodes || (isMovie ? 1 : 12),
    seasons: rawItem.seasons ? rawItem.seasons.map(s => ({
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      name: s.name,
      posterPath: s.poster_path ? `${POSTER_BASE}${s.poster_path}` : null
    })) : []
  };
}

/**
 * Returns the language status: 'VF' | 'VF / VOSTFR' | 'VO'
 */
export function getLanguageStatus(item) {
  if (!item) return 'VO';
  const origLang = item.originalLanguage || item.original_language || '';

  if (origLang === 'fr') {
    return 'VF';
  }

  const translationsList = item.translations?.translations || (Array.isArray(item.translations) ? item.translations : null);
  if (translationsList && translationsList.length > 0) {
    const frTrans = translationsList.find(t => t.iso_639_1 === 'fr');
    if (frTrans) {
      return 'VF / VOSTFR';
    }
    return 'VO';
  }

  if (origLang && origLang !== 'fr') {
    return 'VF / VOSTFR';
  }

  return 'VO';
}
