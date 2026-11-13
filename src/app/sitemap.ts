import type { MetadataRoute } from 'next'
import { GAMES, GENRE_LIST } from '@/games/registry'
import { absUrl, BASE_PATH } from '@/lib/site'

/** Dynamic sitemap — game pages carry their manifest lastUpdated as lastmod. */
export default function sitemap(): MetadataRoute.Sitemap {
  const gameEntries: MetadataRoute.Sitemap = GAMES.map((g) => ({
    url: absUrl(`${BASE_PATH}/games/${g.slug}`),
    lastModified: new Date(`${g.lastUpdated}T00:00:00Z`),
    changeFrequency: 'weekly',
    priority: 0.9,
  }))

  const categoryEntries: MetadataRoute.Sitemap = GENRE_LIST.map((genre) => ({
    url: absUrl(`${BASE_PATH}/games/category/${genre}`),
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const staticEntries: MetadataRoute.Sitemap = [
    { url: absUrl(`${BASE_PATH}/`), changeFrequency: 'weekly', priority: 1 },
    { url: absUrl(`${BASE_PATH}/games`), changeFrequency: 'weekly', priority: 0.95 },
    { url: absUrl(`${BASE_PATH}/daily`), changeFrequency: 'daily', priority: 0.8 },
    { url: absUrl(`${BASE_PATH}/about`), changeFrequency: 'yearly', priority: 0.4 },
    { url: absUrl(`${BASE_PATH}/help`), changeFrequency: 'monthly', priority: 0.5 },
    { url: absUrl(`${BASE_PATH}/contact`), changeFrequency: 'yearly', priority: 0.3 },
    { url: absUrl(`${BASE_PATH}/terms`), changeFrequency: 'yearly', priority: 0.3 },
    { url: absUrl(`${BASE_PATH}/privacy`), changeFrequency: 'yearly', priority: 0.3 },
  ]

  return [...staticEntries, ...gameEntries, ...categoryEntries]
}
