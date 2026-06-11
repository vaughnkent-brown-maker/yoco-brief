export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured on server' });
  }

  const { prompt, maxTokens } = req.body;

  const models = [
    'gemini-3.5-flash',
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
        return res.status(200).json({ text, model });
      }

      // Try to parse error
      let errorMsg = 'Unknown error';
      try {
        const errData = await response.json();
        errorMsg = errData.error?.message || errorMsg;
      } catch(e) {
        errorMsg = await response.text().catch(() => 'Unknown error');
      }

      // Retry on overload/unavailable errors
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

      if (shouldRetry) {
        lastError = `${model}: ${errorMsg}`;
        continue;
      }

      // Auth or bad request — fail immediately
      return res.status(response.status).json({ error: errorMsg });

    } catch (err) {
      lastError = `${model}: ${err.message}`;
      continue;
    }
  }

  // All models failed
  return res.status(503).json({
    error: `All Gemini models temporarily unavailable. Please try again in a few minutes.`
  });
}
