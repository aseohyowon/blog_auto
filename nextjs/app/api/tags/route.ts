import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null

function normalizeTag(tag: string): string {
  return tag
    .replace(/^#+/, '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFallbackTags(topic: string, html: string): string[] {
  const source = `${topic} ${html}`
  const cleaned = source
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const stopwords = new Set(['그리고', '소개', '정리', '방법', '가이드', '콘텐츠', '블로그', '포스트', '이번', '통해'])
  const words = cleaned
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && word.length <= 18 && !stopwords.has(word))

  return [...new Set(words)].slice(0, 8)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { topic?: unknown; html?: unknown }
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const html = typeof body.html === 'string' ? body.html : ''

    if (!topic && !html) {
      return NextResponse.json({ tags: [] })
    }

    if (!groq) {
      return NextResponse.json({ tags: extractFallbackTags(topic, html) })
    }

    const prompt = `당신은 한국 블로그 SEO 태그 전문가입니다.
아래 글 주제와 HTML 내용을 바탕으로 티스토리용 태그 8개를 추천하세요.

규칙:
- 한국어 중심, 필요하면 영문 고유명사 허용
- 해시(#) 없이 태그 문자열만 반환
- 너무 일반적인 단어보다 검색 의도가 분명한 태그 우선
- 중복 없이 8개
- JSON 배열만 반환

주제: ${topic || '없음'}
본문 요약 원본:
${html.slice(0, 4000)}

형식:
["태그1","태그2","태그3","태그4","태그5","태그6","태그7","태그8"]`

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 300,
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? '[]'
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ tags: extractFallbackTags(topic, html) })
    }

    const parsed = JSON.parse(jsonMatch[0]) as string[]
    const tags = [...new Set(parsed.map(normalizeTag).filter(Boolean))].slice(0, 8)
    return NextResponse.json({ tags: tags.length > 0 ? tags : extractFallbackTags(topic, html) })
  } catch (error) {
    console.error('[/api/tags]', error)
    return NextResponse.json({ tags: [] })
  }
}