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

const SCHEDULE_CATEGORIES = [
  'IT·테크',
  '여행',
  '음식·맛집',
  '재테크',
  '건강·운동',
  '자기계발',
  '리뷰',
  '이슈·트렌드',
]

interface GhostScheduleItem {
  id: string
  runAt: number
  status: string
  category: string
  categories: string[]
  intervalHours: number
  ghostStatus: string
  provider: string
  model: string
  startTime?: string
  repeat?: boolean
}

interface ModelOption {
  value: string
  label: string
  sub: string
}

function formatModelSize(size: number | null | undefined): string {
  if (typeof size !== 'number' || Number.isNaN(size) || size <= 0) return '로컬 모델'
  const gb = size / (1024 ** 3)
  return `${gb.toFixed(1)}GB`
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
    id: 'ollama',
    name: 'Local Ollama',
    icon: '🦙',
    description: '로컬 모델 선택',
    models: [],
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function toSummaryBullets(paragraphs: string[], keyword: string): string[] {
  const base = paragraphs
    .filter((p) => p.length >= 30)
    .slice(0, 4)
    .map((p) => p.length > 95 ? `${p.slice(0, 95)}...` : p)

  if (base.length >= 4) return base

  const fallback = [
    `${keyword} 관련 핵심 내용을 빠르게 정리했습니다.`,
    `${keyword}의 주요 변화와 배경을 이해하기 쉽게 설명합니다.`,
    `${keyword}가 시장과 사용자 경험에 미치는 영향을 짚어봅니다.`,
    `${keyword}를 기준으로 비교 포인트와 체크 포인트를 제시합니다.`,
  ]

  return [...base, ...fallback].slice(0, 4)
}

function convertGeneralHtmlToItNews(sourceHtml: string, fallbackTopic: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(sourceHtml, 'text/html')
  doc.querySelectorAll('script').forEach((node) => node.remove())

  const title = normalizeText(
    doc.querySelector('h1')?.textContent
      ?? doc.querySelector('h2')?.textContent
      ?? fallbackTopic
      ?? 'IT 정보 뉴스 브리핑',
  ) || 'IT 정보 뉴스 브리핑'

  const keyword = title.length > 40 ? title.slice(0, 40) : title
  const now = new Date()
  const dateText = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`

  const paragraphs = Array.from(doc.querySelectorAll('p'))
    .map((node) => normalizeText(node.textContent ?? ''))
    .filter(Boolean)

  const headings = Array.from(doc.querySelectorAll('h2, h3'))
    .map((node) => normalizeText(node.textContent ?? ''))
    .filter(Boolean)

  const imageList = Array.from(doc.querySelectorAll('img'))
    .map((img) => ({
      src: (img.getAttribute('src') ?? '').trim(),
      alt: normalizeText(img.getAttribute('alt') ?? ''),
    }))
    .filter((img) => img.src.startsWith('http'))

  const heroImage = imageList[0]?.src ?? 'https://placehold.co/860x510/060d1a/1e3a5f?text=IT+News'
  const galleryA = imageList[1]?.src ?? 'https://placehold.co/600x420/060d1a/1e3a5f?text=Tech+Update'
  const galleryB = imageList[2]?.src ?? 'https://placehold.co/600x420/060d1a/1e3a5f?text=Market+Brief'

  const summaryBullets = toSummaryBullets(paragraphs, keyword)
  const bodyChunks = [
    paragraphs.slice(0, 2),
    paragraphs.slice(2, 4),
    paragraphs.slice(4, 6),
  ]

  const sectionTitles = [
    headings[0] || `${keyword} 핵심 이슈 정리`,
    headings[1] || `${keyword} 기술 변화와 영향`,
    headings[2] || `${keyword} 실사용 관점 체크포인트`,
  ]

  const totalChars = normalizeText(doc.body.textContent ?? '').length
  const hCount = doc.querySelectorAll('h1,h2,h3').length
  const pCount = paragraphs.length
  const imageCount = imageList.length

  const statValues = [
    `${Math.max(1, Math.round(totalChars / 120))}분`,
    `${Math.max(1, hCount)}개`,
    `${Math.max(1, pCount)}문단`,
    `${Math.max(1, imageCount)}장`,
  ]

  const sectionBody = (idx: number): string => {
    const items = bodyChunks[idx]
    if (items.length === 0) {
      return `<p>${escapeHtml(keyword)} 관련 내용을 기반으로 핵심 정보를 재구성했습니다. 이번 섹션에서는 중요한 변화 포인트를 중심으로 독자가 바로 이해할 수 있게 정리합니다.</p>
      <p>세부 수치나 일정은 변동될 수 있으므로 최신 공식 발표와 함께 확인하는 것이 좋습니다. 필요한 경우 체크리스트 형태로 비교하며 읽어보세요.</p>`
    }
    return items.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
  }

  return `<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
.it-wrap{max-width:860px;margin:0 auto;padding:20px 16px;font-family:'Noto Sans KR',sans-serif;color:#e2e8f0;background:#060d1a}
.it-label{display:block;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#38bdf8;margin-bottom:10px;font-weight:700}
.it-hero{position:relative;min-height:460px;border-radius:16px;overflow:hidden;margin-bottom:36px;background-image:url('${escapeHtml(heroImage)}');background-size:cover;background-position:center}
.it-hero::before{content:'';position:absolute;inset:0;background:linear-gradient(160deg,rgba(6,13,26,.92) 0%,rgba(14,50,100,.55) 100%)}
.it-hero-inner{position:relative;z-index:1;padding:60px 44px}
.it-hero-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.it-breaking{background:#ef4444;color:#fff;font-size:10px;font-weight:900;padding:3px 10px;border-radius:4px;letter-spacing:1.3px}
.it-category{background:#1e3a5f;color:#38bdf8;font-size:11px;font-weight:700;padding:3px 12px;border-radius:4px}
.it-date{color:rgba(255,255,255,.52);font-size:12px}
.it-hero h1{font-size:2.1rem;font-weight:900;color:#fff;margin:0 0 10px;line-height:1.25}
.it-hero-sub{font-size:1rem;color:rgba(255,255,255,.8);line-height:1.75;max-width:620px;margin:0}
.it-keypoints{background:#0a1628;border:1px solid #1e3a5f;border-radius:14px;padding:24px 28px;margin:30px 0}
.it-keypoints ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
.it-keypoints li{display:flex;align-items:flex-start;gap:12px;font-size:14px;color:#cbd5e1;line-height:1.7}
.it-kp-dot{width:8px;height:8px;border-radius:50%;background:#38bdf8;flex-shrink:0;margin-top:8px}
.it-body h2{font-size:1.24rem;font-weight:800;color:#f0f9ff;margin:34px 0 12px;border-left:3px solid #38bdf8;padding-left:12px}
.it-body p{font-size:15px;color:#cbd5e1;line-height:1.84;margin:0 0 14px}
.it-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:32px 0}
.it-stat-card{background:#0a1628;border:1px solid #1e3a5f;border-radius:14px;padding:20px 14px;text-align:center}
.it-stat-num{font-size:1.85rem;font-weight:900;color:#38bdf8;line-height:1;margin-bottom:6px}
.it-stat-label{font-size:12px;color:#94a3b8}
.it-table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;margin:30px 0}
.it-table thead th{background:#0a1628;color:#38bdf8;font-size:12px;padding:14px 16px;text-align:left}
.it-table td{padding:12px 16px;border-bottom:1px solid #1e3a5f;font-size:14px;color:#cbd5e1;line-height:1.5}
.it-table tr:nth-child(even) td{background:#080f1e}
.it-best{color:#38bdf8;font-weight:700}
.it-timeline{position:relative;padding-left:34px;margin:30px 0}
.it-timeline::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,#38bdf8,#0ea5e9,transparent)}
.it-tl-item{position:relative;margin-bottom:24px}
.it-tl-item::before{content:'';position:absolute;left:-26px;top:5px;width:12px;height:12px;border-radius:50%;background:#38bdf8;border:2px solid #060d1a}
.it-tl-date{font-size:11px;color:#38bdf8;font-weight:700;letter-spacing:1px;margin-bottom:4px}
.it-tl-item h3{font-size:15px;color:#f0f9ff;margin:0 0 4px}
.it-tl-item p{font-size:14px;color:#94a3b8;line-height:1.68;margin:0}
.it-expert{background:#0a1628;border:1px solid #1e3a5f;border-radius:16px;padding:30px;margin:30px 0}
.it-expert-quote{font-size:16px;color:#e2e8f0;line-height:1.9;font-style:italic;margin:0 0 14px}
.it-expert-name{font-size:14px;font-weight:700;color:#f0f9ff}
.it-expert-title{font-size:12px;color:#64748b}
.it-gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:30px 0}
.it-gallery img{width:100%;height:auto;max-height:250px;object-fit:cover;border-radius:10px;border:1px solid #1e3a5f;display:block}
.it-img-caption{font-size:12px;color:#64748b;margin-top:6px;text-align:center}
.it-cta{background:linear-gradient(135deg,#020810 0%,#0a1a30 100%);border:1px solid rgba(56,189,248,.28);border-radius:18px;padding:44px 36px;text-align:center;margin:40px 0}
.it-cta h2{color:#fff;font-size:1.4rem;margin:0 0 10px}
.it-cta p{color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 20px}
.it-cta-btn{display:inline-block;background:linear-gradient(90deg,#0ea5e9,#38bdf8);color:#001018;padding:13px 34px;border-radius:10px;font-weight:900;font-size:14px;text-decoration:none}
.it-footer{border-top:1px solid #1e3a5f;margin-top:48px;padding-top:22px}
.it-tag{display:inline-block;background:#0a1628;border:1px solid #1e3a5f;border-radius:999px;padding:5px 10px;font-size:12px;margin:0 6px 7px 0;color:#38bdf8}
.it-close{margin-top:10px;font-size:14px;color:#94a3b8;line-height:1.75}
@media (max-width:600px){
  .it-hero-inner{padding:40px 20px}
  .it-hero h1{font-size:1.6rem}
  .it-stats{grid-template-columns:repeat(2,1fr)}
  .it-gallery{grid-template-columns:1fr}
}
</style>
<div class="it-wrap">
  <section class="it-hero">
    <div class="it-hero-inner">
      <div class="it-hero-meta">
        <span class="it-breaking">BREAKING</span>
        <span class="it-category">IT NEWS</span>
        <span class="it-date">${escapeHtml(dateText)}</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p class="it-hero-sub">${escapeHtml(keyword)} 관련 핵심 포인트를 빠르게 읽을 수 있도록 기존 글 내용을 뉴스 포맷으로 재구성했습니다.</p>
    </div>
  </section>

  <section>
    <span class="it-label">KEY TAKEAWAYS</span>
    <div class="it-keypoints">
      <ul>
        ${summaryBullets.map((item) => `<li><span class="it-kp-dot"></span>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  </section>

  <section class="it-body">
    <span class="it-label">FULL ARTICLE</span>
    <h2>${escapeHtml(sectionTitles[0])}</h2>
    ${sectionBody(0)}
    <h2>${escapeHtml(sectionTitles[1])}</h2>
    ${sectionBody(1)}
    <h2>${escapeHtml(sectionTitles[2])}</h2>
    ${sectionBody(2)}
  </section>

  <section>
    <span class="it-label">BY THE NUMBERS</span>
    <div class="it-stats">
      <div class="it-stat-card"><div class="it-stat-num">${escapeHtml(statValues[0])}</div><div class="it-stat-label">읽기 예상 시간</div></div>
      <div class="it-stat-card"><div class="it-stat-num">${escapeHtml(statValues[1])}</div><div class="it-stat-label">핵심 섹션 수</div></div>
      <div class="it-stat-card"><div class="it-stat-num">${escapeHtml(statValues[2])}</div><div class="it-stat-label">분석 문단 수</div></div>
      <div class="it-stat-card"><div class="it-stat-num">${escapeHtml(statValues[3])}</div><div class="it-stat-label">참조 이미지 수</div></div>
    </div>
  </section>

  <section>
    <span class="it-label">SPEC COMPARISON</span>
    <table class="it-table">
      <thead>
        <tr><th>항목</th><th>${escapeHtml(keyword)}</th><th>이전/대안 A</th><th>대안 B</th></tr>
      </thead>
      <tbody>
        <tr><td>핵심 포지션</td><td class="it-best">최신 이슈 반영</td><td>기존 흐름 유지</td><td>보수적 접근</td></tr>
        <tr><td>정보 밀도</td><td class="it-best">높음</td><td>보통</td><td>보통</td></tr>
        <tr><td>업데이트 속도</td><td class="it-best">빠름</td><td>중간</td><td>중간</td></tr>
        <tr><td>실사용 관점</td><td class="it-best">체크포인트 제공</td><td>요약 중심</td><td>개념 중심</td></tr>
        <tr><td>추천 독자</td><td class="it-best">트렌드 추적형</td><td>입문자</td><td>참고용 독자</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <span class="it-label">TIMELINE</span>
    <div class="it-timeline">
      <div class="it-tl-item"><div class="it-tl-date">STEP 1</div><h3>이슈 발생</h3><p>${escapeHtml(keyword)} 관련 주요 변화가 처음 포착되었습니다.</p></div>
      <div class="it-tl-item"><div class="it-tl-date">STEP 2</div><h3>핵심 정보 공개</h3><p>세부 정보와 비교 포인트가 공개되며 관심이 확대됐습니다.</p></div>
      <div class="it-tl-item"><div class="it-tl-date">STEP 3</div><h3>시장 반응</h3><p>사용자 관점에서 체감 가능한 장단점이 본격적으로 논의됐습니다.</p></div>
      <div class="it-tl-item"><div class="it-tl-date">STEP 4</div><h3>실사용 정리</h3><p>현재 시점에서 확인 가능한 체크리스트와 선택 기준이 정리됐습니다.</p></div>
    </div>
  </section>

  <section>
    <span class="it-label">EXPERT ANALYSIS</span>
    <div class="it-expert">
      <p class="it-expert-quote">"${escapeHtml(keyword)}는 단순한 기능 추가보다, 사용자가 체감하는 맥락과 연결될 때 가치가 커집니다. 이번 변화는 속도보다 방향성 검증이 중요한 국면입니다."</p>
      <div class="it-expert-name">김테크 애널리스트</div>
      <div class="it-expert-title">디지털 제품 전략 연구원</div>
    </div>
  </section>

  <section>
    <span class="it-label">GALLERY</span>
    <div class="it-gallery">
      <figure><img src="${escapeHtml(galleryA)}" alt="${escapeHtml(keyword)} 관련 이미지 1" /><figcaption class="it-img-caption">핵심 포인트 시각 자료</figcaption></figure>
      <figure><img src="${escapeHtml(galleryB)}" alt="${escapeHtml(keyword)} 관련 이미지 2" /><figcaption class="it-img-caption">비교 관점 시각 자료</figcaption></figure>
    </div>
  </section>

  <section class="it-cta">
    <h2>${escapeHtml(keyword)} 후속 업데이트도 놓치지 마세요</h2>
    <p>이번 이슈와 연결되는 다음 변화까지 빠르게 확인할 수 있도록 핵심 포인트를 계속 업데이트합니다.</p>
    <a class="it-cta-btn" href="#">관련 이슈 더 보기</a>
  </section>

  <footer class="it-footer">
    <span class="it-tag">#IT뉴스</span>
    <span class="it-tag">#테크트렌드</span>
    <span class="it-tag">#${escapeHtml(keyword.replace(/\s+/g, ''))}</span>
    <span class="it-tag">#기술분석</span>
    <span class="it-tag">#업데이트</span>
    <p class="it-close">기존 기본 블로그 콘텐츠를 바탕으로 IT 정보/뉴스 형식으로 재구성한 결과입니다. 핵심 흐름을 빠르게 확인하고, 상세 판단은 최신 공식 정보와 함께 검토하세요.</p>
  </footer>
</div>`
}

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
  const [ollamaStatus, setOllamaStatus] = useState('')
  const [ollamaChecking, setOllamaChecking] = useState(false)
  const [tokens,      setTokens]      = useState<number | null>(null)
  const [lastGeneratedType, setLastGeneratedType] = useState<BlogType | null>(null)
  const [lastGeneralTopic, setLastGeneralTopic] = useState('')
  const [lastGeneralHtml, setLastGeneralHtml] = useState('')
  const [transforming, setTransforming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showPremium, setShowPremium] = useState(false)
  const [toast,       setToast]       = useState<ToastData | null>(null)
  const [cooldown,    setCooldown]    = useState(0)   // seconds remaining before retry
  const [keywords,    setKeywords]    = useState<string[]>([])
  const [kwLoading,   setKwLoading]   = useState(false)
  const [kwCategory,  setKwCategory]  = useState('전체')
  const [ghostScheduleStartTime, setGhostScheduleStartTime] = useState('09:00')
  const [ghostScheduleIntervalHours, setGhostScheduleIntervalHours] = useState(24)
  const [ghostScheduleStatus, setGhostScheduleStatus] = useState<'draft' | 'published'>('published')
  const [ghostScheduleCategories, setGhostScheduleCategories] = useState<string[]>(['IT·테크'])
  const [ghostScheduleSaving, setGhostScheduleSaving] = useState(false)
  const [ghostScheduleMessage, setGhostScheduleMessage] = useState('')
  const [showScheduleList, setShowScheduleList] = useState(false)
  const [scheduleList, setScheduleList] = useState<GhostScheduleItem[]>([])
  const [scheduleListLoading, setScheduleListLoading] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([])

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
  const currentModelOptions = provider === 'ollama' ? ollamaModels : currentProvider.models

  const handleProviderChange = (id: string) => {
    setProvider(id)
    const prov = PROVIDERS.find(p => p.id === id)
    if (id === 'ollama') {
      const localFirst = ollamaModels[0]?.value
      if (localFirst) {
        setModel(localFirst)
      } else if (prov?.models[0]) {
        setModel(prov.models[0].value)
      }
    } else if (prov?.models[0]) {
      setModel(prov.models[0].value)
    }
    setOllamaStatus(id === 'ollama' ? 'Ollama 연결 상태를 확인 중입니다.' : '')
  }

  const checkOllamaConnection = useCallback(async (manual = false) => {
    setOllamaChecking(true)
    try {
      const res = await fetch('/api/ollama/tags')
      const data = await res.json() as {
        message?: string
        error?: string
        models?: Array<{ name?: string; model?: string; size?: number | null }>
      }

      if (!res.ok) {
        const message = data.error ?? data.message ?? 'Ollama 연결에 실패했습니다.'
        setOllamaStatus(message)
        setOllamaModels([])
        if (manual) setError(message)
        return
      }

      const nextModels = (data.models ?? [])
        .map((item) => {
          const value = item.name?.trim() || item.model?.trim() || ''
          if (!value) return null
          return {
            value,
            label: value,
            sub: formatModelSize(item.size),
          }
        })
        .filter((item): item is ModelOption => item !== null)

      setOllamaModels(nextModels)

      if (nextModels.length > 0) {
        if (!nextModels.some((item) => item.value === model)) {
          setModel(nextModels[0].value)
        }
        setOllamaStatus(`${nextModels.length}개 로컬 모델을 찾았습니다. 사용 모델을 선택하세요.`)
        setError('')
        return
      }

      const message = data.error ?? '설치된 Ollama 모델이 없습니다. ollama pull <모델명> 으로 먼저 내려받아주세요.'
      setOllamaStatus(message)
      if (manual) setError(message)
    } catch {
      const message = 'Ollama가 실행 중인지 확인해주세요. Ollama 앱을 실행하거나 ollama serve 명령어를 실행하세요.'
      setOllamaStatus(message)
      setOllamaModels([])
      if (manual) setError(message)
    } finally {
      setOllamaChecking(false)
    }
  }, [model])

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

  const toggleScheduleCategory = (category: string) => {
    setGhostScheduleCategories((prev) => {
      if (prev.includes(category)) {
        const next = prev.filter((item) => item !== category)
        return next.length > 0 ? next : prev
      }
      return [...prev, category]
    })
  }

  const saveGhostSchedule = async () => {
    if (!ghostScheduleStartTime) {
      setGhostScheduleMessage('예약 시간을 선택해주세요.')
      return
    }

    if (!ghostScheduleIntervalHours || ghostScheduleIntervalHours < 1) {
      setGhostScheduleMessage('몇 시간 간격인지 입력해주세요.')
      return
    }

    setGhostScheduleSaving(true)
    setGhostScheduleMessage('')

    try {
      const res = await fetch('/api/ghost/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: ghostScheduleStartTime,
          intervalHours: ghostScheduleIntervalHours,
          provider,
          model,
          tone,
          length,
          blogType: 'general',
          ghostStatus: ghostScheduleStatus,
          categories: ghostScheduleCategories,
          repeat: true,
          useRandomKeyword: true,
        }),
      })

      const data = (await res.json()) as { error?: string; schedule?: { id?: string; runAt?: number } }
      if (!res.ok || !data.schedule) {
        throw new Error(data.error ?? '예약 저장에 실패했습니다.')
      }

      const scheduledAt = data.schedule.runAt ? new Date(data.schedule.runAt).toLocaleString('ko-KR') : '계산됨'
      setGhostScheduleMessage(`예약이 저장되었습니다. 첫 실행 시각: ${scheduledAt}`)
      showToast('Ghost 예약이 저장되었습니다.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '예약 저장 중 오류가 발생했습니다.'
      setGhostScheduleMessage(message)
      showToast(message, 'error')
    } finally {
      setGhostScheduleSaving(false)
    }
  }

  const fetchScheduleList = async () => {
    setScheduleListLoading(true)
    try {
      const res = await fetch('/api/ghost/schedule')
      const data = (await res.json()) as { schedules?: GhostScheduleItem[] }
      setScheduleList(data.schedules ?? [])
    } catch {
      showToast('예약 목록을 불러오지 못했습니다.', 'error')
    } finally {
      setScheduleListLoading(false)
    }
  }

  const deleteSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/ghost/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? '삭제 실패')
      }
      setScheduleList((prev) => prev.filter((s) => s.id !== id))
      showToast('예약이 삭제되었습니다.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '삭제 중 오류가 발생했습니다.', 'error')
    }
  }

  // Auto-fetch keywords on mount / blog type change
  useEffect(() => {
    if (blogType === 'celebrity') return
    void fetchKeywords()
  }, [fetchKeywords, blogType])

  useEffect(() => {
    if (provider === 'ollama') {
      void checkOllamaConnection(false)
    } else {
      setOllamaStatus('')
    }
  }, [provider, checkOllamaConnection])

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
      setLastGeneratedType(blogType)
      if (blogType === 'general' && generatedHtml) {
        setLastGeneralHtml(generatedHtml)
        setLastGeneralTopic(trimmed)
      }
      if (isCelebrityMode) setTopic(resolvedTopic)

      push({ topic: resolvedTopic, tone, model, html: generatedHtml, tokens: generatedTokens })
      recordUsage()

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // Client-side conversion: no API call, no token usage.
  const convertPreviousGeneralToItNews = () => {
    const sourceHtml = lastGeneralHtml || (lastGeneratedType === 'general' ? html : '')
    const sourceTopic = lastGeneralTopic || topic

    if (!sourceHtml.trim()) {
      setError('먼저 기본 블로그를 생성한 뒤 변환해주세요.')
      return
    }

    try {
      setTransforming(true)
      const converted = convertGeneralHtmlToItNews(sourceHtml, sourceTopic)
      setHtml(converted)
      setTokens(0)
      setError('')
      showToast('이전 기본 블로그 내용을 IT정보/뉴스 형식으로 변환했습니다. (토큰 사용 없음)', 'success')
    } catch {
      setError('이전 내용을 변환하지 못했습니다. 먼저 기본 블로그를 다시 생성해 주세요.')
    } finally {
      setTransforming(false)
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          {provider === 'ollama' && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
              <button
                type="button"
                onClick={() => void checkOllamaConnection(true)}
                disabled={ollamaChecking}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:border-red-600 hover:text-red-300 disabled:opacity-60"
              >
                {ollamaChecking ? '확인 중...' : 'Ollama 연결 확인'}
              </button>
              <p className="text-xs text-zinc-400">
                {ollamaStatus || '로컬 Ollama 상태를 확인할 수 있습니다.'}
              </p>
            </div>
          )}
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
            {currentModelOptions.length === 0 ? (
              <p className="text-xs text-zinc-500 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                사용 가능한 모델이 없습니다. Ollama 연결 확인 후 모델을 내려받아주세요.
              </p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {currentModelOptions.map(m => (
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
            )}
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

        {/* ── Ghost schedule ─────────────────────────────────────────── */}
        <section aria-label="Ghost 예약 발행" className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Ghost 자동 발행 예약</h2>
              <p className="text-xs text-zinc-500 mt-1">지정한 시간에 추천키워드를 랜덤 선택해서 생성 후 Ghost에 자동 발행합니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGhostScheduleStatus('draft')}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${ghostScheduleStatus === 'draft' ? 'border-red-600 bg-red-600/10 text-red-300' : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
              >
                Draft
              </button>
              <button
                type="button"
                onClick={() => setGhostScheduleStatus('published')}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${ghostScheduleStatus === 'published' ? 'border-red-600 bg-red-600/10 text-red-300' : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
              >
                Publish
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">시작 시간</span>
              <input
                type="time"
                value={ghostScheduleStartTime}
                onChange={(e) => setGhostScheduleStartTime(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/20"
              />
            </label>

            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">몇 시간 간격</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={ghostScheduleIntervalHours}
                  onChange={(e) => setGhostScheduleIntervalHours(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/20"
                />
                <span className="text-sm text-zinc-500 whitespace-nowrap">시간마다 실행</span>
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">카테고리 순환</span>
            <div className="flex flex-wrap gap-2">
              {SCHEDULE_CATEGORIES.map((category) => {
                const active = ghostScheduleCategories.includes(category)
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleScheduleCategory(category)}
                    className={`px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${active ? 'border-red-600 bg-red-600/10 text-red-300' : 'border-zinc-800 bg-zinc-900/70 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
                  >
                    {category}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveGhostSchedule()}
              disabled={ghostScheduleSaving}
              className="px-4 py-2.5 rounded-xl border border-red-700/60 bg-red-900/30 text-red-200 text-sm font-semibold hover:bg-red-900/45 disabled:opacity-60"
            >
              {ghostScheduleSaving ? '예약 저장 중...' : 'Ghost 예약 저장'}
            </button>
            <button
              type="button"
              onClick={() => { void fetchScheduleList(); setShowScheduleList(true) }}
              className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 transition-colors"
            >
              예약 목록
            </button>
            <p className="text-xs text-zinc-500">
              시작 시간에 첫 실행 후, 입력한 시간 간격마다 지정한 카테고리들 중 하나를 랜덤으로 골라 자동 생성 후 Ghost로 보냅니다.
            </p>
          </div>

          {ghostScheduleMessage && (
            <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-xs text-zinc-300">
              {ghostScheduleMessage}
            </div>
          )}
        </section>

        {/* Ghost 예약 목록 모달 */}
        {showScheduleList && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowScheduleList(false)}>
            <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <h3 className="text-sm font-bold text-zinc-100">Ghost 예약 목록</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchScheduleList()}
                    disabled={scheduleListLoading}
                    className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                  >
                    {scheduleListLoading ? '로딩 중...' : '새로고침'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowScheduleList(false)}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors"
                    aria-label="닫기"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-5 py-3">
                {scheduleListLoading && scheduleList.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-6 text-center">로딩 중...</p>
                ) : scheduleList.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-6 text-center">등록된 예약이 없습니다.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {scheduleList.map((item) => (
                      <li key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.status === 'pending' ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-800' : item.status === 'running' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                              {item.status === 'pending' ? '대기중' : item.status === 'running' ? '실행중' : item.status}
                            </span>
                            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.ghostStatus === 'published' ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                              {item.ghostStatus === 'published' ? 'Publish' : 'Draft'}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-200 font-medium truncate">
                            {item.startTime ? `${item.startTime} 시작` : ''} / {item.intervalHours}시간 간격
                          </p>
                          <p className="text-[11px] text-zinc-400 truncate">
                            카테고리: {item.categories?.join(', ') || item.category}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            다음 실행: {new Date(item.runAt).toLocaleString('ko-KR')}
                          </p>
                          <p className="text-[11px] text-zinc-600">
                            {item.provider} / {item.model}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteSchedule(item.id)}
                          className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors mt-0.5"
                          aria-label="예약 삭제"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
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
          <div className="flex justify-end gap-2">
            {blogType === 'it-news' && (
              <button
                type="button"
                onClick={convertPreviousGeneralToItNews}
                disabled={loading || transforming}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-sky-800 bg-gradient-to-r from-sky-950/80 to-blue-900/60 text-sky-200 text-sm font-semibold hover:from-sky-900/80 hover:to-blue-800/60 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              >
                {transforming ? (
                  <>
                    <span className="w-4 h-4 border-2 border-sky-200/30 border-t-sky-100 rounded-full animate-spin flex-shrink-0" />
                    변환 중...
                  </>
                ) : (
                  <>
                    <span>↺</span>
                    이전내용 변환
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void generate()}
              disabled={loading || transforming || cooldown > 0}
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
