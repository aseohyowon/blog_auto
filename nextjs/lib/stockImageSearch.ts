export interface StockImage {
  url: string
  pageUrl: string
  title: string
  source: 'pexels' | 'pixabay'
}

// ── Pexels ────────────────────────────────────────────────────────────────────
interface PexelsPhoto {
  id: number
  alt: string
  url: string
  src: { large: string; large2x: string; medium: string }
}

interface PexelsResponse {
  photos?: PexelsPhoto[]
}

async function searchPexels(query: string, limit: number): Promise<StockImage[]> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) return []

  const params = new URLSearchParams({
    query,
    per_page: String(limit),
    orientation: 'landscape',
  })

  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: apiKey },
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []

  const data = (await res.json()) as PexelsResponse
  return (data.photos ?? []).map((photo) => ({
    url: photo.src.large ?? photo.src.medium,
    pageUrl: photo.url,
    title: photo.alt || query,
    source: 'pexels' as const,
  }))
}

// ── Pixabay ───────────────────────────────────────────────────────────────────
interface PixabayHit {
  largeImageURL: string
  webformatURL: string
  pageURL: string
  tags: string
}

interface PixabayResponse {
  hits?: PixabayHit[]
}

async function searchPixabay(query: string, limit: number): Promise<StockImage[]> {
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

  const res = await fetch(`https://pixabay.com/api/?${params}`, {
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []

  const data = (await res.json()) as PixabayResponse
  return (data.hits ?? []).map((hit) => ({
    url: hit.largeImageURL || hit.webformatURL,
    pageUrl: hit.pageURL,
    title: hit.tags || query,
    source: 'pixabay' as const,
  }))
}

// ── Combined search: Pexels first, Pixabay as fallback ───────────────────────
export async function searchStockImages(query: string, limit = 5): Promise<StockImage[]> {
  const safeLimit = Math.max(1, Math.min(10, limit))

  const pexelsResults = await searchPexels(query, safeLimit)
  if (pexelsResults.length >= safeLimit) {
    return pexelsResults.slice(0, safeLimit)
  }

  const remaining = safeLimit - pexelsResults.length
  const pixabayResults = await searchPixabay(query, remaining + 2)

  const combined = [...pexelsResults, ...pixabayResults]
  return combined.slice(0, safeLimit)
}
