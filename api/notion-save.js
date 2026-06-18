export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchant, am, content, sfData, openTasks, contacts, opportunities, cases, previousActivity, releases, industryIntelligence } = req.body;
  if (!merchant) return res.status(400).json({ error: 'Missing merchant' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const DATABASE_ID = '351ba43eb13580d5afcaf5f69d9bda5d';
  const today = new Date().toISOString().split('T')[0];
  const fmt = (n) => n ? 'R' + Number(n).toLocaleString('en-ZA') : '—';

  // Map AM names to Notion user IDs
  const NOTION_USERS = {
    'vaughn kent-brown': '10dd872b-594c-816d-a241-0002c96d406b',
    'bianca muratu': '1d63c5ce-cb6e-4e0c-9a32-acf3867908bd',
    'mel barnes': '11bd872b-594c-810b-b2c6-000218adb87c',
    'melissa barnes': '11bd872b-594c-810b-b2c6-000218adb87c',
    'lebohang mdakane': '1e5d872b-594c-8114-ae4a-0002090952b3',
    'kelebogile ramasodi': '176d872b-594c-81e7-9a8a-00024c85c765',
    'kylé steyn': '202d872b-594c-8129-9d29-0002e112dae2',
    'kyle steyn': '202d872b-594c-8129-9d29-0002e112dae2',
    'benita nelson': '208d872b-594c-8126-a79e-0002476fd050',
    'nomahlubi madikgetla': '2d8d872b-594c-8127-a5ca-000278a7979d',
    'sesethu time': '2d19078f-7dfa-41ba-b9c2-da676f64d8a3',
    'diaan wiese': '43e93bd3-ad5c-4c9b-8f9e-3a3ebbe0e774',
    'leeroy february': '75d3b10d-e80b-413e-9af4-8e535013370a',
    'danica davids': '95654326-6d06-4ba7-aeb3-16e47051b1e2',
  };

  const amLower = (am || '').toLowerCase();
  const notionUserId = NOTION_USERS[amLower];
    ? `https://yoco-brief.vercel.app/?merchant=${encodeURIComponent(merchant)}&accountId=${encodeURIComponent(sfData.id)}`
    : `https://yoco-brief.vercel.app/?merchant=${encodeURIComponent(merchant)}`;

  const h2 = (text) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } });
  const h3 = (text) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: text } }] } });
  const p = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text || '' } }] } });
  const divider = () => ({ object: 'block', type: 'divider', divider: {} });
  const bullet = (text) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } });

  const blocks = [];

  // Brief link
  blocks.push({
    object: 'block', type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: '🔗 Open Brief: ' } },
        { type: 'text', text: { content: briefUrl, link: { url: briefUrl } }, annotations: { color: 'blue', underline: true } }
      ]
    }
  });
  blocks.push(divider());

  // Account Snapshot
  if (sfData) {
    blocks.push(h2('📊 Account Snapshot'));
    blocks.push(bullet(`30-Day TPV: ${fmt(sfData.tpv30Day)}`));
    blocks.push(bullet(`Billing Plan: ${sfData.billingPackage || '—'} | Segment: ${sfData.segment || '—'}`));
    blocks.push(bullet(`Industry: ${sfData.industry || '—'} | Location: ${sfData.fullAddress || sfData.city || '—'}`));
    blocks.push(bullet(`Key Account: ${sfData.isKeyAccount ? '✅ Yes' : 'No'} | Fully Onboarded: ${sfData.fullyOnboarded ? '✅ Yes' : '❌ No'}`));
    blocks.push(bullet(`Phone: ${sfData.phone || '—'}`));
    blocks.push(bullet(`Open Deals: ${sfData.openDeals || 0} | Won Deals: ${sfData.wonDeals || 0}`));
    if (sfData.integrations) blocks.push(bullet(`Integrations: ${sfData.integrations}`));
    if (sfData.websitePlugins) blocks.push(bullet(`Website Plugins: ${sfData.websitePlugins}`));
    if (sfData.bank) blocks.push(bullet(`Bank: ${sfData.bank.name || '—'}${sfData.bank.type ? ' · ' + sfData.bank.type : ''}`));
    blocks.push(divider());
  }

  // Open Tasks
  if (openTasks?.length) {
    blocks.push(h2('⚡ Open Tasks'));
    openTasks.forEach(t => blocks.push(bullet(t)));
    blocks.push(divider());
  }

  // Contacts
  if (contacts?.length) {
    blocks.push(h2('👥 Key Contacts'));
    contacts.forEach(c => blocks.push(bullet(c)));
    blocks.push(divider());
  }

  // Opportunities
  if (opportunities?.length) {
    blocks.push(h2('💰 Open Opportunities'));
    opportunities.forEach(o => blocks.push(bullet(o)));
    blocks.push(divider());
  }

  // Capital
  if (sfData?.capitalLimit || sfData?.capitalStatus) {
    blocks.push(h2('💳 Yoco Capital'));
    if (sfData.capitalLimit) blocks.push(bullet(`Offer Amount: ${fmt(sfData.capitalLimit)}`));
    if (sfData.capitalStatus) blocks.push(bullet(`Status: ${sfData.capitalStatus}${sfData.capitalProvider ? ' via ' + sfData.capitalProvider : ''}`));
    if (sfData.capitalLastDate) blocks.push(bullet(`Last Advance: ${sfData.capitalLastDate}`));
    blocks.push(divider());
  }

  // Support Cases
  if (cases?.length) {
    blocks.push(h2('🎫 Support Cases (Last 6 Months)'));
    blocks.push(bullet(`Total: ${sfData?.cases || 0} | Open: ${sfData?.openCases || 0}`));
    cases.forEach(c => blocks.push(bullet(c)));
    blocks.push(divider());
  }

  // Previous Activity
  if (previousActivity?.length) {
    blocks.push(h2('📋 Previous Activity'));
    previousActivity.forEach(t => blocks.push(bullet(t)));
    blocks.push(divider());
  }

  // Industry Intelligence
  if (industryIntelligence?.trim()) {
    blocks.push(h2('🏭 Industry Intelligence'));
    industryIntelligence.split('\n').filter(l => l.trim()).forEach(l => blocks.push(p(l)));
    blocks.push(divider());
  }

  // Releases
  if (releases?.trim()) {
    blocks.push(h2('🚀 Relevant Product Releases'));
    releases.split('\n').filter(l => l.trim()).slice(0, 10).forEach(l => blocks.push(p(l)));
    blocks.push(divider());
  }

  // AI Brief
  blocks.push(h2('🤖 AI Pre-Meeting Brief'));
  if (content && content !== 'No AI brief generated.') {
    content.split('\n\n').filter(p => p.trim()).forEach(para => {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: para.trim() } }] } });
    });
  } else {
    blocks.push(p('No AI brief generated.'));
  }
  blocks.push(divider());

  // Post Meeting Notes
  blocks.push(h2('📝 Post-Meeting Notes'));
  blocks.push(p(''));

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
          Engagement: { title: [{ text: { content: `Briefing — ${merchant} — ${today}` } }] },
          'Merchant name': { rich_text: [{ text: { content: merchant } }] },
          'Briefing status': { status: { name: 'Ready' } },
          'Meeting start': { date: { start: today } },
          ...(notionUserId ? { 'Account manager': { people: [{ id: notionUserId }] } } : {})
        },
        children: blocks.slice(0, 100) // Notion API limit is 100 blocks per request
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || JSON.stringify(data) });

    return res.status(200).json({ success: true, url: data.url, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
// Note: to debug users, hit GET https://api.notion.com/v1/users with the token
