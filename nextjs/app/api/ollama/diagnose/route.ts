import { NextResponse } from 'next/server'
import {
  listOllamaModels,
  OLLAMA_NOT_RUNNING_MESSAGE,
  OLLAMA_DEFAULT_MODEL,
} from '@/services/ollamaService'

const GENERATE_TIMEOUT_MS = 30000

// Allow raw fetch to Ollama API for diagnostics
async function rawFetchOllama(path: string, options?: RequestInit, timeoutMs?: number) {
  const baseUrlRaw = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  const baseUrl = baseUrlRaw.replace(/\/$/, '')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? 10000)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    defaultBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434 (default)',
    defaultModel: OLLAMA_DEFAULT_MODEL,
  }

  // Step 1: Check Ollama /api/tags
  try {
    const tagsResp = await rawFetchOllama('/api/tags', { method: 'GET' }, 5000)
    results.tagsStatus = tagsResp.status
    if (tagsResp.ok) {
      const tagsData = await tagsResp.json()
      const models = Array.isArray(tagsData?.models) ? tagsData.models : []
      results.availableModels = models.map((m: { name?: string; model?: string; size?: number }) => ({
        name: m.name ?? m.model ?? 'unknown',
        size: m.size ?? null,
      }))
      results.hasDefaultModel = models.some(
        (m: { name?: string; model?: string }) =>
          m.name === OLLAMA_DEFAULT_MODEL || m.model === OLLAMA_DEFAULT_MODEL,
      )
    } else {
      const errorText = await tagsResp.text().catch(() => '(no body)')
      results.tagsError = errorText
    }
  } catch (err) {
    results.tagsError = err instanceof Error ? err.message : String(err)
  }

  // Step 2: Try a minimal generation with default model
  if (!results.tagsError) {
    try {
      const genResp = await rawFetchOllama(
        '/api/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_DEFAULT_MODEL,
            prompt: 'Say "hello" in one word.',
            stream: false,
            options: { num_predict: 10 },
          }),
        },
        GENERATE_TIMEOUT_MS,
      )
      results.generateStatus = genResp.status
      if (genResp.ok) {
        const genData = await genResp.json()
        results.generateResponse = genData.response?.trim() ?? '(empty)'
        results.generateEvalCount = genData.eval_count ?? null
      } else {
        const errorText = await genResp.text().catch(() => '(no body)')
        results.generateError = errorText
      }
    } catch (err) {
      results.generateError = err instanceof Error ? err.message : String(err)
      // Detect connection failure pattern
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound')) {
        results.generateError = `연결 실패: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  return NextResponse.json(results)
}
