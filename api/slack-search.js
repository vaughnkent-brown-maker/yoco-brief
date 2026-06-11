export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userToken = process.env.SLACK_USER_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const token = userToken || botToken;

  if (!token) return res.status(500).json({ error: 'No Slack token configured' });

  const { merchant } = req.body;
  if (!merchant) return res.status(400).json({ error: 'Merchant name required' });

  const EXCLUDED_PATTERNS = [
    'transactions', 'transaction', 'payments', 'payment',
    'whatsapp', 'mywhatsapp', 'data-feed', 'data_feed',
    'automated', 'automation', 'alerts', 'monitoring',
    'logs', 'system', 'pagerduty', 'datadog',
    'notifications', 'notify', 'intercom', 'zendesk',
    'bot', 'webhook'
  ];

  const isExcluded = (channelName) => {
    const name = (channelName || '').toLowerCase();
    return EXCLUDED_PATTERNS.some(p => name.includes(p));
  };

  try {
    // Fetch user list to resolve user IDs to names
    const usersRes = await fetch('https://slack.com/api/users.list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
    const userMap = {};
    if (usersData.ok) {
      (usersData.members || []).forEach(u => {
        userMap[u.id] = u.profile?.display_name || u.profile?.real_name || u.name;
      });
    }

    // Fetch channel list to resolve channel IDs to names
    const chansRes = await fetch('https://slack.com/api/conversations.list?limit=200&types=public_channel,private_channel', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const chansData = await chansRes.json();
    const chanMap = {};
    if (chansData.ok) {
      (chansData.channels || []).forEach(c => { chanMap[c.id] = c.name; });
    }

    const results = [];

    for (let page = 1; page <= 5; page++) {
      const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(merchant)}&count=20&sort=timestamp&sort_dir=desc&page=${page}`;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await response.json();

      if (!data.ok) {
        if (page === 1) return res.status(400).json({ error: data.error || 'Slack search failed' });
        break;
      }

      const messages = data.messages?.matches || [];
      if (messages.length === 0) break;

      const filtered = messages.filter(m => {
        const channelName = m.channel?.name || chanMap[m.channel?.id] || '';
        return !isExcluded(channelName);
      });

      results.push(...filtered);
      if (results.length >= 15) break;
    }

    if (results.length === 0) {
      return res.status(200).json({
        summary: `No relevant Slack conversations found for "${merchant}" outside of automated channels.`
      });
    }

    // Build rich message list with resolved names
    const rawMessages = results.slice(0, 15).map(m => {
      const date = new Date(parseFloat(m.ts) * 1000).toLocaleDateString('en-ZA');
      const channelName = m.channel?.name || chanMap[m.channel?.id] || m.channel?.id || 'DM';
      const isExcludedChan = isExcluded(channelName);
      if (isExcludedChan) return null;

      // Resolve user mentions in text
      let text = (m.text || '').slice(0, 300);
      text = text.replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (match, uid, name) => '@' + (name || userMap[uid] || uid));
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');

      const author = userMap[m.user] || m.username || 'Unknown';
      return `[${date}] #${channelName} — ${author}: ${text}`;
    }).filter(Boolean);

    if (rawMessages.length === 0) {
      return res.status(200).json({ summary: `No relevant conversations found for "${merchant}".` });
    }

    // Use Gemini to summarise if available
    if (geminiKey) {
      try {
        const prompt = `You are summarising internal Slack conversations about a merchant called "${merchant}" for an Account Manager at Yoco.

Here are the raw Slack messages:
${rawMessages.join('\n')}

Write a concise summary with this structure:
CHANNELS ACTIVE: [list which channels had mentions]
MAIN TOPICS: [2-4 bullet points of what was discussed]
KEY CONTEXT: [1-2 sentences of most important context for the AM]
PEOPLE INVOLVED: [who was talking about this merchant]
LATEST UPDATE: [most recent thing mentioned]

Keep it tight and factual. Only include what is in the messages.`;

        // Try models in order
        let geminiRes = null;
        for (const model of ['gemini-3.5-flash', 'gemini-2.5-flash-preview-05-20', 'gemini-1.5-flash']) {
          geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 400, temperature: 0.2 }
            })
          });
          if (geminiRes.ok) break;
        }

        if (geminiRes && geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const summary = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (summary) {
            return res.status(200).json({ summary, count: rawMessages.length, raw: rawMessages });
          }
        }
      } catch (e) {
        // Fall through to raw messages if Gemini fails
      }
    }

    // Fallback — return structured raw messages
    return res.status(200).json({
      summary: rawMessages.join('\n\n'),
      count: rawMessages.length
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}