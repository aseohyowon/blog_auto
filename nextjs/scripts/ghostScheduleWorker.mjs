const BASE_URL = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000'
const SECRET = process.env.SCHEDULE_SECRET || ''
const INTERVAL_MS = Number(process.env.SCHEDULE_POLL_INTERVAL_MS || 60000)

async function runOnce() {
  try {
    const res = await fetch(`${BASE_URL}/api/ghost/schedule/run`, {
      method: 'POST',
      headers: SECRET ? { 'x-schedule-secret': SECRET } : {},
    })
    const data = await res.json().catch(() => ({}))
    const processed = Number(data.processed || 0)
    console.log(`[ghost-scheduler] processed=${processed}`)
    if (!res.ok && data?.error) {
      console.error('[ghost-scheduler] error:', data.error)
    }
  } catch (error) {
    console.error('[ghost-scheduler] request failed:', error?.message || error)
  }
}

console.log(`[ghost-scheduler] polling ${BASE_URL} every ${Math.round(INTERVAL_MS / 1000)}s`)
await runOnce()
setInterval(() => {
  void runOnce()
}, INTERVAL_MS)
