export type ToastType = 'success' | 'error' | 'info'

export interface ToastData {
  message: string
  type: ToastType
}

interface Props {
  toast: ToastData | null
}

const icons: Record<ToastType, React.ReactNode> = {
  success: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

const styles: Record<ToastType, string> = {
  success: 'border-green-800/60 text-green-400',
  error:   'border-red-900/60  text-red-400',
  info:    'border-zinc-700    text-zinc-300',
}

export default function Toast({ toast }: Props) {
  if (!toast) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-zinc-900 shadow-2xl text-sm font-medium animate-fade-in max-w-sm ${styles[toast.type]}`}
    >
      {icons[toast.type]}
      <span>{toast.message}</span>
    </div>
  )
}
