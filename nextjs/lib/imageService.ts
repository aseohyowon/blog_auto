import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'

export type ImageProvider = 'pexels' | 'pixabay' | 'unsplash' | 'wikimedia' | 'youtube' | 'stable-diffusion' | 'ai-generated' | 'placeholder'

export interface ImageCandidate {
  url: string
  pageUrl: string
  title: string
  provider: ImageProvider
  sourceLabel: string
  license: string
  author?: string
  width?: number
  height?: number
  relevanceScore: number
  keyword?: string
}

interface ResolveImageOptions {
  topic: string
  blogType: 'general' | 'review' | 'travel' | 'it-news' | 'celebrity'
  count?: number
  preferredImages?: Array<{ url: string; source: string; title: string }>
  /** LLM provider name (e.g. 'ollama'). When 'ollama', SD images are fetched first. */
  provider?: string
  /** ComfyUI checkpoint filename override (e.g. 'DreamShaper8_LCM.safetensors') */
  sdModel?: string
}

const CACHE_TTL_MS = Number(process.env.IMAGE_CACHE_TTL_MS || 1000 * 60 * 60 * 6)
const MAX_PERSISTED_USED = 4000
const NSFW_KEYWORDS = ['porn', 'nsfw', 'sex', 'nude', 'xxx', '성인', '야동', '노출']
const ISSUE_KEYWORDS = ['연예', '아이돌', '뉴스', '이슈', '속보', '유튜브', '화제', '트렌드', 'celebrity', 'kpop']

const PROVIDER_PRIORITY: Record<ImageProvider, number> = {
  wikimedia: 120,
  pexels: 110,
  pixabay: 105,
  unsplash: 100,
  youtube: 95,
  'stable-diffusion': 85,
  'ai-generated': 80,
  placeholder: 1,
}

const memoryCache = new Map<string, { expiresAt: number; items: ImageCandidate[] }>()

const dataDir = path.join(process.cwd(), '.data')
const usedImageFile = path.join(dataDir, 'used-images.json')

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣\s]/gi, ' ').replace(/\s+/g, ' ').trim()
}

function extractKeywords(topic: string): string[] {
  const text = normalizeText(topic)
  const tokens = text.split(' ').filter((item) => item.length >= 2)
  const stopWords = new Set(['하는', '에서', '으로', 'with', 'that', 'this', 'about', 'guide', '방법'])
  return [...new Set(tokens.filter((item) => !stopWords.has(item)))].slice(0, 7)
}

function containsNsfw(text: string): boolean {
  const target = normalizeText(text)
  return NSFW_KEYWORDS.some((word) => target.includes(word))
}

function looksLikeIssueTopic(topic: string): boolean {
  const target = normalizeText(topic)
  return ISSUE_KEYWORDS.some((word) => target.includes(normalizeText(word)))
}

function computeRelevance(candidate: Omit<ImageCandidate, 'relevanceScore'>, topic: string, keywords: string[], issueBoost: boolean): number {
  const base = PROVIDER_PRIORITY[candidate.provider] || 0
  const text = normalizeText(`${candidate.title} ${candidate.pageUrl} ${candidate.keyword || ''}`)
  const hits = keywords.reduce((acc, keyword) => (text.includes(keyword) ? acc + 1 : acc), 0)
  const keywordScore = hits * 8
  const sizeScore = (candidate.width && candidate.height && candidate.width >= 800 && candidate.height >= 450) ? 8 : 0
  const issueScore = issueBoost && candidate.provider === 'youtube' ? 18 : 0
  return base + keywordScore + sizeScore + issueScore
}

