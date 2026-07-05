/** Rented-machine pricing helpers — shared by the Fly catalog route and the rentals route.
 * We cache the RAW provider cost (server/.data/fly-pricing.json) and apply our margin on top.
 * The MARKUP is never disclosed to the client; it's baked into every price we hand out. */
import { loadJson } from '../repositories/store.mjs'

export const MARKUP = 1.2 // our commission — 20% on top of the raw provider rate

export const withMarkup = (sizes) => sizes.map((s) => ({
  ...s,
  priceSecond: s.priceSecond != null ? s.priceSecond * MARKUP : s.priceSecond,
  priceMonth: s.priceMonth != null ? s.priceMonth * MARKUP : s.priceMonth,
}))

// Look up the RAW (un-marked-up) cached size record by name, for authoritative cost math server-side.
export function rawSize(name) {
  const cache = loadJson('fly-pricing.json', null)
  return (cache?.sizes || []).find((s) => s.name === name) || null
}
