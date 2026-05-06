export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-900 bg-black/80 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-md bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white text-sm font-black leading-none shadow-md shadow-red-900/30"
            aria-hidden="true"
          >
            B
          </span>
          <span className="font-bold text-[15px] tracking-tight text-zinc-100">Blog Pro</span>
          <span className="hidden sm:block text-xs text-zinc-700 font-normal">
            Tistory HTML Generator
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
          Multi-AI Engine
        </div>
      </div>
    </header>
  )
}
