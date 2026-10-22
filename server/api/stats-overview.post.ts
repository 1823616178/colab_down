import { statsOverview } from '../services/StatsService'

// Dashboard 统计总览
export default defineEventHandler(async (event) => {
  try {
    return ok(await statsOverview())
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
