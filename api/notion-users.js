export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'No token' });

  const r = await fetch('https://api.notion.com/v1/users', {
    headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28' }
  });
  const data = await r.json();
  return res.status(200).json(data);
}
