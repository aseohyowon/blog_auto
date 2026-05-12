import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { tavily } from '@tavily/core'
import { searchSafeImages } from '@/lib/safeImageSearch'
import { searchStockImages } from '@/lib/stockImageSearch'
import {
  generateWithOllama,
  OLLAMA_MODEL_MISSING_MESSAGE,
  OLLAMA_NOT_RUNNING_MESSAGE,
  OLLAMA_SLOW_MESSAGE,
} from '@/services/ollamaService'
import {
  SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  TRAVEL_SYSTEM_PROMPT,
  IT_NEWS_SYSTEM_PROMPT,
  CELEBRITY_SYSTEM_PROMPT,
  buildUserPrompt,
  buildCelebrityPrompt,
} from '@/lib/openai'

// ── SDK clients (lazy — only created when keys exist) ─────────────────────────
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY ?? '' })

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResult {
  text: string
}

interface GenerationResult {
  html: string
  totalTokens: number
}

type SystemPrompt = string

const MIN_BODY_TEXT_LENGTH = 1000

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function getBodyTextLength(html: string): number {
  return stripHtmlToText(html).length
}

function buildLengthRetryPrompt(basePrompt: string, currentLength: number, attempt: number): string {
  const missing = Math.max(0, MIN_BODY_TEXT_LENGTH - currentLength)
  const strictLine = attempt >= 2
    ? '이번 응답은 반드시 11개 섹션을 모두 유지하고, 각 핵심 섹션에 최소 2개 이상의 문단을 작성하세요.'
    : '섹션 순서는 그대로 유지하고, 본문 설명과 근거를 더 자세히 보강하세요.'

  return `${basePrompt}\n\n[분량 보강 재요청 #${attempt}]\n직전 응답의 본문 텍스트 길이는 ${currentLength}자였습니다. 최소 ${MIN_BODY_TEXT_LENGTH}자 기준까지 ${missing}자 이상 부족합니다.\n${strictLine}\nHTML 태그를 제외한 본문 텍스트를 최소 ${MIN_BODY_TEXT_LENGTH}자 이상으로 늘려서 다시 작성하세요.`
}

// ── Tavily web search (text only) ────────────────────────────────────────────
async function searchWeb(topic: string): Promise<SearchResult> {
  try {
    const res = await tavilyClient.search(topic, {
      searchDepth: 'basic',
      maxResults: 6,
      includeAnswer: true,
      includeImages: false,
    })

    const lines: string[] = []
    if (res.answer) lines.push(`[요약] ${res.answer.slice(0, 300)}`)
    res.results.forEach((r, i) => {
      lines.push(`[출처${i + 1}] ${r.title} (${r.url}): ${r.content.slice(0, 180)}`)
    })

    return { text: lines.join('\n') }
  } catch {
    return { text: '' }
  }
}

// ── Provider: Groq ────────────────────────────────────────────────────────────
async function generateWithGroq(
  modelName: string,
  systemPrompt: SystemPrompt,
  userPrompt: string,
): Promise<GenerationResult> {
  if (!groq) throw new Error('GROQ_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.')
  const completion = await groq.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.75,
    max_tokens: 4096,
  })
  return {
    html: completion.choices[0]?.message?.content?.trim() ?? '',
    totalTokens: completion.usage?.total_tokens ?? 0,
  }
}

// ── Provider: Google Gemini ───────────────────────────────────────────────────
async function generateWithGemini(
  modelName: string,
  systemPrompt: SystemPrompt,
  userPrompt: string,
): Promise<GenerationResult> {
  if (!gemini) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.')
  const model = gemini.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  })
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: 4096 },
  })
  const text = result.response.text()
  const usage = result.response.usageMetadata
  return {
    html: text.trim(),
    totalTokens: (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0),
  }
}

// ── Provider: OpenRouter (OpenAI-compatible) ──────────────────────────────────
async function generateWithOpenRouter(
  modelName: string,
  systemPrompt: SystemPrompt,
  userPrompt: string,
): Promise<GenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://blog-pro.local',
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const msg = errBody?.error?.message ?? `OpenRouter ${res.status}`
    throw Object.assign(new Error(msg), { status: res.status })
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { total_tokens?: number }
  }

  return {
    html: data.choices?.[0]?.message?.content?.trim() ?? '',
    totalTokens: data.usage?.total_tokens ?? 0,
  }
}

