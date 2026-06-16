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
    return res.status(500).json({ error: 'Salesforce credentials not configured — add SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN to Vercel env vars' });
  }

  try {
    // SOAP login — no Connected App needed
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${username}</n1:username>
      <n1:password>${password}${token}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`;

    const authRes = await fetch(`${instanceUrl}/services/Soap/u/59.0`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'login'
      },
      body: soapBody
    });

    const authText = await authRes.text();

    const sessionMatch = authText.match(/<sessionId>([^<]+)<\/sessionId>/);
    const serverMatch = authText.match(/<serverUrl>([^<]+)<\/serverUrl>/);

    if (!sessionMatch) {
      const errMatch = authText.match(/<faultstring>([^<]+)<\/faultstring>/);
      return res.status(401).json({
        error: 'Salesforce login failed: ' + (errMatch?.[1] || 'Check username, password and security token')
      });
    }

    const sessionId = sessionMatch[1];
    const serverUrl = serverMatch?.[1] || '';
    const sfInstance = serverUrl.match(/https?:\/\/[^\/]+/)?.[0] || instanceUrl;

    // SOQL query
    const soql = `SELECT Id, Name, Industry, Type, Phone, BillingCity,
      Billing_Package__c, Business_Uuid__c, Key_Account__c,
      Owner.Name, NPS_Score__c, CreatedDate,
      (SELECT Id, Subject, Status, Priority, ActivityDate FROM OpenActivities LIMIT 5),
      (SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunities WHERE IsClosed = false LIMIT 3)
      FROM Account
      WHERE Name LIKE '%${merchant.replace(/'/g, "\\'")}%'
      ORDER BY LastModifiedDate DESC
      LIMIT 3`;

    const queryRes = await fetch(
      `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      {
        headers: {
          'Authorization': `Bearer ${sessionId}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!queryRes.ok) {
      const err = await queryRes.json().catch(() => []);
      return res.status(queryRes.status).json({ error: err[0]?.message || 'Query failed' });
    }

    const data = await queryRes.json();
    const records = data.records || [];

    if (records.length === 0) {
      return res.status(200).json({ found: false, summary: `No Salesforce account found for "${merchant}"` });
    }

    const a = records[0];
    return res.status(200).json({
      found: true,
      id: a.Id,
      name: a.Name,
      industry: a.Industry,
      type: a.Type,
      phone: a.Phone,
      city: a.BillingCity,
      billingPackage: a.Billing_Package__c,
      buuid: a.Business_Uuid__c,
      isKeyAccount: a.Key_Account__c,
      owner: a.Owner?.Name,
      nps: a.NPS_Score__c,
      createdDate: a.CreatedDate,
      openTasks: (a.OpenActivities?.records || []).map(t => ({
        subject: t.Subject,
        status: t.Status,
        priority: t.Priority,
        dueDate: t.ActivityDate
      })),
      opportunities: (a.Opportunities?.records || []).map(o => ({
        name: o.Name,
        stage: o.StageName,
        amount: o.Amount,
        closeDate: o.CloseDate
      })),
      sfUrl: `${sfInstance}/${a.Id}`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
