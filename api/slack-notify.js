export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'Slack bot token not configured' });
 
  const { amName, merchant, briefUrl } = req.body;
  if (!amName || !merchant) return res.status(400).json({ error: 'AM name and merchant required' });
 
  // Map of AM names to their Slack email or known display names
  // Add more as needed
  const AM_SLACK_MAP = {
    'vaughn kent-brown': 'vaughn',
    'bianca muratu': 'bianca',
    'diaan wiese': 'diaan',
    'melissa barnes': 'melissa',
    'lebohang mdakane': 'lebo',
    'nomahlubi madikgetla': 'nomahlubi',
    'katlego ramasodi': 'katlego'
  };
 
  try {
    const usersRes = await fetch('https://slack.com/api/users.list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const usersData = await usersRes.json();
 
    if (!usersData.ok) {
      return res.status(400).json({ error: 'Could not fetch Slack users: ' + usersData.error });
    }
 
    const amLower = amName.toLowerCase();
    const amParts = amLower.split(' ');
    const amFirstName = amParts[0];
    const amLastName = amParts[amParts.length - 1];
    const knownAlias = AM_SLACK_MAP[amLower] || amFirstName;
 
    // Try multiple matching strategies
    const user = usersData.members?.find(u => {
      if (u.deleted || u.is_bot) return false;
      const display = (u.profile?.display_name || '').toLowerCase();
      const real = (u.profile?.real_name || '').toLowerCase();
      const email = (u.profile?.email || '').toLowerCase();
      const name = (u.name || '').toLowerCase();
 
      return (
        // Full name match
        real.includes(amFirstName) && real.includes(amLastName) ||
        display.includes(amFirstName) && display.includes(amLastName) ||
        // First name only match
        display === amFirstName ||
        real.startsWith(amFirstName) ||
        name === amFirstName ||
        // Known alias match
        display.includes(knownAlias) ||
        name.includes(knownAlias) ||
        // Email match
        email.startsWith(amFirstName)
      );
    });
 
    if (!user) {
      // Log all users for debugging
      const allNames = usersData.members
        ?.filter(u => !u.deleted && !u.is_bot)
        .map(u => u.profile?.real_name || u.name)
        .slice(0, 20);
      return res.status(404).json({
        error: `Could not find Slack user for "${amName}"`,
        hint: 'Check that the AM name matches their Slack profile',
        sampleUsers: allNames
      });
    }
 
    // Open DM
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: user.id })
    });
    const dmData = await dmRes.json();
    if (!dmData.ok) return res.status(400).json({ error: 'Could not open DM: ' + dmData.error });
 
    // Send message
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
 
    return res.status(200).json({ success: true, userId: user.id, userName: user.profile?.real_name });
 
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
