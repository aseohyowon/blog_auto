'use client'

import { useState, useEffect } from 'react'

export const FREE_LIMIT = 3
const STORAGE_KEY = 'bp_usage'
const DEMO_CODE = 'PREMIUM2026'

interface StoredUsage {
  date: string      // YYYY-MM-DD
  count: number
  isPremium: boolean
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadStored(): StoredUsage {
  if (typeof window === 'undefined') return { date: getToday(), count: 0, isPremium: false }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { date: getToday(), count: 0, isPremium: false }
    return JSON.parse(raw) as StoredUsage
  } catch {
    return { date: getToday(), count: 0, isPremium: false }
  }
}

function persist(data: StoredUsage) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function useUsage() {
  const [stored, setStored] = useState<StoredUsage>({ date: getToday(), count: 0, isPremium: false })

  // Hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    setStored(loadStored())
  }, [])

  const today      = getToday()
  const freshCount = stored.date === today ? stored.count : 0
  const used       = freshCount
  const remaining  = stored.isPremium ? Infinity : Math.max(0, FREE_LIMIT - freshCount)
  const canGenerate = stored.isPremium || remaining > 0

  /** Call after a successful generation (does nothing for premium users). */
  const recordUsage = () => {
    if (stored.isPremium) return
    const next: StoredUsage = {
      date:      today,
      count:     (stored.date === today ? stored.count : 0) + 1,
      isPremium: stored.isPremium,
    }
    setStored(next)
    persist(next)
  }

  /** Returns true when the given code is valid and premium is activated. */
  const unlockPremium = (code: string): boolean => {
    if (code.trim().toUpperCase() !== DEMO_CODE) return false
    const next: StoredUsage = { ...stored, isPremium: true }
    setStored(next)
    persist(next)
    return true
  }

  /** Activates premium without a code (demo / simulated payment). */
  const activateDemoPremium = () => {
    const next: StoredUsage = { ...stored, isPremium: true }
    setStored(next)
    persist(next)
  }

  return { used, remaining, isPremium: stored.isPremium, canGenerate, recordUsage, unlockPremium, activateDemoPremium }
}
