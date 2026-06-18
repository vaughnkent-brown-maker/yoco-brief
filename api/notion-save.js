export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchant, am, content, sfData } = req.body;
  if (!merchant || !content) return res.status(400).json({ error: 'Missing merchant or content' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const DATABASE_ID = '351ba43eb13580d5afcaf5f69d9bda5d';
  const today = new Date().toISOString().split('T')[0];
  const engagementTitle = `Briefing — ${merchant} — ${today}`;
  const fmt = (n) => n ? 'R' + Number(n).toLocaleString('en-ZA') : '—';

  // Build rich body blocks
  const blocks = [];

  // Brief link
  const briefUrl = sfData?.id
    ? `https://yoco-brief.vercel.app/?merchant=${encodeURIComponent(merchant)}&accountId=${encodeURIComponent(sfData.id)}`
    : `https://yoco-brief.vercel.app/?merchant=${encodeURIComponent(merchant)}`;

  blocks.push({
    object: 'block', type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: '🔗 Open Brief: ' } },
        { type: 'text', text: { content: briefUrl, link: { url: briefUrl } }, annotations: { color: 'blue', underline: true } }
      ]
    }
  });

  blocks.push({ object: 'block', type: 'divider', divider: {} });

  // Account snapshot section
  if (sfData) {
    blocks.push({
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: '📊 Account Snapshot' } }] }
    });
    const snapshot = [
      `• 30-Day TPV: ${fmt(sfData.tpv30Day)}`,
      `• Billing Plan: ${sfData.billingPackage || '—'}`,
      `• Industry: ${sfData.industry || '—'} | City: ${sfData.city || '—'}`,
      `• Key Account: ${sfData.isKeyAccount ? 'Yes' : 'No'} | Segment: ${sfData.segment || '—'}`,
      `• Fully Onboarded: ${sfData.fullyOnboarded ? 'Yes' : 'No'}`,
      `• Open Deals: ${sfData.openDeals || 0} | Won Deals: ${sfData.wonDeals || 0}`,
      sfData.cases !== undefined ? `• Support Cases (6mo): ${sfData.cases} total, ${sfData.openCases || 0} open` : null,
      sfData.capitalLimit ? `• Capital Offer: ${fmt(sfData.capitalLimit)}${sfData.capitalStatus ? ' — ' + sfData.capitalStatus : ''}` : null,
      sfData.integrations ? `• Integrations: ${sfData.integrations}` : null,
      sfData.opportunities ? `• Open Opportunities: ${sfData.opportunities}` : null,
    ].filter(Boolean).join('\n');

    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: snapshot } }] }
    });

    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }

  // AI Brief section
  blocks.push({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: '🤖 AI Pre-Meeting Brief' } }] }
  });

  // Split AI content into paragraphs
  content.split('\n\n').filter(p => p.trim()).forEach(para => {
    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: para.trim() } }] }
    });
  });

  // Post meeting notes placeholder
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: '📝 Post-Meeting Notes' } }] }
  });
  blocks.push({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] }
  });

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: DATABASE_ID },
        properties: {
          Engagement: {
            title: [{ text: { content: engagementTitle } }]
          },
          'Merchant name': {
            rich_text: [{ text: { content: merchant } }]
          },
          'Briefing status': {
            status: { name: 'Ready' }
          },
          'Meeting start': {
            date: { start: today }
          },
          'Account manager': {
            people: [] // Notion people fields need user IDs — will be blank but field is set
          }
        },
        children: blocks
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || JSON.stringify(data) });

    return res.status(200).json({ success: true, url: data.url, id: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
