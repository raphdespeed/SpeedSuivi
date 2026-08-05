const BASE_URL = 'https://api-speedsuivi.raphdespeed.online/3';
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
export const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
export const PLACEHOLDER_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&auto=format&fit=crop&q=80';

const SAGA_KEYWORDS = [
  'harry potter', 'star wars', 'seigneur des anneaux', 'lord of the rings',
  'fast & furious', 'fast and furious', 'marvel', 'avengers', 'spider-man',
  'spiderman', 'batman', 'pirates des caraïbes', 'pirates of the caribbean',
  'james bond', 'jurassic', 'indiana jones', 'matrix', 'hunger games',
  'twilight', 'mission: impossible', 'mission impossible', 'x-men',
  'alien', 'terminator', 'john wick', 'transformers', 'shrek',
  'toy story', 'l\'âge de glace', 'ice age', 'planète des singes',
  'planet of the apes', 'conjuring', 'mad max', 'die hard', 'saw',
  'resident evil', 'divergente', 'maze runner', 'le labyrinthe', 'the hobbit',
  'le hobbit', 'despicable me', 'moi, moche et méchant', 'minions',
  'le parrain', 'the godfather', 'back to the future', 'retour vers le futur',
  'dune', 'game of thrones', 'house of the dragon'
];

/**
 * Detect precise media category: 'movie' | 'series' | 'saga' | 'anime' | 'kdrama'
 */
export function detectMediaCategory(item) {
  if (item.category === 'saga' || item.isSaga) return 'saga';

  const hasCollection = !!(item.belongs_to_collection || item.belongsToCollection || item.collectionName || item.belongs_to_collection?.id);
  const titleLower = (item.title || item.name || item.original_title || item.original_name || '').toLowerCase();
  
  const isSagaTitle = SAGA_KEYWORDS.some(kw => titleLower.includes(kw));
  if (hasCollection || isSagaTitle) {
    return 'saga';
  }

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
    const url = `${BASE_URL}/${type}/${id}?language=fr-FR&append_to_response=credits,aggregate_credits,videos,images&include_image_language=fr,null,en`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    // Fallback: If no valid YouTube video in append_to_response, query /videos with and without language restriction
    const hasYouTubeVideo = data.videos?.results?.some(v => v && v.site === 'YouTube' && v.key);
    if (!hasYouTubeVideo) {
      try {
        let vUrl = `${BASE_URL}/${type}/${id}/videos?include_video_language=fr,en,null`;
        let vRes = await fetch(vUrl);
        let vData = await vRes.json();
        if (!vData.results || vData.results.length === 0) {
          // Direct emergency request without any language filter
          vUrl = `${BASE_URL}/${type}/${id}/videos`;
          vRes = await fetch(vUrl);
          vData = await vRes.json();
        }
        if (vData.results && vData.results.length > 0) {
          data.videos = vData;
        }
      } catch (ve) {
        console.warn('Exhaustive videos fallback error:', ve);
      }
    }

    return formatMediaItem({ ...data, media_type: type });
  } catch (error) {
    console.error('TMDB Details Error:', error);
    return null;
  }
}

/**
 * Fetch detailed info for a person / actor (via Nginx Proxy)
 */
