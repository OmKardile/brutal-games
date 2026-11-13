import type { MetadataRoute } from 'next'
import { absUrl, BASE_PATH } from '@/lib/site'

/**
 * robots.txt — crawlers may index the public arcade; server-only areas
 * (API, admin, rewards, auth) stay out. No cloaking: what users see is what
 * crawlers see.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/rewards', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'],
      },
    ],
    sitemap: absUrl(`${BASE_PATH}/sitemap.xml`),
  }
}
