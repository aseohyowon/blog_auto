'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Header from './Header'
import OutputPanel from './OutputPanel'
import Toast, { type ToastData, type ToastType } from './Toast'
import HistoryDrawer from './HistoryDrawer'
import { useHistory, type HistoryItem } from '@/lib/useHistory'
import { useUsage, FREE_LIMIT } from '@/lib/useUsage'
import PremiumModal from './PremiumModal'

interface SafeImageItem {
  imageUrl: string
  pageUrl: string
  title: string
  sourceName: string
  license: string
  author: string
}

interface OfficialSourceItem {
  title: string
  url: string
  snippet: string
  kind: string
}

// ── Config ────────────────────────────────────────────────────────────────────
const TONES = [
  '정보 전달형',
  '친근한 대화체',
  '전문적 분석형',
  '리뷰형',
  '튜토리얼형',
  '감성 에세이',
] as const

const LENGTHS = [
  { value: 'medium', label: '보통', sub: '~1000자' },
  { value: 'long',   label: '길게', sub: '~2000자' },
] as const

const BLOG_TYPES = [
  { value: 'general',   label: '기본 블로그',      icon: '📝' },
  { value: 'review',    label: '리뷰',              icon: '⭐' },
  { value: 'travel',    label: '여행 가이드',        icon: '✈️' },
  { value: 'it-news',   label: 'IT정보/뉴스',      icon: '📰' },
  { value: 'celebrity', label: '아이돌/연예인 소개', icon: '🎤' },
] as const

const CELEBRITY_OPTIONS = [
  'IU',
  'BTS 정국',
  'BLACKPINK 제니',
  'NewJeans 민지',
  'IVE 장원영',
  '에스파 카리나',
  '변우석',
  '김수현',
  '차은우',
  '손흥민',
]

interface ModelOption {
  value: string
  label: string
  sub: string
}

interface Provider {
  id: string
  name: string
  icon: string
  description: string
  models: ModelOption[]
}

