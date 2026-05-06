'use client'

import { useState } from 'react'
import { FREE_LIMIT } from '@/lib/useUsage'

interface Props {
  show: boolean
  used: number
  onClose: () => void
  onUnlock: (code: string) => boolean
  onActivate: () => void
}

const BENEFITS_FREE = [
  { icon: '✦', label: `하루 ${FREE_LIMIT}회 생성`, muted: true },
  { icon: '✓', label: 'Llama 3.3 70B 모델', muted: true },
  { icon: '✓', label: 'HTML 다운로드', muted: true },
]

const BENEFITS_PREMIUM = [
  { icon: '∞', label: '무제한 생성' },
  { icon: '🚀', label: 'Llama 3.3 70B 우선 접근' },
  { icon: '⚡', label: '향상된 응답 속도' },
  { icon: '📦', label: '히스토리 무제한 저장' },
  { icon: '🎨', label: '고급 프롬프트 커스텀' },
]

export default function PremiumModal({ show, used, onClose, onUnlock, onActivate }: Props) {
  const [tab,       setTab]       = useState<'pay' | 'code'>('pay')
  const [code,      setCode]      = useState('')
  const [codeError, setCodeError] = useState('')

  if (!show) return null

  const handleUnlock = () => {
    const ok = onUnlock(code)
    if (ok) {
      onClose()
    } else {
      setCodeError('유효하지 않은 코드입니다. (힌트: PREMIUM2026)')
    }
  }

  const switchTab = (t: 'pay' | 'code') => {
    setTab(t)
    setCodeError('')
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative animate-slide-up w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Gradient accent bar */}
        <div className="h-[3px] w-full bg-gradient-to-r from-red-600 via-rose-500 to-orange-400" />

        <div className="p-6">

          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white text-xs font-black">
                  ✦
                </span>
                <h2 className="text-base font-bold text-zinc-100">Blog Pro Premium</h2>
              </div>
              <p className="text-xs text-zinc-500">
                오늘 {used}/{FREE_LIMIT}회 사용
                {used >= FREE_LIMIT && (
                  <span className="ml-1.5 text-red-400 font-medium">· 일일 한도 초과</span>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 transition-colors duration-150 p-1 rounded-lg hover:bg-zinc-800"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Plan comparison */}
          <div className="grid grid-cols-2 gap-3 mb-5">

            {/* Free */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Free</p>
              <ul className="flex flex-col gap-2.5">
                {BENEFITS_FREE.map(b => (
                  <li key={b.label} className="flex items-start gap-2 text-xs text-zinc-500">
                    <span className="mt-0.5 text-zinc-700 w-3 text-center flex-shrink-0">{b.icon}</span>
                    {b.label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Premium */}
            <div className="rounded-xl border border-red-900/50 bg-gradient-to-b from-red-950/40 to-zinc-900/80 p-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-red-600/5 to-transparent pointer-events-none" />
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-3">Premium ✦</p>
              <ul className="flex flex-col gap-2.5">
                {BENEFITS_PREMIUM.map(b => (
                  <li key={b.label} className="flex items-start gap-2 text-xs text-zinc-300">
                    <span className="mt-0.5 text-red-500 w-3 text-center flex-shrink-0 text-[10px]">{b.icon}</span>
                    {b.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 mb-4 gap-1">
            {(['pay', 'code'] as const).map(t => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  tab === t
                    ? 'bg-zinc-800 text-zinc-100 shadow'
                    : 'text-zinc-500 hover:text-zinc-400'
                }`}
              >
                {t === 'pay' ? '💳 결제하기' : '🔑 코드 입력'}
              </button>
            ))}
          </div>

          {/* Payment tab */}
          {tab === 'pay' && (
            <div className="flex flex-col gap-2.5 animate-fade-in">
              <button
                onClick={() => { onActivate(); onClose() }}
                className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 shadow-lg shadow-red-900/30 transition-all duration-200 active:scale-[0.98]"
              >
                ₩9,900 / 월 · 지금 시작하기
              </button>
              <p className="text-[10px] text-zinc-600 text-center leading-relaxed">
                데모 환경 · 실제 결제는 발생하지 않습니다
              </p>
            </div>
          )}

          {/* Code tab */}
          {tab === 'code' && (
            <div className="flex flex-col gap-2.5 animate-fade-in">
              <input
                type="text"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setCodeError('') }}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                placeholder="초대 코드를 입력하세요"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-red-600/60 focus:ring-1 focus:ring-red-600/20 transition-all duration-200 font-mono tracking-widest"
              />
              {codeError && (
                <p className="text-xs text-red-400 animate-fade-in">{codeError}</p>
              )}
              <button
                onClick={handleUnlock}
                disabled={!code.trim()}
                className="w-full py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none shadow-lg shadow-red-900/20 transition-all duration-200 active:scale-[0.98]"
              >
                코드 활성화
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
