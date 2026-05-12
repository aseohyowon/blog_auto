'use client'

import dynamic from 'next/dynamic'

const Generator = dynamic(() => import('./Generator'), {
  ssr: false,
})

export default function GeneratorNoSSR() {
  return <Generator />
}
