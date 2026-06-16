export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    return res.status(500).json({ error: 'Notion token not configured — add NOTION_TOKEN to Vercel env vars' });
  }

  const { merchant } = req.body;
  if (!merchant) return res.status(400).json({ error: 'Merchant name required' });

  // Only search AM Briefings TEST database
  const AM_BRIEFINGS_DB = '9a7ba43eb13582acade68189d20d1327';

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${AM_BRIEFINGS_DB}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          or: [
            { property: 'Engagement', title: { contains: merchant } },
            { property: 'Context', rich_text: { contains: merchant } }
          ]
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 5
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message || 'Notion query failed' });
    }

    const data = await response.json();
    const pages = data.results || [];

    if (pages.length === 0) {
      return res.status(200).json({ summary: `No previous AM briefings found for "${merchant}" in AM Briefings TEST.` });
    }

    const summaries = pages.map(p => {
      const title = p.properties?.Engagement?.title?.[0]?.plain_text || 'Untitled';
      const context = p.properties?.Context?.rich_text?.[0]?.plain_text || '';
      const nextActions = p.properties?.['Next best actions']?.rich_text?.[0]?.plain_text || '';
      const am = p.properties?.['Account manager']?.rich_text?.[0]?.plain_text || '';
      const edited = new Date(p.last_edited_time).toLocaleDateString('en-ZA');
      return `[${edited}] ${title}${am ? ' · AM: ' + am : ''}${context ? '\nContext: ' + context.slice(0, 150) : ''}${nextActions ? '\nNext actions: ' + nextActions.slice(0, 150) : ''}`;
    });

    return res.status(200).json({ summary: summaries.join('\n\n'), count: pages.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}