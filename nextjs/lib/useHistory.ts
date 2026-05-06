'use client'

import { useState, useEffect, useCallback } from 'react'

export interface HistoryItem {
  id: string
  topic: string
  tone: string
  model: string
  html: string
  tokens: number | null
  createdAt: number
}

const STORAGE_KEY = 'bp_history'
const MAX_ITEMS = 20

function readStorage(): HistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch {
    return []
  }
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    setHistory(readStorage())
  }, [])

  const push = useCallback((item: Omit<HistoryItem, 'id' | 'createdAt'>) => {
    const next: HistoryItem = {
      ...item,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    }
    setHistory(prev => {
      // Deduplicate by topic (keep latest), then cap at MAX_ITEMS
      const deduped = prev.filter(h => h.topic !== item.topic)
      const updated = [next, ...deduped].slice(0, MAX_ITEMS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  const remove = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.filter(h => h.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  const clear = useCallback(() => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { history, push, remove, clear }
}
