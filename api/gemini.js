export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const { prompt, maxTokens } = req.body;

  // Try Gemini models first
  if (geminiKey) {
    const geminiModels = [
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b'
    ];

    for (const model of geminiModels) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: maxTokens || 1200, temperature: 0.3 }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return res.status(200).json({ text, model, provider: 'gemini' });
        }

        let errorMsg = 'Unknown error';
        try {
          const errData = await response.json();
          errorMsg = errData.error?.message || errorMsg;
        } catch(e) {
          errorMsg = await response.text().catch(() => 'Unknown error');
        }

        const shouldRetry = (
          response.status === 503 ||
          response.status === 429 ||
          response.status === 404 ||
          errorMsg.includes('overload') ||
          errorMsg.includes('high demand') ||
          errorMsg.includes('no longer available') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('RESOURCE_EXHAUSTED')
        );

        if (shouldRetry) continue;

        // Auth error — fail immediately
        return res.status(response.status).json({ error: errorMsg });

      } catch (err) {
        continue;
      }
    }
  }

  // All Gemini models failed — try OpenAI GPT-4o mini
  if (openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: maxTokens || 1200,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return res.status(200).json({
          text,
          model: 'gpt-4o-mini',
          provider: 'openai',
          fallback: true,
          fallbackMessage: 'Google Gemini is currently unavailable — brief generated using GPT-4o mini instead.'
        });
      }

      const errData = await response.json().catch(() => ({}));
      return res.status(500).json({ error: 'OpenAI fallback also failed: ' + (errData.error?.message || 'Unknown error') });

    } catch (err) {
      return res.status(500).json({ error: 'All AI providers failed: ' + err.message });
    }
  }

  // No keys configured
  if (!geminiKey && !openaiKey) {
    return res.status(500).json({ error: 'No AI API keys configured — add GEMINI_API_KEY or OPENAI_API_KEY to Vercel env vars' });
  }

  return res.status(503).json({
    error: 'All Gemini models temporarily unavailable and no OpenAI fallback configured. Add OPENAI_API_KEY to Vercel env vars.'
  });
}
