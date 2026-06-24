import { NextRequest, NextResponse } from 'next/server'
import { computeNextRunAtFromInterval, getDueSchedules, updateSchedule } from '@/services/scheduleService'

export const runtime = 'nodejs'

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000'
const CATEGORY_FALLBACKS = ['IT·테크', '여행', '음식·맛집', '재테크', '건강·운동', '자기계발', '리뷰', '이슈·트렌드']

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
  const raw = match?.[1]?.replace(/<[^>]+>/g, ' ').trim() || fallback
  return raw.slice(0, 120) || fallback
}

function extractFirstImageUrl(html: string): string {
  const imgTagMatch = html.match(/<img[^>]+>/i)
  if (!imgTagMatch) return ''

  const srcMatch = imgTagMatch[0].match(/\ssrc\s*=\s*['"]([^'"]+)['"]/i)
  const src = srcMatch?.[1]?.trim() || ''
  if (!src) return ''
  if (/^https?:\/\//i.test(src)) return src
  return ''
}

function selectRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)]
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function getKeywordForSchedule(schedule: any): Promise<{ topic: string; category: string }> {
  const categories = Array.isArray(schedule.categories) && schedule.categories.length > 0
    ? schedule.categories.filter((item: unknown) => typeof item === 'string' && String(item).trim())
    : [schedule.category || CATEGORY_FALLBACKS[0]]

  const categoryIndex = Number(schedule.categoryIndex || 0)
  const category = categories[categoryIndex % categories.length] || CATEGORY_FALLBACKS[0]

  const { res, data } = await fetchJson(`${APP_BASE_URL}/api/keywords?category=${encodeURIComponent(category)}`)
  if (!res.ok || !Array.isArray(data?.keywords) || data.keywords.length === 0) {
    return { topic: category, category }
  }

  const topic = selectRandom(data.keywords) || category
  return { topic, category }
}

async function generatePost(schedule: any, topic: string) {
  const res = await fetch(`${APP_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      tone: schedule.tone || '정보 전달형',
      length: schedule.length || 'medium',
      model: schedule.model || 'llama-3.3-70b-versatile',
      provider: schedule.provider || 'ollama',
      blogType: schedule.blogType || 'general',
      imageCount: 6,
      selectedImages: [],
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `생성 실패 (${res.status})`)
  }

  return data as { html?: string }
}

async function publishToGhost(schedule: any, html: string, title: string, topic: string, category: string) {
  const tags = [category, topic, schedule.blogType || 'general']
  const featureImage = extractFirstImageUrl(html)
  const res = await fetch(`${APP_BASE_URL}/api/ghost/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      html,
      excerpt: stripHtml(html).slice(0, 300),
      tags,
      status: schedule.ghostStatus || 'draft',
      featureImage,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `Ghost 업로드 실패 (${res.status})`)
  }

  return data.post
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('x-schedule-secret') || ''
  const expectedSecret = process.env.SCHEDULE_SECRET || ''
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 401 })
  }

  try {
    const dueSchedules = await getDueSchedules()
    const results: Array<Record<string, unknown>> = []

    for (const [idx, schedule] of dueSchedules.entries()) {
      if (idx > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      try {
        const { topic, category } = await getKeywordForSchedule(schedule)
        const generated = await generatePost(schedule, topic)
        const html = generated.html || ''
        if (!html.trim()) {
          throw new Error('AI 응답이 비어 있습니다.')
        }

        const title = extractTitle(html, topic)
        const post = await publishToGhost(schedule, html, title, topic, category)

        const categories = Array.isArray(schedule.categories) && schedule.categories.length > 0
          ? schedule.categories
          : [schedule.category || category]
        const nextCategoryIndex = (Number(schedule.categoryIndex || 0) + 1) % categories.length
        const nextRunAt = computeNextRunAtFromInterval({
          from: Date.now(),
          intervalHours: schedule.intervalHours || schedule.repeatIntervalHours || schedule.repeatIntervalMinutes / 60,
        })

        if (nextRunAt > 0 && (schedule.repeat || Number(schedule.intervalHours || schedule.repeatIntervalHours || schedule.repeatIntervalMinutes) > 0)) {
          await updateSchedule(schedule.id, {
            runAt: nextRunAt,
            status: 'pending',
            categoryIndex: nextCategoryIndex,
            updatedAt: Date.now(),
            lastError: '',
            result: post,
          })
        } else {
          await updateSchedule(schedule.id, {
            status: 'done',
            updatedAt: Date.now(),
            lastError: '',
            result: post,
          })
        }

        results.push({
          id: schedule.id,
          status: 'ok',
          category,
          topic,
          post,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '예약 처리 중 오류가 발생했습니다.'
        const isRateLimit = /한도|rate.?limit|429|too many/i.test(message)
        const retryDelayMs = isRateLimit ? 10 * 60 * 1000 : 5 * 60 * 1000
        await updateSchedule(schedule.id, {
          status: 'pending',
          runAt: Date.now() + retryDelayMs,
          updatedAt: Date.now(),
          lastError: message,
        })
        results.push({
          id: schedule.id,
          status: 'error',
          error: message,
        })
      }
    }

    return NextResponse.json({ processed: dueSchedules.length, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : '예약 실행 중 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
