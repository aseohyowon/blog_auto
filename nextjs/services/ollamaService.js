const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e2b'
const GENERATE_TIMEOUT_MS = 600000
const TAGS_TIMEOUT_MS = 10000

const OLLAMA_NOT_RUNNING_MESSAGE = 'Ollama가 실행 중인지 확인해주세요. Ollama 앱을 실행하거나 ollama serve 명령어를 실행하세요.'
const OLLAMA_MODEL_MISSING_MESSAGE = '선택한 Ollama 모델이 설치되어 있지 않습니다. ollama pull <모델명> 으로 설치해주세요.'
const OLLAMA_SLOW_MESSAGE = '로컬 모델 응답이 느릴 수 있습니다. 잠시 후 다시 시도해주세요.'

async function parseOllamaStream(response) {
  const text = await response.text()
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let html = ''
  let totalTokens = 0

  for (const line of lines) {
    try {
      const chunk = JSON.parse(line)
      if (typeof chunk?.response === 'string') {
        html += chunk.response
      }
      if (typeof chunk?.eval_count === 'number') {
        totalTokens = chunk.eval_count
      }
    } catch {
      // Ignore malformed chunk and continue with remaining chunks.
    }
  }

  return {
    html: html.trim(),
    totalTokens,
  }
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function buildUrl(pathname) {
  return `${normalizeBaseUrl(DEFAULT_BASE_URL)}${pathname}`
}

function createError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function isConnectionFailure(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('networkerror') ||
    message.includes('connection refused')
  )
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[Ollama] fetchWithTimeout error:', errMsg, '| aborted:', controller.signal.aborted)
    if (controller.signal.aborted) {
      throw createError(OLLAMA_SLOW_MESSAGE, 504)
    }
    if (isConnectionFailure(error)) {
      throw createError(OLLAMA_NOT_RUNNING_MESSAGE, 503)
    }
    throw createError(`Ollama 오류: ${errMsg}`, 500)
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function listOllamaModels() {
  try {
    const response = await fetchWithTimeout(buildUrl('/api/tags'), { method: 'GET' }, TAGS_TIMEOUT_MS)
    if (!response.ok) {
      throw createError(OLLAMA_NOT_RUNNING_MESSAGE, 503)
    }

    const data = await response.json()
    const models = Array.isArray(data?.models)
      ? data.models.map((model) => ({
          name: typeof model?.name === 'string' ? model.name : '',
          model: typeof model?.model === 'string' ? model.model : '',
          size: typeof model?.size === 'number' ? model.size : null,
        })).filter((model) => model.name || model.model)
      : []

    return {
      baseUrl: normalizeBaseUrl(DEFAULT_BASE_URL),
      requiredModel: DEFAULT_MODEL,
      models,
      hasRequiredModel: models.some((model) => model.name === DEFAULT_MODEL || model.model === DEFAULT_MODEL),
    }
  } catch (error) {
    if (error instanceof Error && typeof error.status === 'number') {
      throw error
    }
    if (isConnectionFailure(error)) {
      throw createError(OLLAMA_NOT_RUNNING_MESSAGE, 503)
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Ollama] listOllamaModels error:', msg)
    throw createError(OLLAMA_NOT_RUNNING_MESSAGE, 503)
  }
}

export async function ensureOllamaModel() {
  const status = await listOllamaModels()
  if (!status.hasRequiredModel) {
    throw createError(OLLAMA_MODEL_MISSING_MESSAGE, 404)
  }
  return status
}

export async function ensureSelectedOllamaModel(modelName) {
  const status = await listOllamaModels()
  const targetModel = (typeof modelName === 'string' && modelName.trim()) ? modelName.trim() : DEFAULT_MODEL
  const exists = status.models.some((item) => item.name === targetModel || item.model === targetModel)
  if (!exists) {
    throw createError(`선택한 Ollama 모델(${targetModel})이 설치되어 있지 않습니다. ollama pull ${targetModel} 명령어로 설치해주세요.`, 404)
  }
  return status
}

export async function generateWithOllama({ systemPrompt, userPrompt, model }) {
  const selectedModel = model || DEFAULT_MODEL

  await ensureSelectedOllamaModel(selectedModel)

  const prompt = `${systemPrompt}\n\n${userPrompt}`
  const response = await fetchWithTimeout(
    buildUrl('/api/generate'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        prompt,
        stream: true,
        options: {
          temperature: 0.75,
          num_predict: 8192,
        },
      }),
    },
    GENERATE_TIMEOUT_MS,
  )

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message = typeof errorBody?.error === 'string'
      ? errorBody.error
      : typeof errorBody?.message === 'string'
        ? errorBody.message
        : OLLAMA_SLOW_MESSAGE
    throw createError(message, response.status)
  }

  return parseOllamaStream(response)
}

export {
  OLLAMA_NOT_RUNNING_MESSAGE,
  OLLAMA_MODEL_MISSING_MESSAGE,
  OLLAMA_SLOW_MESSAGE,
  DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL,
}