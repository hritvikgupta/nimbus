import { Cost } from '../components/sections/index.jsx'

// The COST tab fetches ACTUAL spend from the cloud billing APIs (Cost Explorer / BigQuery export)
// via /api/cost — it manages its own data, so no props needed.
export default function CostPage() {
  return <Cost />
}
