import { useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab    = 'source' | 'preview'
type Status = 'idle' | 'loading' | 'success' | 'error'
type Length = 'short' | 'medium' | 'long'

interface GenerateResult {
  html: string
  total_tokens?: number
}

interface Toast {
  message: string
  type: 'success' | 'error' | 'default'
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TONES = [
  '정보 전달형',
  '친근한 대화체',
  '전문적 분석형',
  '리뷰형',
  '튜토리얼형',
  '감성적 에세이',
]

const LENGTHS: { value: Length; label: string; sub: string }[] = [
  { value: 'short',  label: '짧게', sub: '~500자'  },
  { value: 'medium', label: '보통', sub: '~1000자' },
  { value: 'long',   label: '길게', sub: '~1800자' },
]

const MODELS = [
  { value: 'gpt-4o-mini',  label: 'gpt-4o-mini',  sub: '빠름 · 경제적' },
  { value: 'gpt-4o',       label: 'gpt-4o',        sub: '고품질'        },
  { value: 'gpt-4-turbo',  label: 'gpt-4-turbo',   sub: '강력'          },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [topic,        setTopic]        = useState('')
  const [tone,         setTone]         = useState(TONES[0])
  const [length,       setLength]       = useState<Length>('medium')
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem('bp_api_key')   ?? '')
  const [model,        setModel]        = useState(() => localStorage.getItem('bp_model')     ?? 'gpt-4o-mini')
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('bp_api_key'))
  const [html,         setHtml]         = useState('')
  const [tab,          setTab]          = useState<Tab>('source')
  const [status,       setStatus]       = useState<Status>('idle')
  const [tokens,       setTokens]       = useState<number | null>(null)
  const [toast,        setToast]        = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  const showToast = (message: string, type: Toast['type'] = 'default') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  const saveSettings = () => {
    localStorage.setItem('bp_api_key', apiKey)
    localStorage.setItem('bp_model', model)
    setShowSettings(false)
    showToast('설정이 저장되었습니다.', 'success')
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  const generate = async () => {
    if (!topic.trim()) {
      showToast('주제를 입력해주세요.', 'error')
      return
    }
    if (!apiKey.trim()) {
      setShowSettings(true)
      showToast('API 키를 먼저 입력해주세요.', 'error')
      return
    }

    setStatus('loading')
    try {
      const result = await invoke<GenerateResult>('generate_blog_html', {
        topic:  topic.trim(),
        tone,
        length,
        apiKey: apiKey.trim(),
        model:  model || 'gpt-4o-mini',
      })
      setHtml(result.html)
      setTokens(result.total_tokens ?? null)
      setStatus('success')
      setTab('source')
      showToast('블로그 HTML이 생성되었습니다!', 'success')
    } catch (err: unknown) {
      setStatus('error')
      showToast(typeof err === 'string' ? err : '오류가 발생했습니다.', 'error')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate()
  }

  // ── Copy / Download ───────────────────────────────────────────────────────

  const copyToClipboard = async () => {
    if (!html) { showToast('복사할 내용이 없습니다.', 'error'); return }
    try {
      await navigator.clipboard.writeText(html)
      showToast('클립보드에 복사되었습니다!', 'success')
    } catch {
      showToast('복사에 실패했습니다.', 'error')
    }
  }

  const downloadHtml = () => {
    if (!html) { showToast('다운로드할 내용이 없습니다.', 'error'); return }
    const name     = topic.trim().replace(/[^\w가-힣\s]/g, '').slice(0, 40) || 'blog-post'
    const fileName = `${name.replace(/\s+/g, '-')}.html`
    const blob     = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url      = URL.createObjectURL(blob)
    const a        = Object.assign(document.createElement('a'), { href: url, download: fileName })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`${fileName} 저장됨`, 'success')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const statusLabel: Record<Status, string> = {
    idle:    '대기 중',
    loading: '생성 중...',
    success: '완료',
    error:   '오류',
  }

  return (
    <div className="app">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-mark">✦</span>
            <span className="logo-name">Blog Pro</span>
          </div>
          <p className="logo-sub">Tistory HTML Generator</p>
        </div>

        <div className="nav-label">글 설정</div>

        <div className="form-group">
          <label className="field-label">톤</label>
          <select value={tone} onChange={e => setTone(e.target.value)}>
            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="field-label">분량</label>
          <div className="radio-group">
            {LENGTHS.map(l => (
              <label key={l.value} className={`radio-item ${length === l.value ? 'checked' : ''}`}>
                <input
                  type="radio"
                  name="length"
                  value={l.value}
                  checked={length === l.value}
                  onChange={() => setLength(l.value)}
                />
                <span className="radio-label">{l.label}</span>
                <span className="radio-sub">{l.sub}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sidebar-spacer" />

        {tokens !== null && (
          <div className="token-badge">
            <span>⚡</span>
            <span>{tokens.toLocaleString()} tokens</span>
          </div>
        )}

        <button className={`btn-settings ${!apiKey ? 'warn' : ''}`} onClick={() => setShowSettings(true)}>
          <span className="settings-icon">⚙</span>
          <span>API 설정</span>
          {!apiKey && <span className="warn-dot" />}
        </button>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="main">

        {/* Topbar */}
        <header className="topbar">
          <div>
            <h1 className="page-title">새 포스트 생성</h1>
            <p className="page-sub">주제를 입력하고 AI가 Tistory용 HTML을 작성합니다 · Ctrl+Enter로 생성</p>
          </div>
          <div className="status-pill">
            <span className={`status-dot ${status}`} />
            <span className="status-text">{statusLabel[status]}</span>
          </div>
        </header>

        {/* Topic input */}
        <section className="input-section">
          <div className="input-card">
            <span className="input-badge">주제</span>
            <textarea
              className="topic-textarea"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={"블로그 주제를 입력하세요\n예) 파이썬으로 웹 크롤링하는 방법, 미니멀 라이프 시작하기, 제주도 3박4일 여행기..."}
              rows={3}
              maxLength={200}
            />
            <div className="input-footer">
              <span className="char-count">{topic.length} / 200</span>
              <button
                className="btn-generate"
                onClick={() => void generate()}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? (
                  <>
                    <span className="btn-spinner" />
                    <span>생성 중...</span>
                  </>
                ) : (
                  <>
                    <span>생성하기</span>
                    <span className="btn-arrow">→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Output */}
        <section className="output-section">
          <div className="tab-bar">
            {(['source', 'preview'] as Tab[]).map(t => (
              <button
                key={t}
                className={`tab ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'source' ? 'HTML 소스' : '미리보기'}
              </button>
            ))}
            <div className="tab-spacer" />
            <button className="btn-action" onClick={() => void copyToClipboard()} disabled={!html} title="클립보드에 복사">
              <IconCopy />
              <span>복사</span>
            </button>
            <button className="btn-action" onClick={downloadHtml} disabled={!html} title="HTML 파일 다운로드">
              <IconDownload />
              <span>다운로드</span>
            </button>
          </div>

          <div className="panels">
            {/* Source */}
            <div className={`panel ${tab === 'source' ? 'active' : ''}`}>
              {status === 'loading' && (
                <div className="panel-state">
                  <div className="spinner" />
                  <p>AI가 블로그 콘텐츠를 작성 중입니다...</p>
                </div>
              )}
              {status !== 'loading' && !html && (
                <div className="panel-state">
                  <span className="panel-icon">✦</span>
                  <p>주제를 입력한 후 <strong>생성하기</strong>를 누르세요</p>
                </div>
              )}
              {html && <pre className="code-view">{html}</pre>}
            </div>

            {/* Preview */}
            <div className={`panel ${tab === 'preview' ? 'active' : ''}`}>
              {!html ? (
                <div className="panel-state">
                  <span className="panel-icon">✦</span>
                  <p>생성된 HTML이 여기에 미리보기로 표시됩니다</p>
                </div>
              ) : (
                /* eslint-disable-next-line react/no-danger */
                <div className="preview-body" dangerouslySetInnerHTML={{ __html: html }} />
              )}
            </div>
          </div>
        </section>

      </main>

      {/* ── Settings Modal ────────────────────────────────────────────────── */}
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>API 설정</h2>
              <button className="modal-close" onClick={() => setShowSettings(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="field-label">OpenAI API Key</label>
                <input
                  type="password"
                  className="text-input"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveSettings()}
                  placeholder="sk-..."
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <p className="field-hint">
                  API 키는 이 기기의 로컬 저장소에만 저장되며 외부 서버로 전송되지 않습니다.
                </p>
              </div>

              <div className="form-group">
                <label className="field-label">모델</label>
                <div className="model-grid">
                  {MODELS.map(m => (
                    <button
                      key={m.value}
                      className={`model-card ${model === m.value ? 'selected' : ''}`}
                      onClick={() => setModel(m.value)}
                    >
                      <span className="model-name">{m.label}</span>
                      <span className="model-sub">{m.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>취소</button>
              <button className="btn-primary" onClick={saveSettings}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

    </div>
  )
}

// ── Icon sub-components ───────────────────────────────────────────────────────

function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
