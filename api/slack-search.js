export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'Slack bot token not configured' });

  const { amName, merchant, briefUrl } = req.body;
  if (!amName || !merchant) return res.status(400).json({ error: 'AM name and merchant required' });

  // Hardcoded Slack user IDs for each AM — avoids expensive users.list lookup
  // Get your ID from Slack: click your profile -> ... -> Copy member ID
  const AM_IDS = {
    'vaughn kent-brown': process.env.SLACK_USER_ID_VAUGHN || '',
    'bianca muratu': process.env.SLACK_USER_ID_BIANCA || '',
    'diaan wiese': process.env.SLACK_USER_ID_DIAAN || '',
    'melissa barnes': process.env.SLACK_USER_ID_MELISSA || '',
    'lebohang mdakane': process.env.SLACK_USER_ID_LEBO || '',
    'nomahlubi madikgetla': process.env.SLACK_USER_ID_NOMAHLUBI || '',
    'katlego ramasodi': process.env.SLACK_USER_ID_KATLEGO || ''
  };

  const userId = AM_IDS[amName.toLowerCase()];

  if (!userId) {
    return res.status(404).json({
      error: `No Slack ID configured for "${amName}"`,
      hint: 'Add SLACK_USER_ID_VAUGHN etc to Vercel environment variables. Get IDs from Slack profile -> ... -> Copy member ID'
    });
  }

  try {
    // Open DM directly with user ID
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: userId })
    });
    const dmData = await dmRes.json();
    if (!dmData.ok) return res.status(400).json({ error: 'Could not open DM: ' + dmData.error });

    // Send notification
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: dmData.channel.id,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🤖 *Your AM Brief is ready!*\n\n*Merchant:* ${merchant}\n*Generated:* ${new Date().toLocaleString('en-ZA')}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: briefUrl ? `<${briefUrl}|👉 Open brief>` : 'Open the Yoco AM Brief Generator to view your brief.'
            }
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '📊 Salesforce · Intercom · Looker · Slack · Notion' }]
          }
        ]
      })
    });

    const msgData = await msgRes.json();
    if (!msgData.ok) return res.status(400).json({ error: 'Could not send message: ' + msgData.error });

    return res.status(200).json({ success: true, userId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
