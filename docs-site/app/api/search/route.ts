import { source } from '@/lib/docs-source'
import { createFromSource } from 'fumadocs-core/search/server'

// Static export: build a static search index (client-side search) instead of a server route.
export const revalidate = false
export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
})
