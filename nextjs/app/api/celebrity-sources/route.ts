import { NextRequest, NextResponse } from 'next/server'
import { tavily } from '@tavily/core'

interface OfficialSourceItem {
  title: string
  url: string
  snippet: string
  kind: string
}

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY ?? '' })

const DOMAIN_HINTS: Array<{ keyword: string; kind: string }> = [
  { keyword: 'instagram.com', kind: 'Instagram' },
  { keyword: 'youtube.com', kind: 'YouTube' },
  { keyword: 'youtu.be', kind: 'YouTube' },
  { keyword: 'x.com', kind: 'X' },
  { keyword: 'twitter.com', kind: 'X' },
  { keyword: 'weverse.io', kind: 'Weverse' },
  { keyword: 'fandom.com', kind: 'Fandom' },
  { keyword: 'wikipedia.org', kind: 'Wikipedia' },
  { keyword: 'namu.wiki', kind: 'NamuWiki' },
]

function classify(url: string): string {
  const lowered = url.toLowerCase()
  return DOMAIN_HINTS.find((item) => lowered.includes(item.keyword))?.kind ?? '웹'
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query')?.trim() ?? ''
    if (!query) {
      return NextResponse.json({ sources: [], note: '검색어가 비어 있습니다.' })
    }

    const result = await tavilyClient.search(`${query} 공식 인스타그램 유튜브 소속사 위키`, {
      searchDepth: 'basic',
      maxResults: 8,
      includeAnswer: false,
      includeImages: false,
    })

    const seen = new Set<string>()
    const sources: OfficialSourceItem[] = []

    for (const item of result.results ?? []) {
      if (!item.url || seen.has(item.url)) continue
      seen.add(item.url)
      sources.push({
        title: item.title || item.url,
        url: item.url,
        snippet: item.content?.slice(0, 140) ?? '',
        kind: classify(item.url),
      })
    }

    return NextResponse.json({
      sources: sources.slice(0, 6),
      note: '공식 채널 후보 링크입니다. 게시 전 실제 공식 계정/페이지인지 한 번 더 확인하세요.',
    })
  } catch (error) {
    console.error('[/api/celebrity-sources]', error)
    return NextResponse.json({ sources: [], note: '공식 출처 검색 중 오류가 발생했습니다.' }, { status: 500 })
  }
}