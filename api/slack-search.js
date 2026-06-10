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

  // Automated/noise channels to exclude
  const EXCLUDED_PATTERNS = [
    'transactions', 'transaction',
    'payments', 'payment',
    'whatsapp', 'mywhatsapp',
    'data-feed', 'data_feed',
    'automated', 'automation',
    'alerts', 'monitoring',
    'logs', 'system',
    'pagerduty', 'datadog',
    'notifications', 'notify',
    'intercom', 'zendesk',
    'bot', 'webhook'
  ];

  const isExcluded = (channelName) => {
    const name = (channelName || '').toLowerCase();
    return EXCLUDED_PATTERNS.some(p => name.includes(p));
  };

  try {
    const results = [];

    for (let page = 1; page <= 5; page++) {
      const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=20&sort=timestamp&sort_dir=desc&page=${page}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (!data.ok) {
        if (page === 1) {
          return res.status(400).json({ error: data.error || 'Slack search failed', needed: data.needed });
        }
        break;
      }

      const messages = data.messages?.matches || [];
      if (messages.length === 0) break;

      const filtered = messages.filter(m => !isExcluded(m.channel?.name));
      results.push(...filtered);

      if (results.length >= 8) break;
    }

    if (results.length === 0) {
      return res.status(200).json({
        summary: `No relevant Slack conversations found for "${merchant}" — mentions exist but are in automated/system channels only.`
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