function dedupeImages<T extends { url: string; pageUrl: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const output: T[] = []
  for (const item of items) {
    const key = `${item.url}|${item.pageUrl}`
    if (!item.url || seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function optimizeImageUrl(url: string, width = 1400): string {
  if (!/^https?:\/\//i.test(url)) return url
  const stripped = url.replace(/^https?:\/\//i, '')
  return `https://wsrv.nl/?url=${encodeURIComponent(stripped)}&w=${width}&output=webp&q=80`
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true })
}

async function getUsedImageSet(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(usedImageFile, 'utf8')
    const parsed = JSON.parse(raw) as { used?: Array<{ url: string; usedAt: number }> }
    const list = Array.isArray(parsed.used) ? parsed.used : []
    return new Set(list.map((item) => item.url))
  } catch {
    return new Set<string>()
  }
}

async function persistUsedImages(urls: string[]) {
  await ensureDataDir()
  const now = Date.now()
  const existing: Array<{ url: string; usedAt: number }> = []

  try {
    const raw = await fs.readFile(usedImageFile, 'utf8')
    const parsed = JSON.parse(raw) as { used?: Array<{ url: string; usedAt: number }> }
    if (Array.isArray(parsed.used)) existing.push(...parsed.used)
  } catch {
    // noop
  }

  const mergedMap = new Map<string, number>()
  for (const item of existing) mergedMap.set(item.url, item.usedAt)
  for (const url of urls) mergedMap.set(url, now)

  const merged = [...mergedMap.entries()]
    .map(([url, usedAt]) => ({ url, usedAt }))
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, MAX_PERSISTED_USED)

  await fs.writeFile(usedImageFile, JSON.stringify({ used: merged }, null, 2), 'utf8')
}

async function searchPexels(query: string, limit: number): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return []

  const params = new URLSearchParams({ query, per_page: String(limit), orientation: 'landscape' })
  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: apiKey },
    next: { revalidate: 3600 },
  })
  if (!res.ok) return []

  const data = await res.json() as {
    photos?: Array<{
      alt?: string
      url?: string
      width?: number
      height?: number
      photographer?: string
      src?: { large2x?: string; large?: string; medium?: string }
    }>
  }

  return (data.photos ?? []).map((photo) => ({
    url: optimizeImageUrl(photo.src?.large2x || photo.src?.large || photo.src?.medium || ''),
    pageUrl: photo.url || '',
    title: photo.alt || query,
    provider: 'pexels' as const,
    sourceLabel: 'Pexels',
    license: 'Pexels License',
    author: photo.photographer || '',
    width: photo.width,
    height: photo.height,
    keyword: query,
  })).filter((item) => item.url && item.pageUrl)
}

async function searchPixabay(query: string, limit: number): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const apiKey = process.env.PIXABAY_API_KEY
  if (!apiKey) return []

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    image_type: 'photo',
    orientation: 'horizontal',
    safesearch: 'true',
    per_page: String(limit),
  })

  const res = await fetch(`https://pixabay.com/api/?${params}`, { next: { revalidate: 3600 } })
  if (!res.ok) return []

  const data = await res.json() as {
    hits?: Array<{
      largeImageURL?: string
      webformatURL?: string
      pageURL?: string
      tags?: string
      imageWidth?: number
      imageHeight?: number
      user?: string
    }>
  }

  return (data.hits ?? []).map((hit) => ({
    url: optimizeImageUrl(hit.largeImageURL || hit.webformatURL || ''),
    pageUrl: hit.pageURL || '',
    title: hit.tags || query,
    provider: 'pixabay' as const,
    sourceLabel: 'Pixabay',
    license: 'Pixabay Content License',
    author: hit.user || '',
    width: hit.imageWidth,
    height: hit.imageHeight,
    keyword: query,
  })).filter((item) => item.url && item.pageUrl)
}

async function searchUnsplash(query: string, limit: number): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) return []

  const params = new URLSearchParams({
    query,
    per_page: String(limit),
    orientation: 'landscape',
    content_filter: 'high',
  })

  const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []

  const data = await res.json() as {
    results?: Array<{
      alt_description?: string | null
      description?: string | null
      width?: number
      height?: number
      links?: { html?: string }
      user?: { name?: string }
      urls?: { regular?: string; full?: string; small?: string }
    }>
  }

  return (data.results ?? []).map((photo) => ({
    url: optimizeImageUrl(photo.urls?.regular || photo.urls?.full || photo.urls?.small || ''),
    pageUrl: photo.links?.html || '',
    title: photo.alt_description || photo.description || query,
    provider: 'unsplash' as const,
    sourceLabel: 'Unsplash',
    license: 'Unsplash License',
    author: photo.user?.name || '',
    width: photo.width,
    height: photo.height,
    keyword: query,
  })).filter((item) => item.url && item.pageUrl)
}

