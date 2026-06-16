export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchant, am, content } = req.body;
  if (!merchant || !content) return res.status(400).json({ error: 'Missing merchant or content' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured in Vercel env vars' });

  const DATABASE_ID = '351ba43eb13580d5afcaf5f69d9bda5d';

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
          title: {
            title: [{ text: { content: merchant } }]
          }
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: `AM: ${am} | Generated: ${new Date().toLocaleString('en-ZA')}` } }]
            }
          },
          ...content.split('\n').filter(line => line.trim()).map(line => ({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: line } }]
            }
          }))
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Notion API error' });

    return res.status(200).json({ success: true, url: data.url, id: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
