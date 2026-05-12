import { NextRequest, NextResponse } from 'next/server'
import { computeFirstRunAt, createScheduleId, saveSchedule, listSchedules, removeSchedule } from '@/services/scheduleService'

export const runtime = 'nodejs'

const DEFAULT_CATEGORIES = ['IT·테크', '여행', '음식·맛집', '재테크', '건강·운동', '자기계발', '리뷰', '이슈·트렌드']

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

export async function GET() {
  const schedules = await listSchedules()
  return NextResponse.json({ schedules })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      runAt?: unknown
      startTime?: unknown
      intervalHours?: unknown
      status?: unknown
      provider?: unknown
      model?: unknown
      tone?: unknown
      length?: unknown
      blogType?: unknown
      ghostStatus?: unknown
      category?: unknown
      categories?: unknown
      repeat?: unknown
      repeatIntervalMinutes?: unknown
      titlePrefix?: unknown
      useRandomKeyword?: unknown
    }

    const startTime = typeof body.startTime === 'string' ? body.startTime.trim() : ''
    const intervalHours = Math.max(1, Number(body.intervalHours || 0) || 0)

    let runAt = typeof body.runAt === 'string' || typeof body.runAt === 'number' ? new Date(body.runAt).getTime() : 0
    if ((!runAt || Number.isNaN(runAt) || runAt <= Date.now()) && startTime) {
      runAt = computeFirstRunAt({ startTime, from: Date.now() })
    }

    if (!runAt || Number.isNaN(runAt) || runAt <= Date.now()) {
      return NextResponse.json({ error: '예약 시간을 현재보다 미래로 지정해주세요.' }, { status: 400 })
    }

    const categories = toStringArray(body.categories)
    const category = typeof body.category === 'string' ? body.category.trim() : ''
    const provider = typeof body.provider === 'string' ? body.provider : 'groq'
    const model = typeof body.model === 'string' ? body.model : 'llama-3.3-70b-versatile'
    const tone = typeof body.tone === 'string' ? body.tone : '정보 전달형'
    const length = typeof body.length === 'string' ? body.length : 'medium'
    const blogType = typeof body.blogType === 'string' ? body.blogType : 'general'
    const ghostStatus = body.ghostStatus === 'published' ? 'published' : 'draft'
    const repeat = Boolean(body.repeat)
    const repeatIntervalMinutes = Math.max(15, Math.floor(Number(body.repeatIntervalMinutes || 0) || 0))
    const titlePrefix = typeof body.titlePrefix === 'string' ? body.titlePrefix.trim() : ''
    const useRandomKeyword = body.useRandomKeyword !== false

    const nextCategories = categories.length > 0 ? categories : (category ? [category] : DEFAULT_CATEGORIES)

    const schedule = {
      id: createScheduleId(),
      runAt,
      status: 'pending',
      provider,
      model,
      tone,
      length,
      blogType,
      ghostStatus,
      category: category || nextCategories[0] || '전체',
      categories: nextCategories,
      categoryIndex: 0,
      startTime,
      intervalHours,
      repeat,
      repeatIntervalMinutes: repeat ? repeatIntervalMinutes : null,
      titlePrefix,
      useRandomKeyword,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastError: '',
      result: null,
    }

    await saveSchedule(schedule)

    return NextResponse.json({ schedule })
  } catch (error) {
    const message = error instanceof Error ? error.message : '예약 저장 중 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    }
    await removeSchedule(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '예약 삭제 중 오류가 발생했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