async function searchWikimedia(query: string, limit: number): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(Math.max(limit, 8)),
    prop: 'imageinfo|info',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1600',
    inprop: 'url',
    format: 'json',
    origin: '*',
  })

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'BlogPro/1.0 image service' },
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []

  const data = await res.json() as {
    query?: {
      pages?: Record<string, {
        title?: string
        canonicalurl?: string
        imageinfo?: Array<{
          thumburl?: string
          url?: string
          descriptionurl?: string
          extmetadata?: {
            LicenseShortName?: { value?: string }
            Artist?: { value?: string }
            ObjectName?: { value?: string }
          }
        }>
      }>
    }
  }

  const pages = Object.values(data.query?.pages ?? {})
  return pages.map((page) => {
    const info = page.imageinfo?.[0]
    return {
      url: optimizeImageUrl(info?.thumburl || info?.url || ''),
      pageUrl: info?.descriptionurl || page.canonicalurl || '',
      title: info?.extmetadata?.ObjectName?.value || page.title?.replace(/^File:/, '') || query,
      provider: 'wikimedia' as const,
      sourceLabel: 'Wikimedia Commons',
      license: info?.extmetadata?.LicenseShortName?.value || 'Wikimedia Commons License',
      author: info?.extmetadata?.Artist?.value || '',
      keyword: query,
    }
  }).filter((item) => item.url && item.pageUrl)
}

async function searchYoutubeThumbnails(query: string, limit: number): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return []

  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(Math.max(1, Math.min(10, limit))),
    safeSearch: 'strict',
  })

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { next: { revalidate: 1800 } })
  if (!res.ok) return []

  const data = await res.json() as {
    items?: Array<{
      id?: { videoId?: string }
      snippet?: {
        title?: string
        channelTitle?: string
        thumbnails?: {
          high?: { url?: string; width?: number; height?: number }
          medium?: { url?: string; width?: number; height?: number }
          default?: { url?: string; width?: number; height?: number }
        }
      }
    }>
  }

  return (data.items ?? []).map((item) => {
    const videoId = item.id?.videoId || ''
    const thumb = item.snippet?.thumbnails?.high || item.snippet?.thumbnails?.medium || item.snippet?.thumbnails?.default
    return {
      url: optimizeImageUrl(thumb?.url || ''),
      pageUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
      title: item.snippet?.title || query,
      provider: 'youtube' as const,
      sourceLabel: 'YouTube Thumbnail',
      license: 'YouTube Terms apply',
      author: item.snippet?.channelTitle || '',
      width: thumb?.width,
      height: thumb?.height,
      keyword: query,
    }
  }).filter((item) => item.url && item.pageUrl)
}

