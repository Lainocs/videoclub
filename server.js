require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const {
  LETTERBOXD_USERNAME,
  TMDB_API_KEY,
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Cache en memoire pour eviter de re-scraper/re-interroger TMDb a chaque
// chargement de page. Se rafraichit toutes les CACHE_TTL_MS.
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let filmsCache = { films: [], fetchedAt: 0 };

// ---- Scraping de la watchlist Letterboxd (meme logique que le bot Discord) ----
async function fetchWatchlist(username) {
  const films = [];
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/watchlist/page/${page}/`;
    let html;

    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VideoclubBot/1.0)' },
      });
      html = res.data;
    } catch (err) {
      break; // 404 sur les pages au-dela de la derniere = fin de la watchlist
    }

    const $ = cheerio.load(html);
    const posters = $('[data-target-link][data-item-full-display-name]');

    if (posters.length === 0) break;

    posters.each((_, el) => {
      const slug = $(el).attr('data-target-link');
      const fullTitle = $(el).attr('data-item-full-display-name');
      if (fullTitle && slug) {
        films.push({ fullTitle, slug });
      }
    });

    page += 1;
    if (page > 60) break; // garde-fou
  }

  return films;
}

function parseTitleAndYear(fullTitle) {
  const match = fullTitle.match(/^(.*)\s\((\d{4})\)$/);
  if (match) {
    return { title: match[1].trim(), year: match[2] };
  }
  return { title: fullTitle.trim(), year: null };
}

// ---- Recherche TMDb + recuperation de l'IMDb ID (necessaire pour Stremio) ----
async function enrichWithTmdb(film) {
  const { title, year } = parseTitleAndYear(film.fullTitle);

  try {
    const searchRes = await axios.get('https://api.themoviedb.org/3/search/movie', {
      params: {
        api_key: TMDB_API_KEY,
        query: title,
        language: 'fr-FR',
        ...(year ? { year } : {}),
      },
    });

    const match = searchRes.data.results?.[0];

    if (!match) {
      return {
        title,
        year,
        letterboxdUrl: `https://letterboxd.com${film.slug}`,
        poster: null,
        overview: null,
        rating: null,
        imdbId: null,
      };
    }

    // Appel separe pour recuperer l'IMDb ID (pas inclus dans /search)
    let imdbId = null;
    try {
      const externalRes = await axios.get(
        `https://api.themoviedb.org/3/movie/${match.id}/external_ids`,
        { params: { api_key: TMDB_API_KEY } },
      );
      imdbId = externalRes.data.imdb_id || null;
    } catch (err) {
      imdbId = null;
    }

    return {
      title: match.title || title,
      year: match.release_date ? match.release_date.slice(0, 4) : year,
      letterboxdUrl: `https://letterboxd.com${film.slug}`,
      poster: match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null,
      overview: match.overview || null,
      rating: match.vote_average || null,
      imdbId,
    };
  } catch (err) {
    return {
      title,
      year,
      letterboxdUrl: `https://letterboxd.com${film.slug}`,
      poster: null,
      overview: null,
      rating: null,
      imdbId: null,
    };
  }
}

// ---- Limiteur de concurrence simple pour ne pas spammer TMDb d'un coup ----
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function getFilms() {
  const isStale = Date.now() - filmsCache.fetchedAt > CACHE_TTL_MS;

  if (isStale || filmsCache.films.length === 0) {
    const rawFilms = await fetchWatchlist(LETTERBOXD_USERNAME);
    const enriched = await mapWithConcurrency(rawFilms, 5, enrichWithTmdb);
    if (enriched.length > 0) {
      filmsCache = { films: enriched, fetchedAt: Date.now() };
    }
  }

  return filmsCache.films;
}

app.get('/api/films', async (req, res) => {
  try {
    const films = await getFilms();
    res.json({ films, count: films.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de recuperer la watchlist.' });
  }
});

app.listen(PORT, () => {
  console.log(`Videoclub en ligne sur http://localhost:${PORT}`);
});
