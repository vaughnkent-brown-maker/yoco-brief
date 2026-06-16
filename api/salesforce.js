export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { merchant } = req.body;
  if (!merchant) return res.status(400).json({ error: 'Merchant name required' });

  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const token = process.env.SF_SECURITY_TOKEN;
  const instanceUrl = process.env.SF_INSTANCE_URL || 'https://yoco.lightning.force.com';

  if (!username || !password || !token) {
    return res.status(500).json({ error: 'Salesforce credentials not configured' });
  }

  try {
    // Step 1 — Authenticate
    const authRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: '3MVG9pRzvMkjMb6lCBIBOIZaGAMflyYhGLdTrWJsqXEhDGcR9RbNFGGJmJIgXEhDGcR9',
        client_secret: 'unused',
        username,
        password: password + token
      })
    });

    // Use session ID auth instead — simpler, no Connected App needed
    const sfAuth = await fetch(`${instanceUrl}/services/Soap/u/59.0`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'login' },
      body: `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${username}</n1:username>
      <n1:password>${password}${token}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`
    });

    const authText = await sfAuth.text();

    // Extract session ID and server URL from SOAP response
    const sessionMatch = authText.match(/<sessionId>([^<]+)<\/sessionId>/);
    const serverMatch = authText.match(/<serverUrl>([^<]+)<\/serverUrl>/);

    if (!sessionMatch) {
      const errMatch = authText.match(/<faultstring>([^<]+)<\/faultstring>/);
      return res.status(401).json({ error: 'Salesforce auth failed: ' + (errMatch?.[1] || 'Invalid credentials') });
    }

    const sessionId = sessionMatch[1];
    const serverUrl = serverMatch?.[1] || instanceUrl;
    const sfInstance = serverUrl.match(/https?:\/\/[^\/]+/)?.[0] || instanceUrl;

    // Step 2 — Query Account by name
    const soql = `SELECT Id, Name, Industry, Type, Phone, BillingCity, BillingCountry,
      Account_Health__c, Business_Uuid__c, Billing_Package__c, Key_Account__c,
      Key_Account_Manager__r.Name, Owner.Name, NPS_Score__c,
      CreatedDate, LastModifiedDate,
      (SELECT Id, Subject, Status, Priority, ActivityDate FROM OpenActivities LIMIT 5),
      (SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunities WHERE IsClosed = false LIMIT 5)
      FROM Account
      WHERE Name LIKE '%${merchant.replace(/'/g, "\\'")}%'
      ORDER BY LastModifiedDate DESC
      LIMIT 3`;

    const queryRes = await fetch(
      `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      { headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
    );

    if (!queryRes.ok) {
      const err = await queryRes.json();
      return res.status(queryRes.status).json({ error: err[0]?.message || 'Query failed' });
    }

    const data = await queryRes.json();
    const records = data.records || [];

    if (records.length === 0) {
      return res.status(200).json({ found: false, summary: `No Salesforce account found for "${merchant}"` });
    }

    const account = records[0];

    // Format response
    const result = {
      found: true,
      id: account.Id,
      name: account.Name,
      industry: account.Industry,
      type: account.Type,
      phone: account.Phone,
      city: account.BillingCity,
      country: account.BillingCountry,
      health: account.Account_Health__c,
      buuid: account.Business_Uuid__c,
      billingPackage: account.Billing_Package__c,
      isKeyAccount: account.Key_Account__c,
      keyAccountManager: account.Key_Account_Manager__r?.Name,
      owner: account.Owner?.Name,
      nps: account.NPS_Score__c,
      createdDate: account.CreatedDate,
      lastModified: account.LastModifiedDate,
      openTasks: (account.OpenActivities?.records || []).map(t => ({
        subject: t.Subject,
        status: t.Status,
        priority: t.Priority,
        dueDate: t.ActivityDate
      })),
      opportunities: (account.Opportunities?.records || []).map(o => ({
        name: o.Name,
        stage: o.StageName,
        amount: o.Amount,
        closeDate: o.CloseDate
      })),
      sfUrl: `${sfInstance}/${account.Id}`
    };

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
