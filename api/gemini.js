export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const { prompt, maxTokens } = req.body;

  const fetchWithTimeout = (url, opts, ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  // Try OpenAI first — more reliable on Vercel
  if (openaiKey) {
    try {
      const response = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: maxTokens || 1000,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }]
          })
        },
        25000
      );

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text) return res.status(200).json({ text, model: 'gpt-4o-mini', provider: 'openai' });
      }

      const errData = await response.json().catch(() => ({}));
      console.error('OpenAI error:', errData.error?.message);
    } catch (err) {
      console.error('OpenAI timeout/error:', err.message);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: maxTokens || 1000, temperature: 0.3 }
            })
          },
          25000
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) return res.status(200).json({ text, model, provider: 'gemini' });
        }
        continue;
      } catch (err) {
        continue;
      }
    }
  }

  return res.status(503).json({ error: 'All AI providers failed or timed out. Check OPENAI_API_KEY has credit.' });
}
