# Blog AI Generator

Next.js 기반 블로그 AI 생성 웹앱입니다. 기본 Groq 생성 기능은 그대로 유지하면서, 로컬 Ollama의 `gemma4:e2b` 모델로도 글을 생성할 수 있습니다.

또한 생성된 HTML을 Ghost CMS로 서버사이드 업로드할 수 있습니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 됩니다.

## 환경 변수

`.env.local` 또는 `.env`에 아래 값을 설정하세요.

```env
GROQ_API_KEY=your_groq_key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b
GHOST_URL=https://minicloud.shop
GHOST_ADMIN_API_KEY=your_admin_api_key
GHOST_API_VERSION=v5.0
```

선택적으로 Gemini, OpenRouter, Pexels, Pixabay 키를 추가할 수 있습니다.

## Ghost 연동 설정

1. Ghost 관리자에서 Custom Integration을 생성합니다.
2. Integration 상세에서 Admin API Key를 복사합니다.
3. `.env.local`에 아래 값을 입력합니다.

```env
GHOST_URL=https://minicloud.shop
GHOST_ADMIN_API_KEY=xxxxxxxxxxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
GHOST_API_VERSION=v5.0
```

주의:
- `GHOST_ADMIN_API_KEY`는 서버에서만 사용됩니다. 클라이언트로 노출되지 않습니다.
- URL은 Ghost가 실제로 설치된 도메인을 사용하세요.

## Ghost 업로드 사용법

1. 기존처럼 Groq/Ollama로 글을 생성합니다.
2. 생성 결과 영역의 Ghost 업로드 섹션에서 제목/요약/태그를 수정합니다.
3. 아래 중 하나를 선택합니다.
  - `Ghost에 Draft 저장`
  - `Ghost에 바로 발행`
4. 업로드 성공 시 공개 URL과 Ghost 에디터 URL이 표시됩니다.

## Ghost 예약 발행

예약 발행은 서버가 살아 있는 동안 예약 큐를 주기적으로 확인하는 워커가 필요합니다.

1. `.env.local`에 아래 값을 추가합니다.

```env
APP_BASE_URL=http://127.0.0.1:3000
SCHEDULE_SECRET=원하는_임의의_문자열
SCHEDULE_POLL_INTERVAL_MS=60000
```

2. 예약 화면에서 시간, Draft/Publish, 카테고리 순환을 지정한 뒤 `Ghost 예약 저장`을 누릅니다.
3. 예약 워커를 별도 터미널에서 실행합니다.

```bash
npm run scheduler
```

4. 워커는 지정된 주기마다 예약을 확인하고, 선택된 카테고리에서 추천키워드를 랜덤으로 골라 글을 생성한 뒤 Ghost에 자동 등록합니다.

주의:
- 자동 발행은 서버 프로세스 또는 워커가 계속 실행 중이어야 합니다.
- 홈서버가 꺼지면 예약도 멈춥니다.
- 외부에서 실행할 경우 `APP_BASE_URL`은 실제 접근 가능한 주소여야 합니다.

## Ollama 설치

1. Ollama를 설치합니다.
2. 터미널에서 실행 상태를 확인합니다.

```bash
ollama list
ollama serve
```

3. `gemma4:e2b` 모델을 다운로드합니다.

```bash
ollama pull gemma4:e2b
```

## Groq / Ollama 사용법

1. 글 생성 화면에서 `API 프로바이더`를 선택합니다.
2. Groq를 사용하려면 `Groq`를 선택합니다.
3. 로컬 모델을 사용하려면 `Local Ollama`를 선택합니다.
4. `Local Ollama`를 선택하면 `gemma4:e2b` 모델 연결을 자동으로 확인하고, 수동으로 `Ollama 연결 확인` 버튼도 누를 수 있습니다.
5. 생성 버튼으로 글을 작성합니다.

## 문제 해결

- Ollama가 실행 중이 아니면:
  `Ollama가 실행 중인지 확인해주세요. Ollama 앱을 실행하거나 ollama serve 명령어를 실행하세요.`
- `gemma4:e2b` 모델이 없으면:
  `gemma4:e2b 모델이 설치되어 있지 않습니다. ollama pull gemma4:e2b 명령어로 설치해주세요.`
- 응답이 느리면:
  `로컬 모델 응답이 느릴 수 있습니다. 잠시 후 다시 시도해주세요.`
- Ghost URL 미설정:
  `GHOST_URL이 설정되지 않았습니다. .env 파일을 확인해주세요.`
- Ghost API 키 미설정/형식 오류:
  `GHOST_ADMIN_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.`
  `GHOST_ADMIN_API_KEY 형식이 올바르지 않습니다. {id}:{secret} 형식인지 확인해주세요.`
- Ghost 인증 실패:
  `Ghost 인증에 실패했습니다. Admin API Key를 다시 확인해주세요.`
- Ghost 연결 실패:
  `Ghost 서버에 연결하지 못했습니다. URL 또는 서버 상태를 확인해주세요.`