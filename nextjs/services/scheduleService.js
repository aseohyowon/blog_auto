import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.data')
const SCHEDULE_FILE = path.join(DATA_DIR, 'ghost-schedules.json')

export function createScheduleId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeWeekdays(value) {
  if (!Array.isArray(value)) return []

  const weekdays = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)

  return [...new Set(weekdays)].sort((a, b) => a - b)
}

export function computeFirstRunAt({ startTime, from = Date.now() }) {
  const [hourText, minuteText] = String(startTime || '').split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 0
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return 0

  const candidate = new Date(from)
  candidate.setHours(hour, minute, 0, 0)

  if (candidate.getTime() <= from) {
    candidate.setDate(candidate.getDate() + 1)
  }

  return candidate.getTime()
}

export function computeNextRunAtFromInterval({ from = Date.now(), intervalHours }) {
  const hours = Number(intervalHours)
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return from + Math.floor(hours * 60 * 60 * 1000)
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath, data) {
  await ensureDataDir()
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export async function listSchedules() {
  const data = await readJsonFile(SCHEDULE_FILE, { schedules: [] })
  return Array.isArray(data?.schedules) ? data.schedules : []
}

export async function saveSchedule(schedule) {
  const schedules = await listSchedules()
  const next = [schedule, ...schedules.filter((item) => item.id !== schedule.id)]
  await writeJsonFile(SCHEDULE_FILE, { schedules: next })
  return schedule
}

export async function updateSchedule(id, patch) {
  const schedules = await listSchedules()
  const next = schedules.map((item) => (item.id === id ? { ...item, ...patch } : item))
  await writeJsonFile(SCHEDULE_FILE, { schedules: next })
  return next.find((item) => item.id === id) ?? null
}

export async function removeSchedule(id) {
  const schedules = await listSchedules()
  const next = schedules.filter((item) => item.id !== id)
  await writeJsonFile(SCHEDULE_FILE, { schedules: next })
}

export async function getDueSchedules(now = Date.now()) {
  const schedules = await listSchedules()
  return schedules.filter((item) => {
    if (item.status !== 'pending') return false
    const runAt = Number(item.runAt || 0)
    return runAt > 0 && runAt <= now
  })
}
