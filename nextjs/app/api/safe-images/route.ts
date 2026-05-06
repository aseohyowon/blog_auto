import { NextRequest, NextResponse } from 'next/server'
import { searchSafeImages } from '@/lib/safeImageSearch'

const BLOCKED_SOURCES = ['jjal.tv']

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query')?.trim() ?? ''
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? '6')
    const limit = Math.max(3, Math.min(10, Number.isFinite(rawLimit) ? rawLimit : 6))

    if (!query) {
      return NextResponse.json({ images: [], note: '검색어가 비어 있습니다.' })
    }

    const images = await searchSafeImages(query, limit)

    return NextResponse.json({
      images,
      note: '안전 우선 모드: Wikimedia Commons 기반 이미지와 출처 링크만 제공합니다.',
      blockedSources: BLOCKED_SOURCES,
    })
  } catch (error) {
    console.error('[/api/safe-images]', error)
    return NextResponse.json({ images: [], note: '이미지 검색 중 오류가 발생했습니다.' }, { status: 500 })
  }
}