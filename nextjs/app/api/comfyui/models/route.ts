import { NextResponse } from 'next/server'

export async function GET() {
  const baseUrl = (process.env.SD_COMFYUI_URL || '').replace(/\/$/, '')
  if (!baseUrl) {
    return NextResponse.json({ models: [], connected: false, message: 'SD_COMFYUI_URL 미설정' })
  }

  try {
    const [checkpointRes, unetRes] = await Promise.all([
      fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${baseUrl}/object_info/UNETLoader`, { signal: AbortSignal.timeout(5000) }),
    ])

    const checkpointData = checkpointRes.ok ? await checkpointRes.json() as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } }
    } : {}
    const unetData = unetRes.ok ? await unetRes.json() as {
      UNETLoader?: { input?: { required?: { unet_name?: [string[]] } } }
    } : {}

    const checkpointModels: string[] = checkpointData.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []
    const unetModels: string[] = unetData.UNETLoader?.input?.required?.unet_name?.[0] ?? []
    const models = [...checkpointModels, ...unetModels]

    return NextResponse.json({
      connected: true,
      models,
      count: models.length,
      message: `${models.length}개 SD 모델을 찾았습니다.`,
    })
  } catch {
    return NextResponse.json({ models: [], connected: false, message: 'ComfyUI에 연결할 수 없습니다. (http://127.0.0.1:8188)' })
  }
}
