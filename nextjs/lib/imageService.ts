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
// 한국어 주제를 SD에서 잘 동작하는 영어 프롬프트로 변환합니다.
function buildSdPrompt(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ')
  const base = [
    normalized,
    'high quality photo',
    'editorial style',
    'professional photography',
    'sharp focus',
    '8k resolution',
    'safe for work',
    'no text',
    'no watermark',
  ].join(', ')
  return base
}

const SD_NEGATIVE_PROMPT = [
  'nsfw', 'nude', 'explicit', 'violence', 'gore', 'text', 'watermark',
  'logo', 'blurry', 'low quality', 'deformed', 'ugly', 'duplicate',
].join(', ')

// ── Stable Diffusion: local WebUI (AUTOMATIC1111 / Forge / ComfyUI) ──────────
async function generateWithLocalSD(query: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const baseUrl = (process.env.SD_WEBUI_URL || 'http://127.0.0.1:7860').replace(/\/$/, '')
  if (!process.env.SD_WEBUI_URL) return []

  const prompt = buildSdPrompt(query)
  const width = Number(process.env.SD_WIDTH || 1344)
  const height = Number(process.env.SD_HEIGHT || 768)
  const steps = Number(process.env.SD_STEPS || 20)
  const cfgScale = Number(process.env.SD_CFG_SCALE || 7)
  const model = process.env.SD_MODEL_CHECKPOINT || ''

  const payload: Record<string, unknown> = {
    prompt,
    negative_prompt: SD_NEGATIVE_PROMPT,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    sampler_name: process.env.SD_SAMPLER || 'DPM++ 2M Karras',
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true,
  }
  if (model) payload.override_settings = { sd_model_checkpoint: model }

  try {
    const res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(process.env.SD_TIMEOUT_MS || 120_000)),
    })

    if (!res.ok) return []

    const data = await res.json() as { images?: string[] }
    const b64 = data.images?.[0]
    if (!b64) return []

    // base64 이미지를 data URI로 반환 — Ghost 업로드 또는 다이렉트 삽입에 사용
    const dataUrl = `data:image/png;base64,${b64}`
    return [{
      url: dataUrl,
      pageUrl: baseUrl,
      title: `${query} (Stable Diffusion)`,
      provider: 'stable-diffusion' as const,
      sourceLabel: 'Stable Diffusion (Local)',
      license: 'AI Generated',
      keyword: query,
    }]
  } catch {
    return []
  }
}

// ── Stable Diffusion: StabilityAI cloud API ───────────────────────────────────
async function generateWithStabilityAI(query: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const apiKey = process.env.STABILITY_API_KEY
  if (!apiKey) return []

  const engine = process.env.STABILITY_ENGINE || 'stable-image/generate/core'
  const prompt = buildSdPrompt(query)
  const width = Number(process.env.SD_WIDTH || 1344)
  const height = Number(process.env.SD_HEIGHT || 768)

  try {
    const formData = new FormData()
    formData.append('prompt', prompt)
    formData.append('negative_prompt', SD_NEGATIVE_PROMPT)
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
async function generateSdImage(query: string): Promise<Array<Omit<ImageCandidate, 'relevanceScore'>>> {
  const local = await generateWithLocalSD(query)
  if (local.length > 0) return local

  const cloud = await generateWithStabilityAI(query)
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

  const fetched = await fetchProviderImages(topic, count + 4, issueTopic)
  const usedSet = await getUsedImageSet()

  const cleaned = dedupeImages(fetched)
    .filter((item) => !containsNsfw(`${item.title} ${item.pageUrl}`))
    .filter((item) => !usedSet.has(item.url))
    .map((item) => ({
      ...item,
      relevanceScore: computeRelevance(item, topic, keywords, issueTopic),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  let selected = [...preferred, ...cleaned].slice(0, count)

  if (selected.length < count) {
    // Stable Diffusion fallback (local WebUI → StabilityAI cloud)
    const sdImages = await generateSdImage(topic)
    const scoredSd = sdImages.map((item) => ({
      ...item,
      relevanceScore: computeRelevance(item, topic, keywords, issueTopic),
    }))
    selected = [...selected, ...scoredSd].slice(0, count)
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

  let next = html.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    let patched = attrs as string
    if (!/\sloading\s*=\s*['"][^'"]+['"]/i.test(patched)) patched += ' loading="lazy"'
    if (!/\sdecoding\s*=\s*['"][^'"]+['"]/i.test(patched)) patched += ' decoding="async"'
    return `<img${patched}>`
  })

  const hasImage = /<img\b/i.test(next)
  if (!hasImage && images.length > 0) {
    const gallery = images.slice(0, 2).map((img) => (
      `<figure><img src="${img.url}" alt="${img.title}" loading="lazy" decoding="async" /><figcaption>📷 Source: <a href="${img.pageUrl}" target="_blank" rel="noopener">${img.sourceLabel}</a></figcaption></figure>`
    )).join('')

    const block = `<section class="ts-auto-gallery"><h2>관련 이미지</h2>${gallery}</section>`
    next = next.includes('</body>') ? next.replace('</body>', `${block}</body>`) : `${next}${block}`
  }

  const sourceLines = images.slice(0, 6)
    .map((img) => `📷 Source: ${img.sourceLabel} (${img.pageUrl})`)
    .join('<br/>')

  const sourceBlock = `<div class="ts-image-sources" style="display:none">${sourceLines}</div>`
  next = next.includes('</body>') ? next.replace('</body>', `${sourceBlock}</body>`) : `${next}${sourceBlock}`

  return next
}