// ── Stable Diffusion prompt builder ─────────────────────────────────────────
// 한국어 주제를 SD 모델이 이해하는 영어 프롬프트로 변환합니다.
// 키워드 매핑으로 주제에 맞는 장면을 묘사하고, 비 연예인 포스트는 사람/얼굴을 제외합니다.
function buildSdPrompt(query: string, blogType?: string): string {
  const isCelebrity = blogType === 'celebrity'
  const q = query.trim()

  let subject: string
  let styleWords: string[]

  if (isCelebrity) {
    // 연예인 포스트: 인물 중심 프롬프트
    const cleanName = q.replace(/\s*(소개|프로필|최근|활동|사진|모음|이미지|관련|뉴스)\s*/g, ' ').trim()
    subject = `${cleanName}, celebrity portrait, professional photo shoot`
    styleWords = ['studio lighting', 'high fashion editorial']
  } else if (/침구|이불|베개|매트리스|침대|수면|숙면|잠/.test(q)) {
    subject = 'cozy modern bedroom, luxury white bedding, soft pillows, comfortable mattress, warm ambient lighting'
    styleWords = ['interior photography', 'hygge aesthetic', 'warm tones']
  } else if (/여행|관광|휴가|여름.*여행|여행지|해외여행|국내여행|배낭|힐링/.test(q)) {
    subject = 'beautiful travel destination, scenic landscape, vacation resort, blue sky, ocean or mountains'
    styleWords = ['travel photography', 'golden hour lighting', 'wide angle']
  } else if (/음식|요리|레시피|맛집|식당|카페|커피|디저트|베이킹|빵|케이크/.test(q)) {
    subject = 'delicious gourmet food dish, restaurant plating, fresh ingredients, beautifully styled'
    styleWords = ['food photography', 'soft natural lighting', 'overhead shot']
  } else if (/AI|인공지능|머신러닝|딥러닝|기술|테크|IT|소프트웨어|앱|개발|프로그래밍/.test(q)) {
    subject = 'artificial intelligence technology concept, glowing digital neural network, futuristic interface, circuit board'
    styleWords = ['tech visualization', 'blue neon abstract', 'digital art aesthetic']
  } else if (/건강|운동|피트니스|다이어트|헬스|요가|명상|웰니스/.test(q)) {
    subject = 'healthy lifestyle wellness concept, yoga mat, green smoothie bowl, sport equipment, nature background'
    styleWords = ['lifestyle photography', 'bright airy', 'clean health aesthetic']
  } else if (/투자|주식|재테크|금융|경제|비트코인|암호화폐|코인|펀드/.test(q)) {
    subject = 'financial investment concept, stock market charts on screen, modern business analytics dashboard'
    styleWords = ['business photography', 'corporate professional', 'blue tones']
  } else if (/부동산|집|아파트|인테리어|가구|거실|주방|홈/.test(q)) {
    subject = 'modern apartment interior design, contemporary minimalist living room, natural light'
    styleWords = ['interior photography', 'architecture photography', 'bright natural light']
  } else if (/패션|옷|의류|코디|스타일|쇼핑|가방|신발/.test(q)) {
    subject = 'stylish fashion clothing flat lay, accessories and outfit, clean white background'
    styleWords = ['fashion photography', 'product photography', 'editorial style']
  } else if (/반려동물|강아지|고양이|펫|애완/.test(q)) {
    subject = 'cute pet dog or cat playing, adorable animal close-up, soft background'
    styleWords = ['pet photography', 'natural lighting', 'bokeh background']
  } else if (/자동차|차|드라이브|SUV|세단/.test(q)) {
    subject = 'sleek modern car on scenic road, automotive photography, dramatic lighting'
    styleWords = ['automotive photography', 'motion blur', 'cinematic']
  } else if (/책|독서|공부|교육|학습|도서|문학/.test(q)) {
    subject = 'open book on wooden desk, cozy reading nook, warm library interior, study materials'
    styleWords = ['still life photography', 'warm library aesthetic']
  } else if (/환경|자연|생태|지구|숲|바다|산/.test(q)) {
    subject = 'beautiful nature landscape, lush forest river mountains sunrise, peaceful scenery'
    styleWords = ['nature photography', 'landscape photography', 'golden hour']
  } else if (/뷰티|화장품|스킨케어|메이크업|향수/.test(q)) {
    subject = 'luxury skincare beauty products arranged elegantly, cosmetics flat lay'
    styleWords = ['product photography', 'pastel tones', 'beauty editorial']
  } else {
    // 일반 폴백: 오브젝트/컨셉 이미지 (얼굴 없이)
    subject = 'clean editorial concept photo, professional product shot, abstract concept visualization'
    styleWords = ['editorial photography', 'clean bright background', 'studio lighting']
  }

  const noPersonTokens = isCelebrity ? [] : ['no people', 'no faces', 'no portrait', 'no humans']

  return [
    subject,
    ...styleWords,
    'high quality photo',
    '8k ultra detailed',
    'sharp focus',
    'professional lighting',
    'safe for work',
    ...noPersonTokens,
    'no text overlay',
    'no watermark',
    'no logo',
  ].join(', ')
}

