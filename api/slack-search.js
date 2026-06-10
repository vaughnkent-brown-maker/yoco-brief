export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use user token for search — invisible to workspace, no bot invite needed
  const token = process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Slack token not configured' });
  }

  const { merchant } = req.body;
  if (!merchant) {
    return res.status(400).json({ error: 'Merchant name required' });
  }

  try {
    // search.messages works with user tokens (xoxp-)
    const response = await fetch(
      `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=10&sort=timestamp&sort_dir=desc`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!data.ok) {
      // Fallback error info
      return res.status(400).json({ 
        error: data.error === 'not_allowed_token_type' 
          ? 'User token required for search — add SLACK_USER_TOKEN to Vercel env vars'
          : data.error || 'Slack search failed'
      });
    }

    const messages = data.messages?.matches || [];

    if (messages.length === 0) {
      return res.status(200).json({ 
        summary: `No recent Slack mentions found for "${merchant}".` 
      });
    }

    const formatted = messages.slice(0, 8).map(m => {
      const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString('en-ZA');
      const channel = m.channel?.name ? `#${m.channel.name}` : 'unknown channel';
      const text = (m.text || '').slice(0, 250);
      return `${date} · ${channel}: ${text}`;
    }).join('\n\n');

    return res.status(200).json({ summary: formatted, count: messages.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
