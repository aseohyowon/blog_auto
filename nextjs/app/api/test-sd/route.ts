import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const topic = searchParams.get('topic') || '인공지능 기술 트렌드'

  const baseUrl = (process.env.SD_COMFYUI_URL || '').replace(/\/$/, '')
  if (!baseUrl) {
    return NextResponse.json({ error: 'SD_COMFYUI_URL 환경변수가 설정되지 않았습니다.' }, { status: 400 })
  }

  const model = process.env.SD_MODEL_CHECKPOINT || 'DreamShaper8_LCM.safetensors'
  const steps = Number(process.env.SD_STEPS || 10)
  const timeout = Number(process.env.SD_TIMEOUT_MS || 300_000)

  const workflow = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: `${topic}, high quality photo, editorial style, sharp focus, 8k`, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'nsfw, blurry, watermark, text, logo, deformed', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e9), steps, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'blog-test', images: ['8', 0] } },
  }

  // 1) 큐 추가
  const queueRes = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!queueRes.ok) {
    return NextResponse.json({ error: `ComfyUI 큐 실패: ${queueRes.status}` }, { status: 500 })
  }
  const { prompt_id } = await queueRes.json() as { prompt_id: string }

  // 2) 완료 폴링
  const deadline = Date.now() + timeout
  type HistoryOutput = { images?: Array<{ filename: string; subfolder: string; type: string }> }
  type HistoryEntry = { outputs?: Record<string, HistoryOutput> }
  let outputs: Record<string, HistoryOutput> | undefined

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const histRes = await fetch(`${baseUrl}/history/${prompt_id}`, { signal: AbortSignal.timeout(10_000) })
    if (!histRes.ok) continue
    const history = await histRes.json() as Record<string, HistoryEntry>
    if (history[prompt_id]?.outputs) {
      outputs = history[prompt_id].outputs
      break
    }
  }

  if (!outputs) {
    return NextResponse.json({ error: '타임아웃: 이미지 생성이 너무 오래 걸립니다.' }, { status: 504 })
  }

  // 3) 이미지 URL 반환 (브라우저에서 바로 보기)
  const nodeOut = Object.values(outputs).find((o) => (o.images?.length ?? 0) > 0)
  const img = nodeOut?.images?.[0]
  if (!img) {
    return NextResponse.json({ error: '이미지 출력을 찾을 수 없습니다.' }, { status: 500 })
  }

  const imageUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`

  // HTML로 바로 이미지 표시
  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>SD 테스트</title>
<style>body{background:#111;color:#eee;font-family:sans-serif;padding:2rem;text-align:center}</style>
</head>
<body>
  <h2>✅ Stable Diffusion (ComfyUI) 테스트 성공</h2>
  <p>주제: <strong>${topic}</strong> | 모델: ${model} | Steps: ${steps}</p>
  <img src="${imageUrl}" style="max-width:100%;border-radius:8px;margin-top:1rem" />
  <p style="margin-top:1rem;font-size:0.85rem;color:#888">prompt_id: ${prompt_id}</p>
</body>
</html>`

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
