use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};

// ── OpenAI request structures ─────────────────────────────────────────────────

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT: &str = "You are an expert Korean blog writer who creates \
high-quality Tistory blog posts.\n\n\
Generate well-structured, engaging HTML blog content for Tistory editor.\n\n\
Rules:\n\
- Output ONLY the HTML body content (no <html>, <head>, or <body> tags)\n\
- Write content in Korean unless the topic implies another language\n\
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <em>, <blockquote>, <pre><code>\n\
- Keep paragraphs readable (3-5 sentences each)\n\
- Include: introduction, main body with 3-5 sections, conclusion\n\
- Add a tip or insight box using <blockquote> where relevant\n\
- Use <hr> to separate major sections\n\
- Generate at least 800 Korean characters of real content\n\
- Do NOT include inline styles or CSS classes\n\
- Do NOT include markdown, only pure HTML";

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_blog_html(
    topic: String,
    tone: String,
    length: String,
    api_key: String,
    model: Option<String>,
) -> Result<Value, String> {
    // Input validation
    if topic.trim().is_empty() {
        return Err("주제를 입력해주세요.".to_string());
    }
    if api_key.trim().is_empty() {
        return Err(
            "API 키가 없습니다. 설정(⚙)에서 OpenAI API 키를 입력해주세요.".to_string(),
        );
    }

    let sanitized = topic.trim().chars().take(200).collect::<String>();

    let length_guide = match length.as_str() {
        "short" => "약 500자 분량",
        "long" => "약 1800자 분량",
        _ => "약 1000자 분량",
    };

    let user_prompt = format!(
        "주제: \"{sanitized}\"\n톤: {tone}\n분량: {length_guide}\n\n\
         위 주제로 Tistory 블로그 포스트용 HTML을 작성해주세요."
    );

    let model_name = model.unwrap_or_else(|| "gpt-4o-mini".to_string());

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];

    let body = json!({
        "model": model_name,
        "messages": messages,
        "temperature": 0.75,
        "max_tokens": 3000
    });

    // HTTP call to OpenAI
    let client = Client::new();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("네트워크 오류: {e}"))?;

    let status = response.status();

    match status {
        StatusCode::UNAUTHORIZED => {
            return Err("API 키가 유효하지 않습니다. 설정에서 올바른 키를 입력하세요.".to_string());
        }
        StatusCode::TOO_MANY_REQUESTS => {
            return Err("API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.".to_string());
        }
        s if !s.is_success() => {
            return Err(format!("OpenAI API 오류 ({s}). 다시 시도해주세요."));
        }
        _ => {}
    }

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("응답 파싱 오류: {e}"))?;

    let html = data["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "AI 응답을 받지 못했습니다. 다시 시도해주세요.".to_string())?;

    let total_tokens = data["usage"]["total_tokens"].as_u64();

    Ok(json!({
        "html": html,
        "total_tokens": total_tokens
    }))
}

// ── App entry ────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![generate_blog_html])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
