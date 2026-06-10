export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userToken = process.env.SLACK_USER_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const token = userToken || botToken;

  // Debug — tells us which token is being used
  const tokenType = userToken ? 'user (xoxp)' : botToken ? 'bot (xoxb)' : 'none';

  if (!token) {
    return res.status(500).json({ error: 'No Slack token configured', tokenType });
  }

  const { merchant } = req.body;
  if (!merchant) {
    return res.status(400).json({ error: 'Merchant name required' });
  }

  const EXCLUDED_CHANNELS = [
    'transactions', 'transaction', 'payments', 'payment-notifications',
    'alerts', 'monitoring', 'logs', 'data-feeds', 'automated',
    'notifications', 'ops-alerts', 'system-alerts', 'pagerduty', 'datadog'
  ];

  try {
    const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=20&sort=timestamp&sort_dir=desc`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    // Return full debug info if not ok
    if (!data.ok) {
      return res.status(400).json({
        error: data.error || 'Slack search failed',
        tokenType,
        slackError: data.error,
        needed: data.needed,
        provided: data.provided
      });
    }

    const messages = data.messages?.matches || [];
    const totalFound = messages.length;

    if (totalFound === 0) {
      return res.status(200).json({
        summary: `No recent Slack mentions found for "${merchant}".`,
        debug: { tokenType, totalFound: 0 }
      });
    }

    // Filter excluded channels
    const filtered = messages.filter(m => {
      const channelName = (m.channel?.name || '').toLowerCase();
      return !EXCLUDED_CHANNELS.some(ex => channelName.includes(ex));
    });

    const excludedCount = totalFound - filtered.length;

    if (filtered.length === 0) {
      return res.status(200).json({
        summary: `Mentions of "${merchant}" found only in automated/transactional channels — excluded from brief.`,
        debug: { tokenType, totalFound, excludedCount, excludedChannels: messages.map(m => m.channel?.name) }
      });
    }

    const formatted = filtered.slice(0, 8).map(m => {
      const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString('en-ZA');
      const channel = m.channel?.name ? `#${m.channel.name}` : 'unknown channel';
      const text = (m.text || '').slice(0, 250);
      return `${date} · ${channel}: ${text}`;
    }).join('\n\n');

    return res.status(200).json({
      summary: formatted,
      count: filtered.length,
      debug: { tokenType, totalFound, excludedCount }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, tokenType });
  }
}