// Generate PWA icons (192 / 512 / maskable-512) from the site logo SVG.
// Same pipeline as og:gen (sharp, no webfont deps). The maskable variant
// pads the glyph into the safe zone (20% inset) on the dark plate.
// Run: bun scripts/gen-pwa-icons.ts   (writes public/icons/*.png)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const OUT = join(ROOT, 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const PLATE = '#0a0a0a'
const GLYPH = '#ef4444'

function logoSvg(size: number, inset: number): string {
  const inner = size - inset * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PLATE}"/>
  <g transform="translate(${inset} ${inset}) scale(${inner / 30})">
    <path fill="${GLYPH}" d="M24.51,28.51H5.49c-2.21,0-4-1.79-4-4V5.49c0-2.21,1.79-4,4-4h19.03c2.21,0,4,1.79,4,4v19.03
      C28.51,26.72,26.72,28.51,24.51,28.51z"/>
    <path fill="#FFFFFF" d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z"/>
    <polygon fill="#FFFFFF" points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1"/>
    <path fill="#FFFFFF" d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z"/>
  </g>
</svg>`
}

async function main(): Promise<void> {
  const targets = [
    { file: 'icon-192.png', size: 192, inset: 24 },
    { file: 'icon-512.png', size: 512, inset: 64 },
    // maskable: glyph inside the 80% safe zone, plate fills the mask area
    { file: 'icon-maskable-512.png', size: 512, inset: 102 },
  ]
  for (const t of targets) {
    const png = await sharp(Buffer.from(logoSvg(t.size, t.inset))).png().toBuffer()
    writeFileSync(join(OUT, t.file), png)
    console.log(`wrote public/icons/${t.file} (${t.size}x${t.size})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
