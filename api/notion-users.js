export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'No token' });

  const cursor = req.query.cursor;
  const url = cursor
    ? `https://api.notion.com/v1/users?start_cursor=${cursor}`
    : 'https://api.notion.com/v1/users';

  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28' }
  });
  const data = await r.json();
  // Return just names and IDs for easy reading
  const users = (data.results || []).map(u => ({ name: u.name, id: u.id, email: u.person?.email }));
  return res.status(200).json({ users, next_cursor: data.next_cursor, has_more: data.has_more });
}
