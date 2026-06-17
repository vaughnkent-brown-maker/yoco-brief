export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accountId, subject, description, ownerId } = req.body;
  if (!accountId || !description) return res.status(400).json({ error: 'Missing accountId or description' });

  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const token = process.env.SF_SECURITY_TOKEN;

  try {
    // Login
    const loginRes = await fetch('https://login.salesforce.com/services/Soap/u/59.0', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'login' },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">
          <soapenv:Body><urn:login>
            <urn:username>${username}</urn:username>
            <urn:password>${password}${token}</urn:password>
          </urn:login></soapenv:Body>
        </soapenv:Envelope>`
    });

    const loginXml = await loginRes.text();
    const sessionMatch = loginXml.match(/<sessionId>([^<]+)<\/sessionId>/);
    const serverMatch = loginXml.match(/<serverUrl>([^<]+)<\/serverUrl>/);
    if (!sessionMatch) return res.status(401).json({ error: 'SF login failed' });

    const sessionId = sessionMatch[1];
    const instanceUrl = serverMatch[1].replace(/\/services\/Soap.*/, '');

    // Create task
    const today = new Date().toISOString().split('T')[0];
    const taskBody = {
      WhatId: accountId,
      Subject: subject || 'Post-Meeting Notes',
      Description: description,
      Status: 'Open',
      Priority: 'Normal',
      ActivityDate: today,
      Type: 'Site Visit'
    };

    const taskRes = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/Task`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionId}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskBody)
    });

    const taskData = await taskRes.json();
    if (!taskRes.ok) return res.status(500).json({ error: taskData[0]?.message || 'Failed to create task' });

    return res.status(200).json({ success: true, taskId: taskData.id, instanceUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
