import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { tavily } from '@tavily/core'
import { resolveImagesForPost, injectImageEnhancements } from '@/lib/imageService'
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
  GROQ_SYSTEM_PROMPT,
  GROQ_REVIEW_SYSTEM_PROMPT,
  GROQ_TRAVEL_SYSTEM_PROMPT,
  GROQ_IT_NEWS_SYSTEM_PROMPT,
  GROQ_CELEBRITY_SYSTEM_PROMPT,
  OLLAMA_SYSTEM_PROMPT,
  buildUserPrompt,
  buildCelebrityPrompt,
  buildOllamaUserPrompt,
  buildOllamaLengthRetryPrompt,
  buildGroqLengthRetryPrompt,
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

const MIN_BODY_TEXT_LENGTH = 2000

// ── Convert markdown to HTML (for small LLMs that ignore HTML-only rule) ───────
function convertMarkdownToHtml(text: string): string {
  const trimmed = text.trim()
  // Already HTML? return as-is
  if (trimmed.startsWith('<')) return trimmed

  let out = trimmed
  // Remove leading separators
  out = out.replace(/^-{3,}\s*/m, '')
  // Headers (h1 → h2 per no-h1 policy)
  out = out.replace(/^#{4,}\s+(.+)$/gm, '<h4>$1</h4>')
  out = out.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  out = out.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  out = out.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>')
  // Bold / italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // HR
  out = out.replace(/^-{3,}$/gm, '<hr>')

  const lines = out.split('\n')
  const result: string[] = ['<div class="ts-wrap" style="max-width:860px;margin:0 auto;padding:20px 16px;font-family:sans-serif;color:#f4f4f5;background:#111">']
  let inUl = false
  let inOl = false

  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (inUl) { result.push('</ul>'); inUl = false }
      if (inOl) { result.push('</ol>'); inOl = false }
      continue
    }
    if (/^[*-]\s/.test(t)) {
      if (inOl) { result.push('</ol>'); inOl = false }
      if (!inUl) { result.push('<ul>'); inUl = true }
      result.push(`<li>${t.slice(2).trim()}</li>`)
    } else if (/^\d+\.\s/.test(t)) {
      if (inUl) { result.push('</ul>'); inUl = false }
      if (!inOl) { result.push('<ol>'); inOl = true }
      result.push(`<li>${t.replace(/^\d+\.\s/, '')}</li>`)
    } else {
      if (inUl) { result.push('</ul>'); inUl = false }
      if (inOl) { result.push('</ol>'); inOl = false }
      if (/^<(h[1-6]|hr|ul|ol|li|p|div|blockquote|section|article)/i.test(t)) {
        result.push(t)
      } else {
        result.push(`<p>${t}</p>`)
      }
    }
  }
  if (inUl) result.push('</ul>')
  if (inOl) result.push('</ol>')
  result.push('</div>')
  return result.join('\n')
}

// ── Remove duplicate title from hero section ──────────────────────────────────
// Ghost already shows the post title as <h1> above the content.
// Any <h2> or <h1> inside the .ts-hero block is a duplicate — remove it.
function removeHeroDuplicateTitle(html: string): string {
  return html.replace(
    /(<div[^>]*class="[^"]*ts-hero[^"]*"[^>]*>(?:<div[^>]*>)?)\s*<h[12][^>]*>[\s\S]*?<\/h[12]>\s*/i,
    '$1',
  )
}

// ── Detect LLM template placeholders ─────────────────────────────────────────
// Small models sometimes output generic templates with [여기에...], [전략 A] etc.
// Matches Korean/English bracket placeholders of length 2–40 chars.
const PLACEHOLDER_RE = /\[[가-힣\w\s]{2,40}\]/g
function hasTemplatePlaceholders(text: string): boolean {
  const matches = text.match(PLACEHOLDER_RE)
  return (matches?.length ?? 0) >= 3
}

