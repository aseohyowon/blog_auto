'use client'

import { type HistoryItem } from '@/lib/useHistory'

interface Props {
  show: boolean
  history: HistoryItem[]
  onClose: () => void
  onLoad: (item: HistoryItem) => void
  onRemove: (id: string) => void
  onClear: () => void
}

function formatDate(ts: number): string {
  const diffMs   = Date.now() - ts
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1)  return '방금 전'
  if (diffMins < 60) return `${diffMins}분 전`
  const diffH = Math.floor(diffMins / 60)
  if (diffH < 24)    return `${diffH}시간 전`
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

export default function HistoryDrawer({ show, history, onClose, onLoad, onRemove, onClear }: Props) {
  const handleClear = () => {
    if (window.confirm('기록을 모두 삭제할까요?')) {
      onClear()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 ${
          show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <aside
        aria-label="생성 기록"
        className={`fixed inset-y-0 right-0 z-40 flex flex-col w-[340px] max-w-[90vw] bg-[#0c0c0e] border-l border-zinc-800 shadow-2xl transition-transform duration-300 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="font-semibold text-[14px] text-zinc-100">생성 기록</span>
            {history.length > 0 && (
              <span className="text-[10px] bg-red-900/30 text-red-400 border border-red-900/40 px-2 py-0.5 rounded-full font-semibold">
                {history.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-700 px-4">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className="text-sm text-center leading-relaxed">
                아직 생성 기록이 없습니다.<br />
                포스트를 생성하면 여기에 저장됩니다.
              </p>
            </div>
          ) : (
            history.map(item => (
              <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-700 transition-colors">
                {/* Topic + delete */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-zinc-200 leading-snug line-clamp-2 flex-1">
                    {item.topic}
                  </p>
                  <button
                    onClick={() => onRemove(item.id)}
                    aria-label="이 기록 삭제"
                    className="flex-shrink-0 mt-0.5 text-zinc-700 hover:text-red-500 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Meta badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
                    {item.tone}
                  </span>
                  <span className="text-[10px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
                    {item.model}
                  </span>
                  {item.tokens != null && (
                    <span className="text-[10px] text-zinc-700 border border-zinc-800/50 rounded px-1.5 py-0.5">
                      ⚡ {item.tokens.toLocaleString()}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-700 ml-auto">{formatDate(item.createdAt)}</span>
                </div>

                {/* Load button */}
                <button
                  onClick={() => onLoad(item)}
                  className="w-full text-xs font-semibold py-2 rounded-lg bg-red-600/10 text-red-400 border border-red-900/30 hover:bg-red-600/20 hover:border-red-800/50 transition-colors"
                >
                  불러오기 →
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer — clear all */}
        {history.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
            <button
              onClick={handleClear}
              className="w-full text-xs text-zinc-700 hover:text-zinc-400 py-2 transition-colors rounded-lg hover:bg-zinc-900"
            >
              전체 삭제
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
