module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pageId, merchant, am, notes, rawNotes } = req.body;
  if (!notes) return res.status(400).json({ error: 'Missing notes' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const DATABASE_ID = '351ba43eb13580d5afcaf5f69d9bda5d';
  const headers = {
    'Authorization': `Bearer ${notionToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };

  try {
    let targetPageId = pageId;

    // If no page ID provided, find the most recent page for this merchant
    if (!targetPageId && merchant) {
      const searchRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST', headers,
        body: JSON.stringify({
          filter: { property: 'Merchant name', rich_text: { contains: merchant } },
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 1
        })
      });
      const searchData = await searchRes.json();
      if (searchData.results && searchData.results.length) {
        targetPageId = searchData.results[0].id;
      }
    }

    if (!targetPageId) {
      return res.status(404).json({ error: 'No Notion page found — save the brief to Notion first' });
    }

    const today = new Date().toLocaleString('en-ZA');

    // Append post-meeting notes blocks to the page
    const blocks = [
      { object: 'block', type: 'divider', divider: {} },
      {
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: `📝 Post-Meeting Update — ${today}` } }] }
      },
      {
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: notes } }] }
      }
    ];

    const appendRes = await fetch(`https://api.notion.com/v1/blocks/${targetPageId}/children`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ children: blocks })
    });

    const appendData = await appendRes.json();
    if (!appendRes.ok) return res.status(appendRes.status).json({ error: appendData.message || 'Append failed' });

    // Note: status update skipped — "Completed" may not be a valid option in the DB.
    // The notes append above is the key update.

    return res.status(200).json({ success: true, pageId: targetPageId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