// ── Strip LLM meta-commentary ──────────────────────────────────────────────────
// Local LLMs (e.g. gemma4:e2b) often inject disclaimers like
// "주의: 이 내용은 텍스트 기반으로 생성되었으며 이미지에 대한 접근 권한이 없습니다"
// or wrap output in markdown code fences. Remove these artefacts.
function stripLlmMetaCommentary(html: string): string {
  let out = html.trim()

  // 1) Unwrap markdown code fences (```html ... ``` or ``` ... ```)
  out = out.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  // 2) Remove disclaimer / meta-commentary <p> blocks
  //    Matches: <p>(optional <strong>)(주의|참고|안내|NOTE|Warning…)(:</strong> | :<br>)…</p>
  const DISCLAIMER_TAGS = '주의|참고|안내|노트|알림|NOTE|Note|Warning|Disclaimer|NOTICE|면책'
  out = out.replace(
    new RegExp(`<p[^>]*>\\s*(?:<[^>]+>)*(?:${DISCLAIMER_TAGS})[:\s：].*?</p>`, 'gis'),
    '',
  )

  // 3) Remove <p> blocks that contain known "I can't access images" phrases
  const CANT_ACCESS_PHRASES = [
    '텍스트 기반으로 생성',
    '이미지나 실제 파일에 대한',
    '직접적인 접근 권한',
    '요청하신 내용에 기반하여 구성',
    '실제 이미지에 액세스',
    '이미지를 직접 생성',
    '이미지 생성 기능이 없',
    'cannot access images',
    'no access to images',
    'text-based content only',
  ]
  for (const phrase of CANT_ACCESS_PHRASES) {
    out = out.replace(
      new RegExp(`<p[^>]*>[^<]*${phrase}[^<]*</p>`, 'gi'),
      '',
    )
  }

  return out.trim()
}

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

interface GenerationResult {
  html: string
  totalTokens: number
  groqRateLimit?: {
    limitTokens: number
    remainingTokens: number
    limitRequests: number
    remainingRequests: number
    resetSeconds: number
  }
}