function buildSdNegativePrompt(blogType?: string): string {
  const base = [
    'nsfw', 'nude', 'explicit', 'violence', 'gore',
    'text', 'watermark', 'logo', 'signature',
    'blurry', 'low quality', 'deformed', 'ugly', 'duplicate',
    'bad anatomy', 'extra limbs', 'mutation', 'disfigured',
  ]
  const noFace = blogType !== 'celebrity'
    ? ['person', 'people', 'human', 'face', 'portrait', 'hands', 'fingers', 'body parts']
    : []
  return [...base, ...noFace].join(', ')
}

// ── Stable Diffusion: ComfyUI (http://127.0.0.1:8188) ───────────────────────
// ComfyUI uses async queue: POST /prompt → poll /history/{id} → GET /view
async function generateWithLocalSD(query: string, sdModelOverride?: string, blogType?: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const baseUrl = (process.env.SD_COMFYUI_URL || '').replace(/\/$/, '')
  if (!baseUrl) return []

  const positivePrompt = buildSdPrompt(query, blogType)
  const negativePrompt = buildSdNegativePrompt(blogType)
  const width = Number(process.env.SD_WIDTH || 512)
  const height = Number(process.env.SD_HEIGHT || 512)
  const steps = Number(process.env.SD_STEPS || 10)
  const cfgScale = Number(process.env.SD_CFG_SCALE || 7)
  const model = sdModelOverride || process.env.SD_MODEL_CHECKPOINT || 'DreamShaper8_LCM.safetensors'
  const timeout = Number(process.env.SD_TIMEOUT_MS || 300_000) // CPU는 느려서 5분

  // ComfyUI workflow (node graph)
  const workflow = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: positivePrompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1e9),
        steps,
        cfg: cfgScale,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'blog-ai', images: ['8', 0] } },
  }

  try {
    // 1) 큐에 추가
    const queueRes = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!queueRes.ok) return []
    const { prompt_id } = await queueRes.json() as { prompt_id: string }
    if (!prompt_id) return []

    // 2) 완료될 때까지 폴링 (CPU라서 오래 걸릴 수 있음)
    const deadline = Date.now() + timeout
    type HistoryOutput = { images?: Array<{ filename: string; subfolder: string; type: string }> }
    type HistoryEntry = { outputs?: Record<string, HistoryOutput> }
    let outputs: Record<string, HistoryOutput> | undefined

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      const histRes = await fetch(`${baseUrl}/history/${prompt_id}`, { signal: AbortSignal.timeout(10_000) })
      if (!histRes.ok) continue
      const history = await histRes.json() as Record<string, HistoryEntry>
      if (history[prompt_id]?.outputs) {
        outputs = history[prompt_id].outputs
        break
      }
    }
    if (!outputs) return []

    // 3) 이미지 파일 정보 추출
    const nodeOut = Object.values(outputs).find((o) => (o.images?.length ?? 0) > 0)
    const img = nodeOut?.images?.[0]
    if (!img) return []

    // 4) 이미지 바이너리 → base64 data URI
    const viewRes = await fetch(
      `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`,
      { signal: AbortSignal.timeout(30_000) },
    )
    if (!viewRes.ok) return []

    const buf = await viewRes.arrayBuffer()
    const dataUrl = `data:image/png;base64,${Buffer.from(buf).toString('base64')}`

    return [{
      url: dataUrl,
      pageUrl: baseUrl,
      title: `${query} (Stable Diffusion via ComfyUI)`,
      provider: 'stable-diffusion' as const,
      sourceLabel: 'Stable Diffusion (ComfyUI)',
      license: 'AI Generated',
      keyword: query,
    }]
  } catch {
    return []
  }
}