// ── Broken-image script (injected into every response) ────────────────────────
// On error: replaces broken <img> with picsum fallback, fixes broken background-image
const BROKEN_IMAGE_SCRIPT = `<script>
(function(){
  function fallback(w,h){ return 'https://placehold.co/'+w+'x'+h+'/1a1a1a/555555?text=Image'; }

  document.querySelectorAll('img').forEach(function(img){
    function fix(){
      if(img.dataset.retried) return;
      img.dataset.retried='1';
      img.src=fallback(img.width||600,img.height||450);
    }
    if(img.complete && img.naturalWidth===0) fix();
    img.addEventListener('error',fix);
  });

  document.querySelectorAll('[style*="background-image"]').forEach(function(el){
    var m=(el.style.backgroundImage||'').match(/url\\(["']?([^"')]+)["']?\\)/);
    if(!m) return;
    var t=new Image();
    t.onerror=function(){
      el.style.backgroundImage='url('+fallback(860,510)+')';
    };
    t.src=m[1];
  });
})();
</script>`

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      topic?: unknown
      tone?: unknown
      length?: unknown
      model?: unknown
      provider?: unknown
      blogType?: unknown
      celebrity?: unknown
      imageCount?: unknown
      selectedImages?: unknown
    }

    const topic     = typeof body.topic    === 'string' ? body.topic.trim()  : ''
    const tone      = typeof body.tone     === 'string' ? body.tone          : '정보 전달형'
    const length    = typeof body.length   === 'string' ? body.length        : 'medium'
    const modelName = typeof body.model    === 'string' ? body.model         : 'llama-3.3-70b-versatile'
    const provider  = typeof body.provider === 'string' ? body.provider      : 'groq'
    const blogType  = (['celebrity', 'review', 'travel', 'it-news', 'general'] as const).includes(body.blogType as 'general')
      ? (body.blogType as 'general' | 'review' | 'travel' | 'it-news' | 'celebrity')
      : 'general' as const
    const celebrity = typeof body.celebrity === 'string' ? body.celebrity.trim() : ''
    const rawImageCount = typeof body.imageCount === 'number' ? body.imageCount : 6
    const imageCount = Math.max(3, Math.min(10, Math.floor(rawImageCount)))
    const selectedImages = Array.isArray(body.selectedImages)
      ? body.selectedImages
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const candidate = item as Record<string, unknown>
          const url = typeof candidate.url === 'string' ? candidate.url : ''
          const source = typeof candidate.source === 'string' ? candidate.source : ''
          const title = typeof candidate.title === 'string' ? candidate.title : ''
          if (!url || !source) return null
          return { url, source, title }
        })
        .filter((item): item is { url: string; source: string; title: string } => item !== null)
      : []

    if (blogType === 'celebrity' && !celebrity) {
      return NextResponse.json({ error: '아이돌/연예인을 선택해주세요.' }, { status: 400 })
    }

    if (blogType !== 'celebrity' && !topic) {
      return NextResponse.json({ error: '주제를 입력해주세요.' }, { status: 400 })
    }

    const baseTopic = blogType === 'celebrity'
      ? `${celebrity} 프로필 소개 최근 활동 사진 모음`
      : topic
    const sanitized = baseTopic.slice(0, 200)
    const { text: searchText } = await searchWeb(sanitized)
    // Fetch stock images from Pexels/Pixabay (licensed, safe to use)
    const stockImages = blogType !== 'celebrity'
      ? (await searchStockImages(sanitized, imageCount)).map((img) => ({
          url: img.url,
          source: img.pageUrl,
          title: img.title,
        }))
      : []
    const safeImages = blogType === 'celebrity'
      ? await searchSafeImages(celebrity, imageCount)
      : []
    const preferredImages = selectedImages.slice(0, imageCount)
    const fallbackSafeImages = safeImages
      .map((img) => ({ url: img.imageUrl, source: img.pageUrl, title: img.title }))
      .filter((img) => !preferredImages.some((selected) => selected.url === img.url))
    const promptImages = blogType === 'celebrity'
      ? [...preferredImages, ...fallbackSafeImages].slice(0, imageCount)
      : stockImages

    const systemPrompt =
      blogType === 'celebrity' ? CELEBRITY_SYSTEM_PROMPT :
      blogType === 'review'    ? REVIEW_SYSTEM_PROMPT :
      blogType === 'travel'    ? TRAVEL_SYSTEM_PROMPT :
      blogType === 'it-news'   ? IT_NEWS_SYSTEM_PROMPT :
      SYSTEM_PROMPT
    const userPrompt = blogType === 'celebrity'
      ? buildCelebrityPrompt(celebrity, tone, imageCount, searchText, promptImages, preferredImages)
      : buildUserPrompt(sanitized, tone, length, searchText, promptImages)

    const generateByProvider = async (prompt: string): Promise<GenerationResult> => {
      switch (provider) {
        case 'ollama':
          return generateWithOllama({
            model: modelName,
            systemPrompt,
            userPrompt: prompt,
          })
        case 'gemini':
          return generateWithGemini(modelName, systemPrompt, prompt)
        case 'openrouter':
          return generateWithOpenRouter(modelName, systemPrompt, prompt)
        case 'groq':
        default:
          return generateWithGroq(modelName, systemPrompt, prompt)
      }
    }

    let result = await generateByProvider(userPrompt)
    let bodyLength = getBodyTextLength(result.html)

    const MAX_LENGTH_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_LENGTH_RETRIES && bodyLength < MIN_BODY_TEXT_LENGTH; attempt += 1) {
      const retryPrompt = buildLengthRetryPrompt(userPrompt, bodyLength, attempt)
      const retryResult = await generateByProvider(retryPrompt)
      result = {
        html: retryResult.html,
        totalTokens: result.totalTokens + retryResult.totalTokens,
      }
      bodyLength = getBodyTextLength(result.html)
    }

    if (!result.html) {
      return NextResponse.json(
        { error: 'AI 응답을 받지 못했습니다. 다시 시도해주세요.' },
        { status: 500 },
      )
    }

    if (bodyLength < MIN_BODY_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `생성된 글 본문이 너무 짧습니다. 현재 ${bodyLength}자이며 최소 ${MIN_BODY_TEXT_LENGTH}자 이상이어야 합니다. 다시 시도해주세요.` },
        { status: 422 },
      )
    }

    // Inject broken-image fallback script
    const html = result.html.includes('</body>')
      ? result.html.replace('</body>', BROKEN_IMAGE_SCRIPT + '\n</body>')
      : result.html + BROKEN_IMAGE_SCRIPT

    return NextResponse.json({ html, usage: { total_tokens: result.totalTokens } })

  } catch (err: unknown) {
    console.error('[/api/generate]', err)

    if (err != null && typeof err === 'object') {
      const msg    = ('message' in err ? String((err as { message: unknown }).message) : '')
      const status = 'status' in err ? Number((err as { status: unknown }).status) : 0
      const msgLow = msg.toLowerCase()

      if (status === 503 || msg === OLLAMA_NOT_RUNNING_MESSAGE)
        return NextResponse.json({ error: OLLAMA_NOT_RUNNING_MESSAGE }, { status: 503 })

      if (status === 404 || msg === OLLAMA_MODEL_MISSING_MESSAGE)
        return NextResponse.json({ error: OLLAMA_MODEL_MISSING_MESSAGE }, { status: 404 })

      if (status === 504 || msg === OLLAMA_SLOW_MESSAGE)
        return NextResponse.json({ error: OLLAMA_SLOW_MESSAGE }, { status: 504 })

      if (status === 401 || msgLow.includes('api key') || msgLow.includes('invalid_api_key'))
        return NextResponse.json({ error: 'API 키가 유효하지 않습니다. .env 파일을 확인해주세요.' }, { status: 401 })

      if (status === 429 || msgLow.includes('rate limit') || msgLow.includes('rate_limit')) {
        const retryMatch = msg.match(/try again in ([0-9]+(?:\.[0-9]+)?)s/i)
        const seconds    = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null
        const retryHint  = seconds ? ` ${seconds}초 후 다시 시도해주세요.` : ' 잠시 후 다시 시도해주세요.'
        return NextResponse.json(
          { error: `분당 요청 한도를 초과했습니다.${retryHint}`, retryAfter: seconds },
          { status: 429 },
        )
      }

      // Surface provider-specific "no key" errors clearly
      if (msgLow.includes('설정되지 않았습니다'))
        return NextResponse.json({ error: msg }, { status: 400 })
    }

    return NextResponse.json({ error: '서버 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 })
  }
}