export async function getPersonDetails(personId) {
  try {
    const url = `${BASE_URL}/person/${personId}?language=fr-FR&append_to_response=combined_credits,external_ids`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    const rawCast = data.combined_credits?.cast || [];
    const uniqueMap = new Map();
    rawCast.forEach(item => {
      if (item && item.poster_path) {
        const key = `${item.media_type || 'tv'}_${item.id}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        }
      }
    });

    const sortedFilmography = Array.from(uniqueMap.values())
      .sort((a, b) => {
        const dateStrA = a.release_date || a.first_air_date || '';
        const dateStrB = b.release_date || b.first_air_date || '';
        if (!dateStrA && !dateStrB) return 0;
        if (!dateStrA) return 1;
        if (!dateStrB) return -1;
        return new Date(dateStrB).getTime() - new Date(dateStrA).getTime();
      })
      .map(formatMediaItem);

    const famousWorks = [...rawCast]
      .filter(item => item && item.poster_path)
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 10)
      .map(formatMediaItem);

    const genderMap = { 1: 'Femme', 2: 'Homme' };

    return {
      id: data.id,
      name: data.name,
      biography: data.biography || 'Aucune biographie disponible.',
      birthday: data.birthday,
      deathday: data.deathday,
      placeOfBirth: data.place_of_birth,
      gender: genderMap[data.gender] || 'Non spécifié',
      knownForDepartment: data.known_for_department || 'Interprétation',
      totalCredits: rawCast.length,
      profilePath: data.profile_path ? `https://image.tmdb.org/t/p/w500${data.profile_path}` : null,
      famousWorks: famousWorks,
      filmography: sortedFilmography
    };
  } catch (error) {
    console.error('TMDB Person Details Error:', error);
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

  // Extract Cast (Top 20 actors/actresses) - Support for TV aggregate_credits
  const rawCast = rawItem.aggregate_credits?.cast || rawItem.credits?.cast || rawItem.cast || [];
  const castList = rawCast.slice(0, 20).map(actor => {
    let charName = actor.character;
    if (!charName && actor.roles && actor.roles.length > 0) {
      charName = actor.roles.map(r => r.character).filter(Boolean).join(' / ');
    }
    return {
      id: actor.id,
      name: actor.name,
      character: charName || 'Rôle inconnu',
      profilePath: actor.profile_path ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : null
    };
  });

  // Extract Official YouTube Trailer Key (Exhaustive Priority: Trailer VF > Trailer VO > Any Trailer > Teaser VF > Teaser VO > Any Teaser > Clip/Featurette > Any YouTube Video)
  const videoResults = rawItem.videos?.results || [];
  const youtubeVideos = videoResults.filter(v => v && v.site === 'YouTube' && v.key);
  let selectedTrailer = 
    youtubeVideos.find(v => v.type === 'Trailer' && v.iso_639_1 === 'fr') ||
    youtubeVideos.find(v => v.type === 'Trailer' && (v.iso_639_1 === 'en' || !v.iso_639_1)) ||
    youtubeVideos.find(v => v.type === 'Trailer') ||
    youtubeVideos.find(v => v.type === 'Teaser' && v.iso_639_1 === 'fr') ||
    youtubeVideos.find(v => v.type === 'Teaser' && (v.iso_639_1 === 'en' || !v.iso_639_1)) ||
    youtubeVideos.find(v => v.type === 'Teaser') ||
    youtubeVideos.find(v => v.type === 'Clip' || v.type === 'Featurette' || v.type === 'Behind the Scenes') ||
    youtubeVideos[0];
  const trailerKey = selectedTrailer ? selectedTrailer.key : null;

  // Extract Photo Gallery Backdrops (HD 6 to 8 images)
  const rawBackdrops = rawItem.images?.backdrops || [];
  const galleryImages = rawBackdrops.slice(0, 8).map(img => ({
    full: `https://image.tmdb.org/t/p/w1280${img.file_path}`,
    thumb: `https://image.tmdb.org/t/p/w780${img.file_path}`
  }));

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
    cast: castList,
    trailerKey: trailerKey,
    galleryImages: galleryImages,
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
 * Discover media with custom TMDB provider, genre, year, and type filters
 */
export async function discoverMedia(options = {}) {
  const {
    category = 'all', // 'all' | 'series' | 'anime' | 'kdrama' | 'movie'
    providerId = null,
    genreId = 'all',
    year = 'all',
    page = 1
  } = options;

  let movieUrl = '';
  let tvUrl = '';

  const providerParam = providerId ? `&with_watch_providers=${providerId}&watch_region=FR` : '';
  
  const genreParams = [];
  if (genreId && genreId !== 'all') {
    genreParams.push(genreId);
  }
  if (category === 'anime') {
    if (!genreParams.includes(16) && !genreParams.includes('16')) {
      genreParams.push(16);
    }
  }

  const genreString = genreParams.length > 0 ? `&with_genres=${genreParams.join(',')}` : '';
  const movieYearParam = year && year !== 'all' ? `&primary_release_year=${year}` : '';
  const tvYearParam = year && year !== 'all' ? `&first_air_date_year=${year}` : '';

  const shouldFetchMovies = category === 'all' || category === 'movie' || category === 'anime';
  const shouldFetchTV = category === 'all' || category === 'series' || category === 'anime' || category === 'kdrama';

  if (category === 'kdrama') {
    if (shouldFetchTV) {
      tvUrl = `${BASE_URL}/discover/tv?with_origin_country=KR&with_original_language=ko&language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${genreString}${tvYearParam}`;
    }
    if (shouldFetchMovies) {
      movieUrl = `${BASE_URL}/discover/movie?with_origin_country=KR&with_original_language=ko&language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${genreString}${movieYearParam}`;
    }
  } else if (category === 'anime') {
    if (shouldFetchTV) {
      tvUrl = `${BASE_URL}/discover/tv?with_genres=16&with_origin_country=JP&language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${tvYearParam}`;
    }
    if (shouldFetchMovies) {
      movieUrl = `${BASE_URL}/discover/movie?with_genres=16&with_origin_country=JP&language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${movieYearParam}`;
    }
  } else {
    if (shouldFetchMovies) {
      movieUrl = `${BASE_URL}/discover/movie?language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${genreString}${movieYearParam}`;
    }
    if (shouldFetchTV) {
      tvUrl = `${BASE_URL}/discover/tv?language=fr-FR&sort_by=popularity.desc&page=${page}${providerParam}${genreString}${tvYearParam}`;
    }
  }

  if (movieUrl) console.log('TMDB Discover Movie URL:', movieUrl);
  if (tvUrl) console.log('TMDB Discover TV URL:', tvUrl);

  const fetches = [];
  if (movieUrl) {
    fetches.push(
      fetch(movieUrl)
        .then(r => r.ok ? r.json() : { results: [], total_pages: 1 })
        .catch(err => {
          console.error('TMDB Discover Movie Fetch Error:', err);
          return { results: [], total_pages: 1 };
        })
    );
  } else {
    fetches.push(Promise.resolve({ results: [], total_pages: 1 }));
  }

  if (tvUrl) {
    fetches.push(
      fetch(tvUrl)
        .then(r => r.ok ? r.json() : { results: [], total_pages: 1 })
        .catch(err => {
          console.error('TMDB Discover TV Fetch Error:', err);
          return { results: [], total_pages: 1 };
        })
    );
  } else {
    fetches.push(Promise.resolve({ results: [], total_pages: 1 }));
  }

  const [movieData, tvData] = await Promise.all(fetches);
  const totalPages = Math.max(movieData.total_pages || 1, tvData.total_pages || 1);

  const movies = (movieData.results || []).map(i => formatMediaItem({ ...i, media_type: 'movie' }));
  const tvs = (tvData.results || []).map(i => formatMediaItem({ ...i, media_type: 'tv' }));

  const combined = [];
  const maxLen = Math.max(movies.length, tvs.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < movies.length) combined.push(movies[i]);
    if (i < tvs.length) combined.push(tvs[i]);
  }

  return {
    results: combined,
    totalPages: totalPages
  };
}
