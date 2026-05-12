import { NextResponse } from 'next/server'
import { listOllamaModels, OLLAMA_NOT_RUNNING_MESSAGE } from '@/services/ollamaService'

export async function GET() {
  try {
    const status = await listOllamaModels()
    return NextResponse.json({
      ...status,
      message: status.hasRequiredModel
        ? `${status.requiredModel} 모델을 확인했습니다.`
        : 'gemma4:e2b 모델이 설치되어 있지 않습니다. ollama pull gemma4:e2b 명령어로 설치해주세요.',
    })
  } catch (error) {
    const status = error instanceof Error && typeof (error as Error & { status?: number }).status === 'number'
      ? (error as Error & { status?: number }).status ?? 503
      : 503
    const message = error instanceof Error ? error.message : OLLAMA_NOT_RUNNING_MESSAGE
    return NextResponse.json({ error: message }, { status })
  }
}