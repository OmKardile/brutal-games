// Content registry — maps slugs to their unique SEO copy. Server-safe.

import { content as arena } from './arena/content'
import { content as stack } from './stack/content'
import { content as reflex } from './reflex/content'
import { content as dodge } from './dodge/content'
import { content as merge } from './merge/content'
import type { GameSlug } from './types'

export interface GameContent {
  description: string
  howToExtra: string
  tips: string[]
  faq: { q: string; a: string }[]
}

export const CONTENT: Record<GameSlug, GameContent> = {
  arena,
  stack,
  reflex,
  dodge,
  merge,
}
