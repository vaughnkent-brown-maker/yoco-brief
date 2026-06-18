module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const { prompt, maxTokens } = req.body;

  const fetchWithTimeout = (url, opts, ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  // Primary: Claude (Anthropic)
  if (anthropicKey) {
    try {
      const response = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: maxTokens || 1200,
            messages: [{ role: 'user', content: prompt }]
          })
        },
        25000
      );

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        if (text) return res.status(200).json({ text, model: 'claude-sonnet-4-5', provider: 'anthropic' });
      }

      const errData = await response.json().catch(() => ({}));
      console.error('Anthropic error:', errData.error?.message);
    } catch (err) {
      console.error('Anthropic timeout/error:', err.message);
    }
  }

  // Fallback: OpenAI GPT-4o mini
  if (openaiKey) {
    try {
      const response = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: maxTokens || 1200,
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

  return res.status(503).json({ error: 'All AI providers failed. Check ANTHROPIC_API_KEY and OPENAI_API_KEY.' });
}