const PROVIDERS: Provider[] = [
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    description: '초고속 추론 · 무료',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', sub: '고품질' },
      { value: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B',  sub: '초고속' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    icon: '💎',
    description: 'Google AI · 무료',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', sub: '빠르고 스마트' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', sub: '안정적' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    description: '다양한 모델 · 무료 포함',
    models: [
      { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', sub: '무료' },
      { value: 'google/gemma-2-9b-it:free',              label: 'Gemma 2 9B',    sub: '무료' },
      { value: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1',   sub: '무료 · 추론' },
    ],
  },
]

type Length = (typeof LENGTHS)[number]['value']
type BlogType = (typeof BLOG_TYPES)[number]['value']

// ── Component ─────────────────────────────────────────────────────────────────
export default function Generator() {
  const [topic,       setTopic]       = useState('')
  const [blogType,    setBlogType]    = useState<BlogType>('general')
  const [celebrity,   setCelebrity]   = useState<string>(CELEBRITY_OPTIONS[0])
  const [celebrityOptions, setCelebrityOptions] = useState<string[]>(CELEBRITY_OPTIONS)
  const [celebrityInput, setCelebrityInput] = useState('')
  const [imageCount, setImageCount] = useState(6)
  const [safeImages, setSafeImages] = useState<SafeImageItem[]>([])
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([])
  const [safeImageLoading, setSafeImageLoading] = useState(false)
  const [safeImageNote, setSafeImageNote] = useState('')
  const [officialSources, setOfficialSources] = useState<OfficialSourceItem[]>([])
  const [officialSourcesLoading, setOfficialSourcesLoading] = useState(false)
  const [officialSourcesNote, setOfficialSourcesNote] = useState('')
  const [tone,        setTone]        = useState<string>(TONES[0])
  const [length,      setLength]      = useState<Length>('medium')
  const [provider,    setProvider]    = useState('groq')
  const [model,       setModel]       = useState('llama-3.3-70b-versatile')
  const [html,        setHtml]        = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [tokens,      setTokens]      = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showPremium, setShowPremium] = useState(false)
  const [toast,       setToast]       = useState<ToastData | null>(null)
  const [cooldown,    setCooldown]    = useState(0)   // seconds remaining before retry
  const [keywords,    setKeywords]    = useState<string[]>([])
  const [kwLoading,   setKwLoading]   = useState(false)
  const [kwCategory,  setKwCategory]  = useState('전체')

  const textareaRef   = useRef<HTMLTextAreaElement>(null)
  const toastTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown tick
  useEffect(() => {
    if (cooldown <= 0) return
    cooldownTimer.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimer.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(cooldownTimer.current!)
  }, [cooldown])

  const { history, push, remove, clear } = useHistory()
  const { used, remaining, isPremium, canGenerate, recordUsage, unlockPremium, activateDemoPremium } = useUsage()

  const currentProvider = PROVIDERS.find(p => p.id === provider) ?? PROVIDERS[0]

  const handleProviderChange = (id: string) => {
    setProvider(id)
    const prov = PROVIDERS.find(p => p.id === id)
    if (prov) setModel(prov.models[0].value)
  }

  const fetchKeywords = useCallback(async (cat?: string) => {
    const category = cat ?? kwCategory
    setKwLoading(true)
    try {
      const params = category !== '전체' ? `?category=${encodeURIComponent(category)}` : ''
      const res = await fetch(`/api/keywords${params}`)
      const data = (await res.json()) as { keywords?: string[] }
      if (data.keywords && data.keywords.length > 0) {
        setKeywords(data.keywords)
      }
    } catch { /* silent */ }
    finally { setKwLoading(false) }
  }, [kwCategory])

  const handleCategoryChange = (cat: string) => {
    setKwCategory(cat)
    void fetchKeywords(cat)
  }

  // Auto-fetch keywords on mount / blog type change
  useEffect(() => {
    if (blogType === 'celebrity') return
    void fetchKeywords()
  }, [fetchKeywords, blogType])

  const fetchSafeImages = useCallback(async (name?: string, count?: number) => {
    const query = (name ?? celebrity).trim()
    const limit = count ?? imageCount
    if (!query || blogType !== 'celebrity') return

    setSafeImageLoading(true)
    try {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      })
      const res = await fetch(`/api/safe-images?${params.toString()}`)
      const data = (await res.json()) as {
        images?: SafeImageItem[]
        note?: string
        blockedSources?: string[]
      }
      const nextImages = data.images ?? []
      setSafeImages(nextImages)
      setSelectedImageUrls((prev) => {
        const nextSelected = prev.filter((url) => nextImages.some((image) => image.imageUrl === url))
        if (nextSelected.length > 0) return nextSelected.slice(0, limit)
        return nextImages.slice(0, limit).map((image) => image.imageUrl)
      })
      setSafeImageNote([
        data.note,
        data.blockedSources?.length ? `제외 소스: ${data.blockedSources.join(', ')}` : '',
      ].filter(Boolean).join(' · '))
    } catch {
      setSafeImages([])
      setSafeImageNote('이미지 검색 중 오류가 발생했습니다.')
    } finally {
      setSafeImageLoading(false)
    }
  }, [blogType, celebrity, imageCount])

  const fetchOfficialSources = useCallback(async (name?: string) => {
    const query = (name ?? celebrity).trim()
    if (!query || blogType !== 'celebrity') return

    setOfficialSourcesLoading(true)
    try {
      const params = new URLSearchParams({ query })
      const res = await fetch(`/api/celebrity-sources?${params.toString()}`)
      const data = (await res.json()) as { sources?: OfficialSourceItem[]; note?: string }
      setOfficialSources(data.sources ?? [])
      setOfficialSourcesNote(data.note ?? '')
    } catch {
      setOfficialSources([])
      setOfficialSourcesNote('공식 출처 검색 중 오류가 발생했습니다.')
    } finally {
      setOfficialSourcesLoading(false)
    }
  }, [blogType, celebrity])

  useEffect(() => {
    if (celebrityOptions.length === 0) {
      setCelebrity('')
      return
    }
    if (!celebrityOptions.includes(celebrity)) {
      setCelebrity(celebrityOptions[0])
    }
  }, [celebrityOptions, celebrity])

  useEffect(() => {
    if (blogType !== 'celebrity') {
      setSafeImages([])
      setSelectedImageUrls([])
      setSafeImageNote('')
      setOfficialSources([])
      setOfficialSourcesNote('')
      return
    }
    void fetchSafeImages()
    void fetchOfficialSources()
  }, [blogType, celebrity, imageCount, fetchSafeImages, fetchOfficialSources])

  const showToast = useCallback((message: string, type: ToastType) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  const addCelebrityOption = () => {
    const normalized = celebrityInput.trim()
    if (!normalized) return
    if (celebrityOptions.includes(normalized)) {
      setCelebrity(normalized)
      setCelebrityInput('')
      return
    }
    setCelebrityOptions(prev => [normalized, ...prev])
    setCelebrity(normalized)
    setCelebrityInput('')
  }

  const removeCelebrityOption = (name: string) => {
    setCelebrityOptions(prev => {
      if (prev.length <= 1) return prev
      return prev.filter(item => item !== name)
    })
  }

  const toggleSelectedImage = (url: string) => {
    setSelectedImageUrls((prev) => {
      if (prev.includes(url)) return prev.filter((item) => item !== url)
      if (prev.length >= imageCount) return [...prev.slice(1), url]
      return [...prev, url]
    })
  }

  const generate = async () => {
    if (!canGenerate) { setShowPremium(true); return }
    if (cooldown > 0) return

    const isCelebrityMode = blogType === 'celebrity'
    const trimmed = topic.trim()
    if (isCelebrityMode && !celebrity.trim()) {
      setError('아이돌/연예인을 선택해주세요.')
      return
    }
    if (!isCelebrityMode && !trimmed) {
      textareaRef.current?.focus()
      setError('주제를 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const selectedImages = safeImages
        .filter((image) => selectedImageUrls.includes(image.imageUrl))
        .slice(0, imageCount)
        .map((image) => ({
          url: image.imageUrl,
          source: image.pageUrl,
          title: image.title,
        }))

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: trimmed,
          tone,
          length,
          model,
          provider,
          blogType,
          celebrity,
          imageCount,
          selectedImages,
        }),
      })

      const data = (await res.json()) as {
        html?: string
        error?: string
        retryAfter?: number
        usage?: { total_tokens?: number }
      }

      if (!res.ok) {
        if (data.retryAfter && data.retryAfter > 0) {
          setCooldown(data.retryAfter)
        }
        throw new Error(data.error ?? '오류가 발생했습니다.')
      }

      const generatedHtml   = data.html ?? ''
      const generatedTokens = data.usage?.total_tokens ?? null
      const resolvedTopic = isCelebrityMode
        ? `${celebrity} 소개글`
        : trimmed

      setHtml(generatedHtml)
      setTokens(generatedTokens)
      if (isCelebrityMode) setTopic(resolvedTopic)

      push({ topic: resolvedTopic, tone, model, html: generatedHtml, tokens: generatedTokens })
      recordUsage()

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const loadHistoryItem = (item: HistoryItem) => {
    setTopic(item.topic)
    setHtml(item.html)
    setTokens(item.tokens)
    setTone(item.tone)
    setModel(item.model)
    setError('')
    setShowHistory(false)
    showToast(`"${item.topic.slice(0, 24)}…" 기록을 불러왔습니다.`, 'info')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate()
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 lg:px-8 py-8 flex flex-col gap-7">

        {/* ── Page title row ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">새 포스트 생성</h1>
            <p className="text-xs text-zinc-600 mt-0.5">주제 입력 후 Ctrl+Enter 또는 생성하기 클릭</p>
          </div>

          {/* Usage counter + history */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isPremium ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-900/50 bg-gradient-to-r from-red-950/60 to-rose-950/40 text-[11px] font-bold text-red-400">
                ✦ Premium
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowPremium(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 text-[11px] font-medium hover:border-zinc-600 transition-all duration-200 group"
              >
                <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">오늘</span>
                <span className={`font-bold tabular-nums mx-0.5 ${remaining === 0 ? 'text-red-400' : 'text-zinc-200'}`}>
                  {used}/{FREE_LIMIT}
                </span>
                <span className="text-zinc-700 mx-0.5">·</span>
                <span className="text-red-500 group-hover:text-red-400 font-semibold transition-colors">업그레이드</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 text-xs font-medium transition-all duration-200"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              기록
              {history.length > 0 && (
                <span className="bg-red-900/50 text-red-400 border border-red-900/50 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── API Provider selector ─────────────────────────────────── */}
        <section aria-label="API 선택" className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
            API 프로바이더
          </span>
          <div className="grid grid-cols-3 gap-3">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProviderChange(p.id)}
                className={`relative flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all duration-200 ${
                  provider === p.id
                    ? 'border-red-600 bg-red-600/10 shadow-[0_0_0_1px_rgba(224,49,49,0.3)] ring-1 ring-red-600/20'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <span className="text-xl flex-shrink-0">{p.icon}</span>
                <div className="min-w-0">
                  <span className={`block font-bold text-[13px] truncate ${provider === p.id ? 'text-red-400' : 'text-zinc-200'}`}>
                    {p.name}
                  </span>
                  <span className="block text-[10px] text-zinc-500 truncate">{p.description}</span>
                </div>
                {provider === p.id && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ── Settings row ─────────────────────────────────────────────── */}
        <section aria-label="생성 설정" className="bg-zinc-900/50 border border-zinc-800/70 rounded-2xl p-5 flex flex-wrap gap-4 items-end transition-all duration-300">

          {/* Blog Type */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              블로그 선택
            </span>
            <div className="flex flex-wrap gap-2">
              {BLOG_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    setBlogType(type.value)
                    setError('')
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    blogType === type.value
                      ? 'border-red-600 bg-red-600/10 text-red-400'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  <span>{type.icon}</span>
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Celebrity selector */}
          {blogType === 'celebrity' && (
            <div className="flex flex-col gap-1.5 min-w-[260px]">
              <label htmlFor="celebrity-select" className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
                아이돌/연예인 선택
              </label>
              <select
                id="celebrity-select"
                value={celebrity}
                onChange={(e) => {
                  setCelebrity(e.target.value)
                  setError('')
                }}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/20 transition-colors cursor-pointer appearance-none"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                {celebrityOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={celebrityInput}
                  onChange={(e) => setCelebrityInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCelebrityOption()
                    }
                  }}
                  placeholder="직접 추가 (예: 르세라핌 사쿠라)"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-red-600/60"
                />
                <button
                  type="button"
                  onClick={addCelebrityOption}
                  className="px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-xs font-semibold text-zinc-300 hover:border-red-600 hover:text-red-400 transition-colors"
                >
                  추가
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {celebrityOptions.map((name) => (
                  <button
                    key={`chip-${name}`}
                    type="button"
                    onClick={() => removeCelebrityOption(name)}
                    className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                      celebrity === name
                        ? 'border-red-600/70 bg-red-600/10 text-red-300'
                        : 'border-zinc-800 bg-zinc-900/80 text-zinc-500 hover:text-zinc-300'
                    }`}
                    title="클릭하면 목록에서 제거"
                  >
                    {name} ×
                  </button>
                ))}
              </div>
            </div>
          )}

          {blogType === 'celebrity' && (
            <div className="flex flex-col gap-1.5 min-w-[160px]">
              <label htmlFor="image-count-select" className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
                이미지 개수
              </label>
              <select
                id="image-count-select"
                value={imageCount}
                onChange={(e) => setImageCount(Number(e.target.value))}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/20 transition-colors cursor-pointer appearance-none"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                {Array.from({ length: 8 }, (_, idx) => idx + 3).map((count) => (
                  <option key={count} value={count}>{count}장</option>
                ))}
              </select>
            </div>
          )}

          {/* Tone */}
          <div className="flex flex-col gap-1.5 min-w-[160px]">
            <label htmlFor="tone-select" className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              글 톤
            </label>
            <select
              id="tone-select"
              value={tone}
              onChange={e => setTone(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/20 transition-colors cursor-pointer appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
            >
              {TONES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Length — show for non-celebrity types */}
          {blogType !== 'celebrity' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
                분량
              </span>
              <div className="flex gap-2">
                {LENGTHS.map(l => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLength(l.value)}
                    className={`flex flex-col items-center px-5 py-2 rounded-xl border text-sm transition-all ${
                      length === l.value
                        ? 'border-red-600 bg-red-600/10 text-red-400 shadow-[0_0_0_1px_rgba(224,49,49,0.3)]'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    <span className="font-semibold text-[13px]">{l.label}</span>
                    <span className="text-[11px] opacity-70">{l.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              모델
            </span>
            <div className="flex gap-2">
              {currentProvider.models.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setModel(m.value)}
                  className={`flex flex-col items-start px-4 py-2 rounded-xl border text-sm transition-all ${
                    model === m.value
                      ? 'border-red-600 bg-red-600/10 text-red-400'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  <span className="font-semibold text-[12px]">{m.label}</span>
                  <span className="text-[10px] opacity-70">{m.sub}</span>
                </button>
              ))}
            </div>
          </div>

        </section>

        {/* ── Keyword suggestions ────────────────────────────────────── */}
        {blogType !== 'celebrity' && (
        <section aria-label="추천 키워드" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              🔥 추천 키워드
            </span>
            <button
              type="button"
              onClick={() => void fetchKeywords()}
              disabled={kwLoading}
              className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={kwLoading ? 'animate-spin' : ''}
              >
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                <polyline points="21 3 21 12 12 12" />
              </svg>
              새로고침
            </button>
          </div>
          {/* Category tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {['전체','IT·테크','여행','음식·맛집','재테크','건강·운동','자기계발','리뷰','이슈·트렌드'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategoryChange(cat)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all duration-200 ${
                  kwCategory === cat
                    ? 'border-red-600 bg-red-600/15 text-red-400'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {kwLoading && keywords.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="h-8 w-28 rounded-full bg-zinc-800/60 animate-pulse" />
              ))
            ) : keywords.length > 0 ? (
              keywords.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => { setTopic(kw); setError(''); textareaRef.current?.focus() }}
                  className={`px-3.5 py-1.5 rounded-full border text-[12px] font-medium transition-all duration-200 ${
                    topic === kw
                      ? 'border-red-600 bg-red-600/15 text-red-400'
                      : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/80'
                  }`}
                >
                  {kw}
                </button>
              ))
            ) : (
              <span className="text-xs text-zinc-700">키워드를 불러오지 못했습니다</span>
            )}
          </div>
        </section>
        )}

        {blogType === 'celebrity' && (
          <section aria-label="안전 이미지 검색 결과" className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">출처 포함 이미지 모음</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Wikimedia Commons 기반 이미지만 표시합니다. 짤티비 같은 비공식 이미지 사이트는 제외합니다.
                </p>
                <p className="text-[11px] text-zinc-600 mt-1">
                  원하는 이미지를 선택하면 생성 결과에 우선 반영됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchSafeImages()}
                disabled={safeImageLoading || !celebrity}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={safeImageLoading ? 'animate-spin' : ''}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  <polyline points="21 3 21 12 12 12" />
                </svg>
                새로고침
              </button>
            </div>

            {safeImageNote && (
              <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                {safeImageNote}
              </div>
            )}

            {safeImageLoading && safeImages.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="h-52 rounded-2xl bg-zinc-800/50 animate-pulse" />
                ))}
              </div>
            ) : safeImages.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {safeImages.map((image) => (
                  <article key={image.pageUrl} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
                    <img
                      src={image.imageUrl}
                      alt={image.title}
                      className="w-full h-52 object-cover bg-zinc-900"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <div className="p-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSelectedImage(image.imageUrl)}
                        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          selectedImageUrls.includes(image.imageUrl)
                            ? 'border-red-600 bg-red-600/10 text-red-300'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {selectedImageUrls.includes(image.imageUrl) ? '선택됨' : '생성에 포함'}
                      </button>
                      <h3 className="text-sm font-semibold text-zinc-100 line-clamp-2">{image.title}</h3>
                      <p className="text-xs text-zinc-500">저작권/라이선스: {image.license}</p>
                      <p className="text-xs text-zinc-600">작성자: {image.author}</p>
                      <a
                        href={image.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2"
                      >
                        출처 보기 ({image.sourceName})
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500 text-center">
                표시할 안전 이미지가 없습니다. 다른 인물명으로 다시 시도해보세요.
              </div>
            )}
          </section>
        )}

        {blogType === 'celebrity' && (
          <section aria-label="공식 출처 링크" className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">공식 출처 링크</h2>
                <p className="text-xs text-zinc-500 mt-1">공식 SNS, 유튜브, 위키 등 확인용 링크 후보입니다.</p>
              </div>
              <button
                type="button"
                onClick={() => void fetchOfficialSources()}
                disabled={officialSourcesLoading || !celebrity}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={officialSourcesLoading ? 'animate-spin' : ''}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  <polyline points="21 3 21 12 12 12" />
                </svg>
                새로고침
              </button>
            </div>

            {officialSourcesNote && (
              <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                {officialSourcesNote}
              </div>
            )}

            {officialSources.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {officialSources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 hover:border-red-600/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">{source.kind}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-100 line-clamp-2">{source.title}</h3>
                    <p className="text-xs text-zinc-500 mt-2 line-clamp-3">{source.snippet || source.url}</p>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500 text-center">
                표시할 공식 링크 후보가 없습니다.
              </div>
            )}
          </section>
        )}

        {/* ── Topic input ───────────────────────────────────────────────── */}
        <section aria-label="주제 입력" className="flex flex-col gap-3">
          {blogType !== 'celebrity' ? (
            <div className="relative group">
              <textarea
                ref={textareaRef}
                id="topic"
                value={topic}
                onChange={e => { setTopic(e.target.value); if (error) setError('') }}
                onKeyDown={onKeyDown}
                placeholder={
                  blogType === 'review'
                    ? "리뷰할 제품/서비스를 입력하세요\n예) 갤럭시 S25 울트라 · 에어팟 프로 2세대 · 쿠팡이츠 배달 서비스"
                    : blogType === 'travel'
                    ? "여행지를 입력하세요\n예) 도쿄 3박4일 · 제주도 혼자여행 · 방콕 가성비 여행"
                    : blogType === 'it-news'
                    ? "IT 주제를 입력하세요\n예) 애플 WWDC 2026 발표 · 오픈AI GPT-5 출시 · 삼성 갤럭시 AI 기능"
                    : "블로그 주제를 입력하세요\n예) 파이썬으로 웹 크롤링하는 방법 · 미니멀 라이프 시작하기 · 제주도 3박4일 여행기"
                }
                rows={3}
                maxLength={200}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 text-sm text-zinc-100 placeholder-zinc-700 outline-none focus:border-red-600/60 focus:ring-2 focus:ring-red-600/10 resize-none transition-all leading-relaxed"
              />
              <span className="absolute bottom-3.5 right-4 text-xs text-zinc-700 font-mono tabular-nums pointer-events-none">
                {topic.length}/200
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 text-sm text-zinc-300">
              <p className="font-semibold text-zinc-100">선택된 인물: {celebrity}</p>
              <p className="text-xs text-zinc-500 mt-1">
                선택한 아이돌/연예인을 기준으로 간단 소개글과 이미지 3~10장이 포함된 포스트를 생성합니다.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-950/40 border border-red-900/50 rounded-xl text-sm text-red-400 animate-fade-in">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* Generate button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={loading || cooldown > 0}
              className="btn-pulse flex items-center gap-2.5 px-7 py-3 bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all duration-200 shadow-lg shadow-red-900/30 active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                  생성 중...
                </>
              ) : cooldown > 0 ? (
                <>
                  <span className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin flex-shrink-0" />
                  {cooldown}초 후 재시도
                </>
              ) : (
                <>
                  <span className="text-red-200">✦</span>
                  {blogType === 'celebrity' ? '소개글 생성하기' : '생성하기'}
                  {blogType === 'general' && (
                    <span className="text-xs text-red-300/70 font-normal hidden sm:block">Ctrl+Enter</span>
                  )}
                </>
              )}
            </button>
          </div>
        </section>

        {/* ── Output ───────────────────────────────────────────────────── */}
        <section aria-label="생성 결과" className="flex-1 pb-8">
          <OutputPanel
            html={html}
            loading={loading}
            tokens={tokens}
            topic={topic}
            showToast={showToast}
          />
        </section>

      </main>

      {/* ── Premium modal ─────────────────────────────────────────────── */}
      <PremiumModal
        show={showPremium}
        used={used}
        onClose={() => setShowPremium(false)}
        onUnlock={unlockPremium}
        onActivate={activateDemoPremium}
      />

      {/* ── History drawer ────────────────────────────────────────────── */}
      <HistoryDrawer
        show={showHistory}
        history={history}
        onClose={() => setShowHistory(false)}
        onLoad={loadHistoryItem}
        onRemove={remove}
        onClear={clear}
      />

      {/* ── Toast ────────────────────────────────────────────────────── */}
      <Toast toast={toast} />

    </div>
  )
}
