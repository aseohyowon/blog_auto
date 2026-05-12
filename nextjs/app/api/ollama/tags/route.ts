import { NextResponse } from 'next/server'
import { listOllamaModels, OLLAMA_NOT_RUNNING_MESSAGE } from '@/services/ollamaService'

export async function GET() {
  try {
    const status = await listOllamaModels()
    const modelCount = status.models.length
    return NextResponse.json({
      ...status,
      message: modelCount > 0
        ? `로컬 Ollama 모델 ${modelCount}개를 확인했습니다.`
        : '설치된 로컬 Ollama 모델이 없습니다. ollama pull <모델명> 으로 설치해주세요.',
    })
  } catch (error) {
    const status = error instanceof Error && typeof (error as Error & { status?: number }).status === 'number'
      ? (error as Error & { status?: number }).status ?? 503
      : 503
    const message = error instanceof Error ? error.message : OLLAMA_NOT_RUNNING_MESSAGE
    return NextResponse.json({ error: message }, { status })
  }
}