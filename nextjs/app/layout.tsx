import type { Metadata } from 'next'
import { Noto_Sans_KR } from 'next/font/google'
import './globals.css'

const noto = Noto_Sans_KR({
  variable: '--font-noto',
  subsets: ['latin'],
  weight: ['300', '400', '500', '700', '900'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Blog Pro — Tistory HTML Generator',
  description: 'AI가 생성하는 Tistory 블로그 HTML 콘텐츠 생성기',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${noto.variable} font-sans bg-[#09090b] text-zinc-100 antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
