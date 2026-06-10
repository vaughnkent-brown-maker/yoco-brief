export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Slack bot token not configured' });
  }

  const { amName, merchant, briefUrl } = req.body;
  if (!amName || !merchant) {
    return res.status(400).json({ error: 'AM name and merchant required' });
  }

  try {
    // Step 1 — find the AM's Slack user by name
    const usersRes = await fetch('https://slack.com/api/users.list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();

    if (!usersData.ok) {
      return res.status(400).json({ error: 'Could not fetch Slack users: ' + usersData.error });
    }

    // Match AM name to Slack user
    const amFirstName = amName.split(' ')[0].toLowerCase();
    const amLastName = amName.split(' ').slice(-1)[0].toLowerCase();
    const user = usersData.members?.find(u => {
      const display = (u.profile?.display_name || '').toLowerCase();
      const real = (u.profile?.real_name || '').toLowerCase();
      return (display.includes(amFirstName) && display.includes(amLastName)) ||
             (real.includes(amFirstName) && real.includes(amLastName));
    });

    if (!user) {
      return res.status(404).json({ error: `Could not find Slack user for "${amName}"` });
    }

    // Step 2 — open DM channel
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ users: user.id })
    });
    const dmData = await dmRes.json();

    if (!dmData.ok) {
      return res.status(400).json({ error: 'Could not open DM: ' + dmData.error });
    }

    // Step 3 — send notification
    const message = {
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
            text: briefUrl
              ? `<${briefUrl}|👉 Open brief>`
              : 'Open the Yoco AM Brief Generator to view your brief.'
          }
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: '📊 Data sources: Salesforce · Intercom · Looker · Slack · Notion'
          }]
        }
      ]
    };

    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    const msgData = await msgRes.json();

    if (!msgData.ok) {
      return res.status(400).json({ error: 'Could not send message: ' + msgData.error });
    }

    return res.status(200).json({ success: true, userId: user.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
