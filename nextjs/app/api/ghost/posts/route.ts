import { NextRequest, NextResponse } from 'next/server'
import {
  createGhostPost,
  GHOST_AUTH_FAILED_MESSAGE,
  GHOST_CONNECTION_FAILED_MESSAGE,
  GHOST_KEY_INVALID_MESSAGE,
  GHOST_KEY_MISSING_MESSAGE,
  GHOST_URL_MISSING_MESSAGE,
} from '@/services/ghostService'

export const runtime = 'nodejs'

type GhostStatus = 'draft' | 'published'

function toTagList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((item): item is string => typeof item === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  if (typeof input === 'string') {
    return input
      .split(/[\n,]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  return []
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: unknown
      html?: unknown
      excerpt?: unknown
      tags?: unknown
      status?: unknown
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const html = typeof body.html === 'string' ? body.html : ''
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : ''
    const tags = toTagList(body.tags)
    const status: GhostStatus = body.status === 'published' ? 'published' : 'draft'

    if (!title) {
      return NextResponse.json({ error: 'Ghost 업로드용 제목을 입력해주세요.' }, { status: 400 })
    }

    if (!html.trim()) {
      return NextResponse.json({ error: 'Ghost 업로드용 본문 HTML이 비어 있습니다.' }, { status: 400 })
    }

    const post = await createGhostPost({
      title,
      html,
      excerpt,
      tags,
      status,
    })

    return NextResponse.json({ post })
  } catch (error) {
    if (error instanceof Error) {
      const status = typeof (error as { status?: unknown }).status === 'number'
        ? Number((error as { status?: unknown }).status)
        : 500
      const message = error.message || 'Ghost 업로드 중 오류가 발생했습니다.'

      if (
        message === GHOST_URL_MISSING_MESSAGE ||
        message === GHOST_KEY_MISSING_MESSAGE ||
        message === GHOST_KEY_INVALID_MESSAGE ||
        message === GHOST_AUTH_FAILED_MESSAGE ||
        message === GHOST_CONNECTION_FAILED_MESSAGE
      ) {
        return NextResponse.json({ error: message }, { status })
      }

      return NextResponse.json({ error: message }, { status })
    }

    return NextResponse.json({ error: 'Ghost 업로드 중 서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
