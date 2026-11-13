// Generate 1200x630 OG/Twitter images per game + one for the site.
// Design: dark plate, per-game accent field, huge short name, tagline.
// Fonts: system DejaVu Sans (Bold) — no webfont deps in the build pipeline.
// Run: bun scripts/gen-og-images.ts   (writes public/og/*.png)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const OUT = join(ROOT, 'public', 'og')
mkdirSync(OUT, { recursive: true })

const ACCENTS: Record<string, { main: string; dim: string; hot: string }> = {
  arena: { main: '#ef4444', dim: '#7f1d1d', hot: '#ff6b6b' },
  stack: { main: '#f59e0b', dim: '#92400e', hot: '#fbbf24' },
  reflex: { main: '#22d3ee', dim: '#155e75', hot: '#a5f3fc' },
  dodge: { main: '#c084fc', dim: '#6b21a8', hot: '#e9d5ff' },
  merge: { main: '#a3e635', dim: '#3f6212', hot: '#d9f99d' },
  site: { main: '#ef4444', dim: '#7f1d1d', hot: '#fbbf24' },
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  )
}

function ogSvg(opts: {
  short: string
  title: string
  tagline: string
  accent: { main: string; dim: string; hot: string }
}): string {
  const { short, title, tagline, accent } = opts
  // wrap the tagline to <= 46-char lines
  const words = tagline.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 46) {
      lines.push(cur.trim())
      cur = w
    } else cur += ' ' + w
  }
  if (cur.trim()) lines.push(cur.trim())

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent.main}" stop-opacity="0.28"/>
      <stop offset="0.6" stop-color="${accent.dim}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#0b0b10"/>
  <g stroke="rgba(255,255,255,0.05)" stroke-width="1">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${i * 52.5}" x2="1200" y2="${i * 52.5}"/>`).join('')}
    ${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 52.5}" y1="0" x2="${i * 52.5}" y2="630"/>`).join('')}
  </g>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="14" height="630" fill="${accent.main}"/>
  <text x="70" y="120" font-family="DejaVu Sans" font-size="30" font-weight="bold" letter-spacing="14" fill="${accent.hot}">BRUTAL//GAMES</text>
  <text x="70" y="180" font-family="DejaVu Sans" font-size="20" letter-spacing="6" fill="rgba(255,255,255,0.45)">FREE BROWSER GAME — NO DOWNLOAD</text>
  <text x="64" y="400" font-family="DejaVu Sans" font-size="190" font-weight="bold" letter-spacing="4" fill="#ffffff">${escapeXml(short)}</text>
  ${lines
    .slice(0, 3)
    .map(
      (l, i) =>
        `<text x="70" y="${460 + i * 44}" font-family="DejaVu Sans" font-size="32" fill="rgba(255,255,255,0.78)">${escapeXml(l)}</text>`,
    )
    .join('')}
  <text x="70" y="590" font-family="DejaVu Sans" font-size="20" letter-spacing="4" fill="rgba(255,255,255,0.35)">PLAY FREE AT BRUTAL GAMES — 5 GAMES, ONE ARCADE</text>
</svg>`
}

async function render(name: string, svg: string): Promise<void> {
  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer()
  writeFileSync(join(OUT, `${name}.png`), png)
  console.log(`og/${name}.png  (${(png.length / 1024).toFixed(0)} KB)`)
}

const GAMES: { slug: string; short: string; tagline: string }[] = [
  { slug: 'arena', short: 'ARENA', tagline: 'Twin-stick wave shooter. Draft upgrades, chain kills, survive the boss.' },
  { slug: 'stack', short: 'STACK', tagline: 'One-tap tower stacker. Slice overhangs, chain perfects, regrow the tower.' },
  { slug: 'reflex', short: 'REFLEX', tagline: 'Timing strike. Stop the blade inside the shrinking zone, chain perfects.' },
  { slug: 'dodge', short: 'DODGE', tagline: 'One-button gauntlet. Hold to climb, release to fall, graze for bonuses.' },
  { slug: 'merge', short: 'MERGE', tagline: 'Drop-fuse puzzle. Fuse circles up an 11-tier chain, detonate the singularity.' },
]

async function main(): Promise<void> {
  for (const g of GAMES) {
    await render(
      g.slug,
      ogSvg({ short: g.short, title: g.slug, tagline: g.tagline, accent: ACCENTS[g.slug] }),
    )
  }
  await render(
    'site',
    ogSvg({
      short: 'GAMES',
      title: 'site',
      tagline: 'Five free browser games: shooter, stacker, timing strike, dodger, merge puzzle.',
      accent: ACCENTS.site,
    }),
  )
}

void main()
