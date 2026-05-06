require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert Korean blog writer who creates high-quality Tistory blog posts.

Generate well-structured, engaging HTML blog content for Tistory editor.

Rules:
- Output ONLY the HTML body content (no <html>, <head>, or <body> tags)
- Write content in Korean unless the topic implies another language
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <em>, <blockquote>, <pre><code>
- Keep paragraphs readable (3–5 sentences each)
- Include: introduction, main body with 3–5 sections, conclusion
- Add a tip or insight box using <blockquote> where relevant
- Use <hr> to separate major sections
- Generate at least 800 Korean characters of real content
- Do NOT include inline styles or CSS classes
- Do NOT include markdown, only pure HTML`;

app.post('/api/generate', async (req, res) => {
  const { topic, tone = '정보 전달형', length = 'medium' } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({ error: '주제를 입력해주세요.' });
  }

  const sanitizedTopic = topic.trim().slice(0, 200);

  const lengthGuide = {
    short: '약 500자 분량',
    medium: '약 1000자 분량',
    long: '약 1800자 분량',
  }[length] || '약 1000자 분량';

  const userPrompt = `주제: "${sanitizedTopic}"
톤: ${tone}
분량: ${lengthGuide}

위 주제로 Tistory 블로그 포스트용 HTML을 작성해주세요.`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 3000,
    });

    const html = completion.choices[0]?.message?.content?.trim();

    if (!html) {
      return res.status(500).json({ error: 'AI 응답을 받지 못했습니다. 다시 시도해주세요.' });
    }

    res.json({
      html,
      usage: completion.usage,
    });
  } catch (err) {
    console.error('OpenAI API error:', err);

    if (err.status === 401) {
      return res.status(401).json({ error: 'API 키가 유효하지 않습니다. .env 파일을 확인해주세요.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' });
    }

    res.status(500).json({ error: '서버 오류가 발생했습니다. 다시 시도해주세요.' });
  }
});

app.listen(PORT, () => {
  console.log(`Blog Pro server running at http://localhost:${PORT}`);
});
