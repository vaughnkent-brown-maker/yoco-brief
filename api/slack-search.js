export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userToken = process.env.SLACK_USER_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const token = userToken || botToken;
  const tokenType = userToken ? 'user' : 'bot';

  if (!token) {
    return res.status(500).json({ error: 'No Slack token configured' });
  }

  const { merchant } = req.body;
  if (!merchant) {
    return res.status(400).json({ error: 'Merchant name required' });
  }

  // Only block purely automated/transactional channels
  // Be specific — only exact matches or very clear patterns
  const EXCLUDED_EXACT = ['transactions', 'transaction-feed', 'payment-feed'];

  try {
    const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=20&sort=timestamp&sort_dir=desc`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();

    if (!data.ok) {
      return res.status(400).json({
        error: data.error || 'Slack search failed',
        tokenType,
        needed: data.needed
      });
    }

    const messages = data.messages?.matches || [];

    if (messages.length === 0) {
      return res.status(200).json({
        summary: `No recent Slack mentions found for "${merchant}".`,
        tokenType
      });
    }

    // Only filter exact channel name matches
    const filtered = messages.filter(m => {
      const channelName = (m.channel?.name || '').toLowerCase();
      return !EXCLUDED_EXACT.includes(channelName);
    });

    if (filtered.length === 0) {
      return res.status(200).json({
        summary: `Found ${messages.length} mentions but all were in excluded channels (${messages.map(m => m.channel?.name).join(', ')}).`,
        tokenType
      });
    }

    const formatted = filtered.slice(0, 8).map(m => {
      const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString('en-ZA');
      const channel = m.channel?.name ? `#${m.channel.name}` : 'DM';
      const text = (m.text || '').slice(0, 250);
      return `${date} · ${channel}: ${text}`;
    }).join('\n\n');

    return res.status(200).json({
      summary: formatted,
      count: filtered.length,
      tokenType
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, tokenType });
  }
}