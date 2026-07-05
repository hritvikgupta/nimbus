/** Rented-machine records — persisted per project owner (rentals are SHARED across project members,
 * like machines/repairs). One record per "Rent a machine" action. No VM is booted yet; a record
 * starts in `provisioning`. Stored as { [ownerId]: Rental[] } in server/.data/rentals.json. */
import { loadJson, saveJson } from './store.mjs'

const FILE = 'rentals.json'

const all = () => loadJson(FILE, {})
const write = (data) => saveJson(FILE, data)

export function listRentals(owner, projectId) {
  const list = all()[owner] || []
  return projectId ? list.filter((r) => r.projectId === projectId) : list
}

// Every rental across all owners — for the lifecycle scheduler (boot / expire / teardown).
export function listAllRentals() {
  const data = all()
  const out = []
  for (const owner of Object.keys(data)) for (const r of data[owner]) out.push({ owner, rental: r })
  return out
}

export function createRental(owner, rental) {
  const data = all()
  const list = data[owner] || []
  list.unshift(rental)
  data[owner] = list
  write(data)
  return rental
}

export function updateRental(owner, id, patch) {
  const data = all()
  const list = data[owner] || []
  const i = list.findIndex((r) => r.id === id)
  if (i < 0) return null
  list[i] = { ...list[i], ...patch }
  data[owner] = list
  write(data)
  return list[i]
}
