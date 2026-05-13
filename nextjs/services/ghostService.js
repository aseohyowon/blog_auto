import crypto from 'node:crypto'

const DEFAULT_API_VERSION = process.env.GHOST_API_VERSION || 'v5.0'

const GHOST_URL_MISSING_MESSAGE = 'GHOST_URL이 설정되지 않았습니다. .env 파일을 확인해주세요.'
const GHOST_KEY_MISSING_MESSAGE = 'GHOST_ADMIN_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.'
const GHOST_KEY_INVALID_MESSAGE = 'GHOST_ADMIN_API_KEY 형식이 올바르지 않습니다. {id}:{secret} 형식인지 확인해주세요.'
const GHOST_AUTH_FAILED_MESSAGE = 'Ghost 인증에 실패했습니다. Admin API Key를 다시 확인해주세요.'
const GHOST_CONNECTION_FAILED_MESSAGE = 'Ghost 서버에 연결하지 못했습니다. URL 또는 서버 상태를 확인해주세요.'

function createError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/$/, '')
}

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function parseAdminApiKey(rawKey) {
  const value = String(rawKey || '').trim()
  if (!value) {
    throw createError(GHOST_KEY_MISSING_MESSAGE, 500)
  }

  const parts = value.split(':')
  if (parts.length !== 2) {
    throw createError(GHOST_KEY_INVALID_MESSAGE, 400)
  }

  const [id, secret] = parts
  if (!id || !secret || !/^[a-fA-F0-9]+$/.test(secret)) {
    throw createError(GHOST_KEY_INVALID_MESSAGE, 400)
  }

  return { id, secret }
}

function createGhostAdminToken(adminApiKey) {
  const { id, secret } = parseAdminApiKey(adminApiKey)
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 5 * 60

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: id,
  }

  const payload = {
    iat: issuedAt,
    exp: expiresAt,
    aud: '/admin/',
  }

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
  const signature = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(unsignedToken)
    .digest()

  return `${unsignedToken}.${base64UrlEncode(signature)}`
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []

  const seen = new Set()
  const list = []

  for (const rawTag of tags) {
    if (typeof rawTag !== 'string') continue
    const name = rawTag.replace(/^#/, '').trim().slice(0, 40)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ name })
    if (list.length >= 20) break
  }

  return list
}

function normalizeFeatureImageUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function extractFirstImageUrlFromHtml(html) {
  if (typeof html !== 'string' || !html) return ''
  const matches = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  const src = matches?.[1] ?? ''
  return normalizeFeatureImageUrl(src)
}

export async function createGhostPost({ title, html, excerpt, tags, featureImageUrl, status }) {
  const ghostUrl = normalizeUrl(process.env.GHOST_URL)
  if (!ghostUrl) {
    throw createError(GHOST_URL_MISSING_MESSAGE, 500)
  }

  const adminApiKey = process.env.GHOST_ADMIN_API_KEY
  if (!adminApiKey) {
    throw createError(GHOST_KEY_MISSING_MESSAGE, 500)
  }

  const trimmedTitle = typeof title === 'string' ? title.trim() : ''
  const trimmedHtml = typeof html === 'string' ? html.trim() : ''
  const trimmedExcerpt = typeof excerpt === 'string' ? excerpt.trim() : ''

  if (!trimmedTitle) {
    throw createError('Ghost 업로드용 제목이 비어 있습니다.', 400)
  }
  if (!trimmedHtml) {
    throw createError('Ghost 업로드용 본문 HTML이 비어 있습니다.', 400)
  }

  const nextStatus = status === 'published' ? 'published' : 'draft'

  const payloadPost = {
    title: trimmedTitle,
    html: trimmedHtml,
    status: nextStatus,
  }

  if (trimmedExcerpt) {
    payloadPost.custom_excerpt = trimmedExcerpt.slice(0, 300)
  }

  const normalizedFeatureImageUrl =
    normalizeFeatureImageUrl(featureImageUrl) || extractFirstImageUrlFromHtml(trimmedHtml)
  if (normalizedFeatureImageUrl) {
    payloadPost.feature_image = normalizedFeatureImageUrl
  }

  const normalizedTags = normalizeTags(tags)
  if (normalizedTags.length > 0) {
    payloadPost.tags = normalizedTags
  }

  if (nextStatus === 'published') {
    payloadPost.published_at = new Date().toISOString()
  }

  const jwt = createGhostAdminToken(adminApiKey)
  const apiVersion = process.env.GHOST_API_VERSION || DEFAULT_API_VERSION
  const endpoint = `${ghostUrl}/ghost/api/admin/posts/?source=html`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Version': apiVersion,
        'Authorization': `Ghost ${jwt}`,
      },
      body: JSON.stringify({ posts: [payloadPost] }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const apiMessage = data?.errors?.[0]?.message || data?.message
      if (response.status === 401 || response.status === 403) {
        throw createError(GHOST_AUTH_FAILED_MESSAGE, 401)
      }
      throw createError(apiMessage || `Ghost API 요청 실패 (${response.status})`, response.status)
    }

    const post = Array.isArray(data?.posts) ? data.posts[0] : null
    if (!post) {
      throw createError('Ghost API 응답에서 포스트 정보를 찾지 못했습니다.', 502)
    }

    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      url: post.url,
      status: post.status,
      adminUrl: `${ghostUrl}/ghost/#/editor/post/${post.id}`,
    }
  } catch (error) {
    if (error instanceof Error && typeof error.status === 'number') {
      throw error
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    if (
      message.includes('fetch failed') ||
      message.includes('failed to fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      throw createError(GHOST_CONNECTION_FAILED_MESSAGE, 503)
    }

    throw createError('Ghost 업로드 중 알 수 없는 오류가 발생했습니다.', 500)
  }
}

export {
  GHOST_URL_MISSING_MESSAGE,
  GHOST_KEY_MISSING_MESSAGE,
  GHOST_KEY_INVALID_MESSAGE,
  GHOST_AUTH_FAILED_MESSAGE,
  GHOST_CONNECTION_FAILED_MESSAGE,
}
