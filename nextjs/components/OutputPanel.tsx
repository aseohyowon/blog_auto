'use client'

import { useState } from 'react'
import type { ToastType } from './Toast'

interface Props {
  html: string
  loading: boolean
  tokens?: number | null
  topic?: string
  showToast: (message: string, type: ToastType) => void
}

type Tab = 'source' | 'preview'

export default function OutputPanel({ html, loading, tokens, topic, showToast }: Props) {
  const [tab,    setTab]    = useState<Tab>('source')
  const [copied, setCopied] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)

  const copy = async () => {
    if (!html) return
    try {
      await navigator.clipboard.writeText(html)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = html
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    showToast('HTML이 클립보드에 복사되었습니다!', 'success')
  }

  const download = () => {
    if (!html) return
    const name = (topic ?? 'blog-post')
      .trim()
      .replace(/[<>:"/\\|?*]/g, '')
      .slice(0, 60) || 'blog-post'
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${name}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`"${name}.html" 다운로드 시작`, 'success')
  }

  const fetchTags = async () => {
    if (!html && !topic) return
    setTagsLoading(true)
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, html }),
      })
      const data = (await res.json()) as { tags?: string[] }
      const nextTags = data.tags ?? []
      setTags(nextTags)
      showToast(nextTags.length > 0 ? '추천 태그를 불러왔습니다.' : '추천할 태그가 없습니다.', nextTags.length > 0 ? 'success' : 'info')
    } catch {
      showToast('태그 추천 중 오류가 발생했습니다.', 'error')
    } finally {
      setTagsLoading(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 bg-zinc-900/60 rounded-2xl border border-zinc-800 p-16 min-h-[320px]">
        {/* Multi-ring spinner */}
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-zinc-800" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 animate-spin" style={{ animationDuration: '0.9s' }} />
          <div className="absolute inset-[5px] rounded-full border-2 border-transparent border-t-rose-400/60 animate-spin" style={{ animationDuration: '1.4s', animationDirection: 'reverse' }} />
          <div className="absolute inset-[10px] rounded-full border border-red-600/20 animate-pulse" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-zinc-400 text-sm font-medium">AI가 블로그 콘텐츠를 작성 중입니다</p>
          <p className="text-zinc-600 text-xs">잠시만 기다려주세요 (10–30초)</p>
        </div>
        {/* Shimmer skeleton bars */}
        <div className="w-full max-w-xs flex flex-col gap-2 pt-1">
          <div className="h-2.5 animate-shimmer" />
          <div className="h-2.5 animate-shimmer w-4/5" style={{ animationDelay: '0.15s' }} />
          <div className="h-2.5 animate-shimmer w-3/5" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    )
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!html) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-800 p-16 min-h-[320px]">
        <span className="text-4xl" aria-hidden="true">✦</span>
        <p className="text-zinc-600 text-sm text-center max-w-xs leading-relaxed">
          주제를 입력한 후{' '}
          <strong className="text-zinc-400 font-semibold">생성하기</strong>를 누르면
          Tistory용 HTML이 여기에 표시됩니다
        </p>
      </div>
    )
  }

  // ── Output ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in flex flex-col rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-950">

      {/* Tab bar */}
      <div className="flex items-center px-4 border-b border-zinc-800 bg-black/50 gap-1">
        {(['source', 'preview'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-red-500 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'source' ? 'HTML 소스' : '미리보기'}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {tokens != null && (
            <span className="text-xs text-zinc-700 hidden sm:block">
              ⚡ {tokens.toLocaleString()} tokens
            </span>
          )}

          {/* Copy button */}
          <button
            onClick={() => void copy()}
            title="클립보드에 복사"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95 ${
              copied
                ? 'bg-gradient-to-r from-green-700 to-emerald-600 text-white shadow-sm shadow-green-900/30 border-transparent'
                : 'bg-gradient-to-r from-zinc-800 to-zinc-700 text-zinc-300 hover:from-zinc-700 hover:to-zinc-600 border border-zinc-700'
            }`}
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                복사됨
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                복사하기
              </>
            )}
          </button>

          <button
            onClick={() => void fetchTags()}
            title="추천 태그 불러오기"
            disabled={tagsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-red-900/80 to-rose-800/80 text-red-100 hover:from-red-800 hover:to-rose-700 border border-red-900/60 transition-all duration-200 active:scale-95 disabled:opacity-60"
          >
            {tagsLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-red-200/30 border-t-red-100 rounded-full animate-spin flex-shrink-0" />
                태그 추천 중
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20.59 13.41 11 23l-9-9V3h11l9.59 9.59a2 2 0 0 1 0 2.82Z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                태그 추천
              </>
            )}
          </button>

          {/* Download button */}
          <button
            onClick={download}
            title="HTML 파일 다운로드"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-zinc-800 to-zinc-700 text-zinc-300 hover:from-zinc-700 hover:to-zinc-600 border border-zinc-700 transition-all duration-200 active:scale-95"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            다운로드
          </button>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950/80">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(tag)
                  showToast(`태그 복사: ${tag}`, 'success')
                } catch {
                  showToast('태그 복사 중 오류가 발생했습니다.', 'error')
                }
              }}
              className="px-3 py-1.5 rounded-full border border-red-900/50 bg-red-950/30 text-[11px] font-medium text-red-300 hover:bg-red-950/50 transition-colors"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Source panel */}
      {tab === 'source' && (
        <pre className="overflow-auto p-5 text-[12.5px] font-mono text-zinc-300 leading-relaxed max-h-[640px] whitespace-pre-wrap break-words bg-[#0a0a0c]">
          {html}
        </pre>
      )}

      {/* Preview panel — isolated in iframe so ts- styles don't leak */}
      {tab === 'preview' && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          title="블로그 미리보기"
          className="w-full min-h-[960px] border-0 bg-[#111]"
        />
      )}
    </div>
  )
}
