export interface SafeImageItem {
  imageUrl: string
  pageUrl: string
  title: string
  sourceName: string
  license: string
  author: string
}

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php'

const NAME_ALIASES: Record<string, string[]> = {
  '나연': ['Nayeon', 'Im Nayeon'],
  '아이유': ['IU', 'Lee Ji-eun'],
  '정국': ['Jungkook', 'Jeon Jungkook'],
  '제니': ['Jennie', 'Jennie Kim'],
  '장원영': ['Jang Wonyoung'],
  '카리나': ['Karina', 'Yu Jimin'],
}

function stripHtml(value: string | undefined): string {
  if (!value) return ''
  return value.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

export async function searchSafeImages(query: string, limit = 6): Promise<SafeImageItem[]> {
  const safeLimit = Math.max(1, Math.min(10, limit))
  const normalized = query.trim().replace(/\s+/g, ' ')

  const firstToken = normalized.split(' ')[0] ?? normalized
  const aliasQueries = Object.entries(NAME_ALIASES)
    .filter(([key]) => normalized.includes(key) || firstToken === key)
    .flatMap(([, aliases]) => aliases)

  const queryCandidates = [
    normalized,
    firstToken,
    `${firstToken} 공연`,
    `${firstToken} concert`,
    ...aliasQueries,
    ...aliasQueries.map((alias) => `${alias} concert`),
  ]
  const uniqueCandidates = [...new Set(queryCandidates.map((candidate) => candidate.trim()).filter(Boolean))]

  const collected: SafeImageItem[] = []
  const seen = new Set<string>()

  for (const candidate of uniqueCandidates) {
    if (collected.length >= safeLimit) break

    const batch = await searchCommons(candidate, Math.max(6, safeLimit * 2))
    for (const item of batch) {
      if (seen.has(item.pageUrl)) continue
      seen.add(item.pageUrl)
      collected.push(item)
      if (collected.length >= safeLimit) break
    }
  }

  return collected.slice(0, safeLimit)
}

async function searchCommons(query: string, fetchLimit: number): Promise<SafeImageItem[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(Math.max(10, fetchLimit)),
    prop: 'imageinfo|info',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1200',
    inprop: 'url',
    format: 'json',
    origin: '*',
  })

  const res = await fetch(`${COMMONS_API_URL}?${params.toString()}`, {
    headers: { 'User-Agent': 'BlogPro/1.0 (safe image search)' },
    next: { revalidate: 3600 },
  })

  if (!res.ok) {
    throw new Error(`Wikimedia Commons API ${res.status}`)
  }

  const data = (await res.json()) as {
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
            ImageDescription?: { value?: string }
            ObjectName?: { value?: string }
          }
        }>
      }>
    }
  }

  const pages = Object.values(data.query?.pages ?? {})

  return pages
    .map((page) => {
      const info = page.imageinfo?.[0]
      const metadata = info?.extmetadata
      const rawUrl = info?.thumburl || info?.url || ''
      const rawTitle = page.title || ''
      const title = stripHtml(metadata?.ObjectName?.value) || stripHtml(metadata?.ImageDescription?.value) || rawTitle.replace(/^File:/, '') || 'Wikimedia Commons image'
      const imageUrl = rawUrl
      const pageUrl = info?.descriptionurl || page.canonicalurl || ''

      return {
        imageUrl,
        pageUrl,
        title,
        sourceName: 'Wikimedia Commons',
        license: stripHtml(metadata?.LicenseShortName?.value) || 'License info on source page',
        author: stripHtml(metadata?.Artist?.value) || 'Unknown author',
        _rawUrl: rawUrl,
        _rawTitle: rawTitle,
      }
    })
    .filter((item) => {
      if (!item.imageUrl || !item.pageUrl) return false
      const lowerUrl = item._rawUrl.toLowerCase()
      const lowerTitle = item._rawTitle.toLowerCase()
      if (lowerUrl.includes('.pdf')) return false
      if (/\b(18|19)\d{2}-\d{2}-\d{2}\b/.test(item._rawTitle)) return false
      if (/\.(svg|tif|tiff|djvu|ogg|ogv|webm|mp3|wav|pdf)(\.|$)/i.test(lowerUrl)) return false
      if (lowerTitle.includes('newspaper') || lowerTitle.includes('archive')) return false
      return true
    })
    .map(({ _rawUrl: _u, _rawTitle: _t, ...rest }) => rest)
    .slice(0, fetchLimit)
}