export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userToken = process.env.SLACK_USER_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const token = userToken || botToken;

  if (!token) {
    return res.status(500).json({ error: 'No Slack token configured' });
  }

  const { merchant } = req.body;
  if (!merchant) {
    return res.status(400).json({ error: 'Merchant name required' });
  }

  const EXCLUDED_EXACT = ['transactions', 'transaction-feed', 'payment-feed', 'payments'];

  try {
    // Fetch page 1 and page 2 to get beyond the transactions noise
    const results = [];

    for (let page = 1; page <= 3; page++) {
      const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=20&sort=timestamp&sort_dir=desc&page=${page}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (!data.ok) {
        if (page === 1) {
          return res.status(400).json({
            error: data.error || 'Slack search failed',
            needed: data.needed
          });
        }
        break;
      }

      const messages = data.messages?.matches || [];
      if (messages.length === 0) break;

      // Filter excluded channels
      const filtered = messages.filter(m => {
        const channelName = (m.channel?.name || '').toLowerCase();
        return !EXCLUDED_EXACT.includes(channelName);
      });

      results.push(...filtered);
      if (results.length >= 8) break;

      // If this page had results beyond transactions, we have enough
      if (filtered.length > 0) break;
    }

    if (results.length === 0) {
      return res.status(200).json({
        summary: `No relevant Slack mentions found for "${merchant}" outside of automated channels.`
      });
    }

    const formatted = results.slice(0, 8).map(m => {
      const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString('en-ZA');
      const channel = m.channel?.name ? `#${m.channel.name}` : 'DM';
      const text = (m.text || '').slice(0, 250);
      return `${date} · ${channel}: ${text}`;
    }).join('\n\n');

    return res.status(200).json({ summary: formatted, count: results.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}