// ── Provider: Groq ────────────────────────────────────────────────────────────
async function generateWithGroq(
  modelName: string,
  systemPrompt: SystemPrompt,
  userPrompt: string,
  length: string = 'medium',
  options?: {
    imageCount?: number
    blogType?: string
    tone?: string
    sanitized?: string
    celebrity?: string
    searchText?: string
    promptImages?: Array<{ url: string; source: string; title: string }>
    preferredImages?: Array<{ url: string; source: string; title: string }>
    length?: string
  }
): Promise<GenerationResult> {
  if (!groq) throw new Error('GROQ_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.')

  // Groq Free TPM = 12K. Compact prompt(~750) + output(5500) = ~6250/req.
  // 2 requests (1 retry) ≈ 12.5K - marginal but acceptable with natural delay.
  // 5500 tokens gives ~20% more output room for Korean content vs 5120.
  const maxTokens = length === 'short' ? 3072 : 5500

  let currentImageCount = options?.imageCount ?? 6
  let currentUserPrompt = userPrompt
  let attempt = 0
  const maxAttempts = 2

  while (attempt < maxAttempts) {
    attempt += 1
    try {
      // Groq SDK는 OpenAI 호환이므로 fetch로 직접 호출하여 헤더 접근
      const apiKey = process.env.GROQ_API_KEY!
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: currentUserPrompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
      })

      const headers = response.headers
      const rateLimit = {
        limitTokens: Number(headers.get('x-ratelimit-limit-tokens') ?? 12000),
        remainingTokens: Number(headers.get('x-ratelimit-remaining-tokens') ?? 0),
        limitRequests: Number(headers.get('x-ratelimit-limit-requests') ?? 30),
        remainingRequests: Number(headers.get('x-ratelimit-remaining-requests') ?? 0),
        resetSeconds: Number(headers.get('retry-after') ?? 60),
      }

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = data.error?.message || `Groq API 오류 (${response.status})`
        
        // Check for TPM limit error
        const isTpmError = 
          response.status === 413 ||
          response.status === 429 ||
          errorMsg.toLowerCase().includes('tokens per minute') ||
          errorMsg.toLowerCase().includes('tpm') ||
          errorMsg.toLowerCase().includes('rate limit')
        
        if (isTpmError && currentImageCount > 3 && attempt < maxAttempts && options) {
          // Retry with reduced images
          currentImageCount = Math.max(3, currentImageCount - 2)
          console.log(`[Groq TPM] Retry ${attempt}/${maxAttempts}: reducing images to ${currentImageCount}`)
          
          // Rebuild userPrompt with reduced imageCount
          const rebuildPrompt = (blogType: string) => {
            const base = options.blogType === 'celebrity'
              ? buildCelebrityPrompt(
                  options.celebrity || '',
                  options.tone || '정보 전달형',
                  currentImageCount,
                  options.searchText || '',
                  options.promptImages || [],
                  options.preferredImages || []
                )
              : buildUserPrompt(
                  options.sanitized || '',
                  options.tone || '정보 전달형',
                  options.length || 'medium',
                  options.searchText || '',
                  options.promptImages || []
                )
            return base
          }
          
          currentUserPrompt = rebuildPrompt(options.blogType || 'general')
          // Small delay before retry
          await new Promise(r => setTimeout(r, 1000))
          continue
        }
        
        throw new Error(errorMsg)
      }

      return {
        html: data.choices[0]?.message?.content?.trim() ?? '',
        totalTokens: data.usage?.total_tokens ?? 0,
        groqRateLimit: rateLimit,
      }
    } catch (error) {
      console.error('[Groq Error]', error)
      if (attempt >= maxAttempts) throw error
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new Error('Groq 생성 실패: 최대 재시도 횟수 초과')
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
      sdModel?: unknown
    }

    const topic     = typeof body.topic    === 'string' ? body.topic.trim()  : ''
    const tone      = typeof body.tone     === 'string' ? body.tone          : '정보 전달형'
    const length    = typeof body.length   === 'string' ? body.length        : 'medium'
    const provider  = typeof body.provider === 'string' ? body.provider      : 'ollama'
    const defaultModel = provider === 'ollama' ? (process.env.OLLAMA_MODEL ?? 'gemma4:e2b') : 'llama-3.3-70b-versatile'
    const modelName = typeof body.model    === 'string' ? body.model         : defaultModel
    const sdModel   = typeof body.sdModel  === 'string' ? body.sdModel.trim() : undefined
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
    const imageCandidates = await resolveImagesForPost({
      topic: blogType === 'celebrity' ? celebrity : sanitized,
      blogType,
      count: imageCount,
      preferredImages: selectedImages,
      provider,
      sdModel,
    })
    const promptImages = imageCandidates.map((img) => ({
      url: img.url,
      source: img.pageUrl,
      title: img.title,
    }))
    const preferredImages = selectedImages.slice(0, imageCount)

    const isGroq = provider === 'groq'
    const systemPrompt =
      blogType === 'celebrity' ? (isGroq ? GROQ_CELEBRITY_SYSTEM_PROMPT : CELEBRITY_SYSTEM_PROMPT) :
      blogType === 'review'    ? (isGroq ? GROQ_REVIEW_SYSTEM_PROMPT    : REVIEW_SYSTEM_PROMPT) :
      blogType === 'travel'    ? (isGroq ? GROQ_TRAVEL_SYSTEM_PROMPT   : TRAVEL_SYSTEM_PROMPT) :
      blogType === 'it-news'   ? (isGroq ? GROQ_IT_NEWS_SYSTEM_PROMPT  : IT_NEWS_SYSTEM_PROMPT) :
      isGroq ? GROQ_SYSTEM_PROMPT : SYSTEM_PROMPT
    const userPrompt = blogType === 'celebrity'
      ? buildCelebrityPrompt(celebrity, tone, imageCount, searchText, promptImages, preferredImages)
      : buildUserPrompt(sanitized, tone, length, searchText, promptImages)

    // Ollama uses a simplified prompt — large system prompts overwhelm small local models
    // Filter out base64 data URLs (SD images) — they are injected later by injectImageEnhancements
    // and would bloat the prompt beyond the 2B model's context window
    const ollamaPromptImages = promptImages.filter((img) => !img.url.startsWith('data:'))
    const ollamaUserPrompt = buildOllamaUserPrompt(sanitized || celebrity, searchText, ollamaPromptImages)

    const generateByProvider = async (prompt: string): Promise<GenerationResult> => {
      switch (provider) {
        case 'ollama':
          return generateWithOllama({
            model: modelName,
            systemPrompt: OLLAMA_SYSTEM_PROMPT,
            userPrompt: prompt,
          })
        case 'gemini':
          return generateWithGemini(modelName, systemPrompt, prompt)
        case 'openrouter':
          return generateWithOpenRouter(modelName, systemPrompt, prompt)
        case 'groq':
        default:
          return generateWithGroq(modelName, systemPrompt, prompt, length, {
            imageCount,
            blogType,
            tone,
            sanitized,
            celebrity,
            searchText,
            promptImages,
            preferredImages,
            length,
          })
      }
    }

    // Ollama uses its own simplified prompt; other providers use the full userPrompt
    let result = await generateByProvider(provider === 'ollama' ? ollamaUserPrompt : userPrompt)

    // Convert markdown output to HTML (small models often ignore the HTML-only rule)
    result = { ...result, html: convertMarkdownToHtml(result.html) }

    let bodyLength = getBodyTextLength(result.html)

    // 모든 프로바이더 동일 길이 기준 사용 (LOCALLLM / GROQ 통일)
    const minLength = length === 'short' ? 1000 : MIN_BODY_TEXT_LENGTH
    // Ollama(소형 로컬 모델)는 재시도 횟수를 늘려 2000자 달성 확률을 높임
    // Groq Free TPM=12K: limit retries to 1 (2 requests max ≈ 11.6K tokens) to avoid rate limit
    const MAX_LENGTH_RETRIES = provider === 'ollama' ? 5 : provider === 'groq' ? 1 : 3
    for (let attempt = 1; attempt <= MAX_LENGTH_RETRIES && bodyLength < minLength; attempt += 1) {
      const retryPrompt = provider === 'ollama'
        ? buildOllamaLengthRetryPrompt(sanitized || celebrity, bodyLength)
        : provider === 'groq'
          ? buildGroqLengthRetryPrompt(sanitized || celebrity, bodyLength, attempt)
          : buildLengthRetryPrompt(userPrompt, bodyLength, attempt)
      const retryResult = await generateByProvider(retryPrompt)
      result = {
        html: convertMarkdownToHtml(retryResult.html),
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

    if (bodyLength < minLength) {
      return NextResponse.json(
        { error: `생성된 글 본문이 너무 짧습니다. 현재 ${bodyLength}자이며 최소 ${minLength}자 이상이어야 합니다. 다시 시도해주세요.` },
        { status: 422 },
      )
    }

    // Reject template-placeholder output (e.g. gemma4:e2b generating [전략 A의 주요 내용])
    if (hasTemplatePlaceholders(stripHtmlToText(result.html))) {
      return NextResponse.json(
        { error: '모델이 실제 내용 대신 템플릿 형식([placeholder])을 생성했습니다. 다시 시도하거나 다른 모델을 선택해주세요.' },
        { status: 422 },
      )
    }

    result = { ...result, html: stripLlmMetaCommentary(result.html) }
    result = { ...result, html: removeHeroDuplicateTitle(result.html) }

    const enhancedHtml = injectImageEnhancements(result.html, imageCandidates)

    // Inject broken-image fallback script
    const html = enhancedHtml.includes('</body>')
      ? enhancedHtml.replace('</body>', BROKEN_IMAGE_SCRIPT + '\n</body>')
      : enhancedHtml + BROKEN_IMAGE_SCRIPT

    return NextResponse.json({ html, usage: { total_tokens: result.totalTokens } })

  } catch (err: unknown) {
    console.error('[/api/generate]', err)

    if (err != null && typeof err === 'object') {
      const msg    = ('message' in err ? String((err as { message: unknown }).message) : '')
      const status = 'status' in err ? Number((err as { status: unknown }).status) : 0
      const msgLow = msg.toLowerCase()

      // Connection failure — Ollama not reachable at all
      if (msg === OLLAMA_NOT_RUNNING_MESSAGE)
        return NextResponse.json({ error: OLLAMA_NOT_RUNNING_MESSAGE }, { status: 503 })

      // Other 503 from Ollama API (model OOM, model load failure, etc.)
      // Do NOT mask with OLLAMA_NOT_RUNNING_MESSAGE — surface the real error
      if (status === 503)
        return NextResponse.json({ error: `Ollama 오류: ${msg}` }, { status: 503 })

      if (status === 404 || msg === OLLAMA_MODEL_MISSING_MESSAGE)
        return NextResponse.json({ error: msg || OLLAMA_MODEL_MISSING_MESSAGE }, { status: 404 })

      if (status === 504 || msg === OLLAMA_SLOW_MESSAGE)
        return NextResponse.json({ error: OLLAMA_SLOW_MESSAGE }, { status: 504 })

      // Catch any Ollama error (from ollamaService.js)
      if (msgLow.includes('ollama 오류') || msgLow.includes('ollama error'))
        return NextResponse.json({ error: msg }, { status: status || 500 })

      if (status === 401 || msgLow.includes('api key') || msgLow.includes('invalid_api_key'))
        return NextResponse.json({ error: 'API 키가 유효하지 않습니다. .env 파일을 확인해주세요.' }, { status: 401 })

      if (status === 413 || msgLow.includes('payload too large') || msgLow.includes('request entity too large') || msgLow.includes('tokens per minute') || msgLow.includes('tpm')) {
        return NextResponse.json(
          { error: 'Groq 무료 플랜의 분당 토큰 한도(12000)를 초과했습니다. 이미지 수를 줄이거나 Ollama/Gemini/OpenRouter를 사용해주세요.' },
          { status: 413 },
        )
      }

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
