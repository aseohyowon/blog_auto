import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null

const CATEGORIES: Record<string, string> = {
  'IT·테크':      'IT, 프로그래밍, AI, 스마트폰, 앱, 소프트웨어, 가젯',
  '여행':         '국내여행, 해외여행, 숙소, 항공, 여행 코스, 관광지',
  '음식·맛집':    '맛집, 레시피, 카페, 디저트, 건강식, 밀키트',
  '재테크':       '주식, 부동산, 저축, 투자, 경제, 절약, 부업',
  '건강·운동':    '다이어트, 홈트, 헬스, 영양제, 멘탈케어, 루틴',
  '자기계발':     '독서, 습관, 공부법, 자격증, 커리어, 생산성',
  '리뷰':         '제품 리뷰, 서비스 리뷰, 가전, 뷰티, 패션',
  '이슈·트렌드':  '시사, 연예, 사회 이슈, 밈, 유행, 핫이슈',
}

function buildPrompt(category?: string): string {
  const currentYear = new Date().getFullYear()
  const nextYear = currentYear + 1
  const catDesc = category && CATEGORIES[category]
    ? `"${category}" 카테고리에 해당하는`
    : '다양한 카테고리(IT, 여행, 음식, 재테크, 건강, 자기계발, 리뷰, 이슈)에서 골고루'

  const catHint = catDesc ? `\n- 카테고리 범위: ${catDesc}` : ''

  return `당신은 한국 블로그 트렌드 전문가입니다.
지금 한국에서 인기 있고 검색량이 높은 블로그 키워드 8개를 추천해주세요.
현재 기준 연도는 ${currentYear}년입니다.

규칙:
- ${catDesc} 선정${catHint}
- 각 키워드는 2~8단어 사이로 구체적으로 (예: "${currentYear} 아이폰 사전예약 방법")
- 너무 일반적이지 않게, 블로그 글 주제로 바로 쓸 수 있게
- 시의성이 있으면 더 좋음 (계절, 트렌드, 신제품 등)
- 연도가 들어가는 키워드는 반드시 ${currentYear} 또는 ${nextYear}만 사용 (그 이전 연도 금지)
- 과거 시점 키워드(예: 2023, 2024, 작년 정산 가이드)는 제외
- JSON 배열만 반환하세요. 다른 텍스트 없이.

형식:
["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6", "키워드7", "키워드8"]`
}

export async function GET(req: NextRequest) {
  try {
    if (!groq) {
      return NextResponse.json({ error: 'API 키가 설정되지 않았습니다.' }, { status: 500 })
    }

    const category = req.nextUrl.searchParams.get('category') ?? undefined

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: buildPrompt(category) }],
      temperature: 1.0,
      max_tokens: 512,
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? '[]'

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ keywords: [] })
    }

    const currentYear = new Date().getFullYear()
    const minAllowedYear = currentYear
    const yearPattern = /\b(20\d{2})\b/g

    const keywords = JSON.parse(jsonMatch[0]) as string[]
    const filtered = keywords
      .filter((keyword) => {
        const years = [...keyword.matchAll(yearPattern)].map((m) => Number(m[1]))
        if (years.length === 0) return true
        return years.every((y) => y >= minAllowedYear)
      })
      .slice(0, 8)

    return NextResponse.json({ keywords: filtered })

  } catch (err) {
    console.error('[/api/keywords]', err)
    return NextResponse.json({ keywords: [] })
  }
}