// ── Stable Diffusion: StabilityAI cloud API ───────────────────────────────────
async function generateWithStabilityAI(query: string, blogType?: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const apiKey = process.env.STABILITY_API_KEY
  if (!apiKey) return []

  const engine = process.env.STABILITY_ENGINE || 'stable-image/generate/core'
  const prompt = buildSdPrompt(query, blogType)
  const negativePrompt = buildSdNegativePrompt(blogType)
  const width = Number(process.env.SD_WIDTH || 1344)
  const height = Number(process.env.SD_HEIGHT || 768)

  try {
    const formData = new FormData()
    formData.append('prompt', prompt)
    formData.append('negative_prompt', negativePrompt)
    formData.append('aspect_ratio', '16:9')
    formData.append('output_format', 'webp')
    formData.append('width', String(width))
    formData.append('height', String(height))

    const res = await fetch(`https://api.stability.ai/v2beta/${engine}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'image/*',
      },
      body: formData,
      signal: AbortSignal.timeout(Number(process.env.SD_TIMEOUT_MS || 60_000)),
    })

    if (!res.ok) return []

    const arrayBuf = await res.arrayBuffer()
    const b64 = Buffer.from(arrayBuf).toString('base64')
    const dataUrl = `data:image/webp;base64,${b64}`

    return [{
      url: dataUrl,
      pageUrl: 'https://stability.ai',
      title: `${query} (StabilityAI)`,
      provider: 'stable-diffusion' as const,
      sourceLabel: 'Stable Diffusion (StabilityAI)',
      license: 'AI Generated',
      keyword: query,
    }]
  } catch {
    return []
  }
}

// ── Combined AI image fallback (SD local → StabilityAI → OpenAI) ─────────────
async function generateSdImage(query: string, sdModelOverride?: string, blogType?: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const local = await generateWithLocalSD(query, sdModelOverride, blogType)
  if (local.length > 0) return local

  const cloud = await generateWithStabilityAI(query, blogType)
  if (cloud.length > 0) return cloud

  return []
}

async function generateAiImage(query: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openAiKey) return []

  try {
    const client = new OpenAI({ apiKey: openAiKey })
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
    const result = await client.images.generate({
      model,
      prompt: `${query}, high quality editorial illustration, safe-for-work`,
      size: '1536x1024',
    })

    const imageUrl = result.data?.[0]?.url || ''
    if (!imageUrl) return []

    return [{
      url: imageUrl,
      pageUrl: imageUrl,
      title: `${query} AI generated illustration`,
      provider: 'ai-generated' as const,
      sourceLabel: 'AI Generated',
      license: 'Generated content',
      keyword: query,
    }]
  } catch {
    return []
  }
}

function createPlaceholderImage(query: string): Omit<ImageCandidate, 'relevanceScore'> {
  const keyword = encodeURIComponent((extractKeywords(query)[0] || 'blog-image'))
  const url = `https://placehold.co/1400x900/1a1a1a/555555.webp?text=${keyword}`
  return {
    url,
    pageUrl: url,
    title: `${query} placeholder image`,
    provider: 'placeholder',
    sourceLabel: 'Placeholder',
    license: 'Placeholder',
    keyword: query,
  }
}

async function fetchProviderImages(query: string, count: number, issueTopic: boolean) {
  const tasks: Array<Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>>> = [
    searchWikimedia(query, count),
    searchPexels(query, count),
    searchPixabay(query, count),
    searchUnsplash(query, count),
  ]

  if (issueTopic) {
    tasks.push(searchYoutubeThumbnails(query, count))
  }

  const resultBatches = await Promise.all(tasks)
  return resultBatches.flat()
}

export async function resolveImagesForPost(options: ResolveImageOptions): Promise<ImageCandidate[]> {
  const topic = (options.topic || '').trim()
  if (!topic) return []

  const count = Math.max(1, Math.min(10, options.count || 6))
  const keywords = extractKeywords(topic)
  const cacheKey = `${options.blogType}|${topic}|${count}`
  const issueTopic = options.blogType === 'celebrity' || looksLikeIssueTopic(topic)

  const cached = memoryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.slice(0, count)
  }

  const preferred = (options.preferredImages || []).map((img) => ({
    url: optimizeImageUrl(img.url),
    pageUrl: img.source,
    title: img.title || topic,
    provider: 'wikimedia' as const,
    sourceLabel: 'Manual Selection',
    license: 'Provided by user',
    relevanceScore: 500,
  }))

  const isOllama = options.provider === 'ollama'
  const sdComfyUrl = process.env.SD_COMFYUI_URL

  // When using local LLM (Ollama) + ComfyUI is configured: generate SD images concurrently
  // with stock image fetching, then prefer SD results.
  const [fetched, earlySdImages] = await Promise.all([
    fetchProviderImages(topic, count + 4, issueTopic),
    isOllama && sdComfyUrl ? generateSdImage(topic, options.sdModel, options.blogType) : Promise.resolve([]),
  ])

  const usedSet = await getUsedImageSet()

  const cleaned = dedupeImages(fetched)
    .filter((item) => !containsNsfw(`${item.title} ${item.pageUrl}`))
    .filter((item) => !usedSet.has(item.url))
    .map((item) => ({
      ...item,
      relevanceScore: computeRelevance(item, topic, keywords, issueTopic),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  // SD images get a high relevance score when Ollama is the provider so they appear first
  const SD_OLLAMA_PRIORITY = 200
  const scoredEarlySd = earlySdImages.map((item) => ({
    ...item,
    relevanceScore: isOllama ? SD_OLLAMA_PRIORITY : computeRelevance(item, topic, keywords, issueTopic),
  }))

  let selected = [...preferred, ...scoredEarlySd, ...cleaned].slice(0, count)

  if (selected.length < count) {
    // Stable Diffusion fallback (local → StabilityAI cloud) — only if not already fetched above
    if (!isOllama || !sdComfyUrl) {
      const sdImages = await generateSdImage(topic, options.sdModel)
      const scoredSd = sdImages.map((item) => ({
        ...item,
        relevanceScore: computeRelevance(item, topic, keywords, issueTopic),
      }))
      selected = [...selected, ...scoredSd].slice(0, count)
    }
  }

  if (selected.length < count) {
    // OpenAI DALL-E / gpt-image fallback
    const aiImages = await generateAiImage(topic)
    const scoredAi = aiImages.map((item) => ({
      ...item,
      relevanceScore: computeRelevance(item, topic, keywords, issueTopic),
    }))
    selected = [...selected, ...scoredAi].slice(0, count)
  }

  if (selected.length < count) {
    selected.push({
      ...createPlaceholderImage(topic),
      relevanceScore: 1,
    })
  }

  await persistUsedImages(selected.map((item) => item.url))
  memoryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items: selected })
  return selected.slice(0, count)
}

export function injectImageEnhancements(html: string, images: ImageCandidate[]): string {
  if (!html.trim()) return html

  // ── Step 0: Replace LLM-fabricated image URLs with real fetched images ──────
  // Small local LLMs (e.g. gemma4:e2b) often hallucinate invalid image URLs
  // (picsum.photos, random unsplash IDs, etc.) instead of using the provided ones.
  // Replace any <img src> or CSS background-image URL that is NOT a trusted URL
  // (data:image/, wsrv.nl proxy, or placehold.co) with a real URL from imageCandidates.
  const TRUSTED_URL_PREFIXES = ['data:image/', 'https://wsrv.nl/', 'https://placehold.co/']
  const knownCandidateUrls = new Set(images.map((img) => img.url))
  const stockPool = images.filter(
    (img) => img.provider !== 'stable-diffusion' && img.provider !== 'ai-generated' && img.provider !== 'placeholder',
  )
  let stockReplaceIdx = 0
  const isTrustedUrl = (src: string) =>
    TRUSTED_URL_PREFIXES.some((p) => src.startsWith(p)) || knownCandidateUrls.has(src)
  const nextStockUrl = (): string | null => {
    if (!stockPool.length) return null
    const url = stockPool[stockReplaceIdx % stockPool.length].url
    stockReplaceIdx++
    return url
  }
  let next = html
    .replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
      const m = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
      if (!m || isTrustedUrl(m[1])) return full
      const rep = nextStockUrl()
      return rep ? full.replace(m[0], `src="${rep}"`) : full
    })
    .replace(/background-image\s*:\s*url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi, (full, src: string) => {
      if (isTrustedUrl(src.trim())) return full
      const rep = nextStockUrl()
      return rep ? `background-image: url("${rep}")` : full
    })

  // 기존 <img> 태그에 lazy loading / async decoding 추가
  next = next.replace(/<img\b([^>]*)>/gi, (_full, attrs) => {
    let patched = attrs as string
    if (!/\sloading\s*=\s*['"]/i.test(patched)) patched += ' loading="lazy"'
    if (!/\sdecoding\s*=\s*['"]/i.test(patched)) patched += ' decoding="async"'
    return `<img${patched}>`
  })

  // SD/AI 이미지는 hasImage 여부와 무관하게 항상 본문 첫 단락 뒤에 주입
  // (LLM이 stock 이미지를 HTML에 embed해도 SD 이미지가 반드시 노출되도록)
  const originalHasImage = /<img\b/i.test(next)
  const sdImages = images.filter(
    (img) => img.provider === 'stable-diffusion' || img.provider === 'ai-generated',
  )
  if (sdImages.length > 0) {
    let sdInjected = false
    next = next.replace(/<\/(p|h[2-6])>/gi, (closingTag) => {
      if (sdInjected) return closingTag
      sdInjected = true
      const img = sdImages[0]
      const safeAlt = img.title.replace(/"/g, '&quot;')
      const figure = `\n<figure style="margin:2em auto;text-align:center"><img src="${img.url}" alt="${safeAlt}" loading="lazy" decoding="async" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto" /><figcaption style="text-align:center;font-size:0.8em;color:#999;margin-top:6px">🎨 AI Generated</figcaption></figure>\n`
      return `${closingTag}${figure}`
    })
  }

  // LLM이 스톡 이미지를 넣지 않은 경우에만 스톡 이미지를 문단 사이에 주입
  if (!originalHasImage) {
    const stockImages = images.filter(
      (img) => img.provider !== 'stable-diffusion' && img.provider !== 'ai-generated',
    )
    if (stockImages.length > 0) {
      let imgIdx = 0
      let blockCount = 0
      const INJECT_EVERY = 2

      next = next.replace(/<\/(p|h[2-4]|ul|ol|blockquote)>/gi, (closingTag) => {
        blockCount++
        if (blockCount % INJECT_EVERY === 0 && imgIdx < stockImages.length) {
          const img = stockImages[imgIdx++]
          const captionHtml = `<figcaption style="text-align:center;font-size:0.8em;color:#999;margin-top:6px">📷 <a href="${img.pageUrl}" target="_blank" rel="noopener noreferrer" style="color:#999">${img.sourceLabel}</a></figcaption>`
          const safeAlt = img.title.replace(/"/g, '&quot;')
          const figure = `\n<figure style="margin:2em auto;text-align:center"><img src="${img.url}" alt="${safeAlt}" loading="lazy" decoding="async" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto" />${captionHtml}</figure>\n`
          return `${closingTag}${figure}`
        }
        return closingTag
      })
    }
  }

  // 외부 이미지 출처만 숨김 표시 (AI 생성 이미지 제외)
  const sourceLines = images.slice(0, 6)
    .filter((img) => img.provider !== 'stable-diffusion' && img.provider !== 'ai-generated')
    .map((img) => `📷 Source: ${img.sourceLabel} (${img.pageUrl})`)
    .join('<br/>')

  if (sourceLines) {
    const sourceBlock = `<div class="ts-image-sources" style="display:none">${sourceLines}</div>`
    next = next.includes('</body>') ? next.replace('</body>', `${sourceBlock}</body>`) : `${next}${sourceBlock}`
  }

  return next
}
