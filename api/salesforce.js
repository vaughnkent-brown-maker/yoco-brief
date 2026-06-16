export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { merchant } = req.body;
  if (!merchant) return res.status(400).json({ error: 'Merchant name required' });

  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const token = process.env.SF_SECURITY_TOKEN;

  if (!username || !password || !token) {
    return res.status(500).json({ error: 'Salesforce credentials not configured' });
  }

  try {
    // SOAP login
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

    const authRes = await fetch('https://login.salesforce.com/services/Soap/u/59.0', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'login' },
      body: soapBody
    });

    const authText = await authRes.text();
    const sessionMatch = authText.match(/<sessionId>([^<]+)<\/sessionId>/);
    const serverMatch = authText.match(/<serverUrl>([^<]+)<\/serverUrl>/);

    if (!sessionMatch) {
      const errMatch = authText.match(/<faultstring>([^<]+)<\/faultstring>/);
      return res.status(401).json({ error: 'Login failed: ' + (errMatch?.[1] || 'Check credentials') });
    }

    const sessionId = sessionMatch[1];
    const sfInstance = serverMatch?.[1].match(/https?:\/\/[^\/]+/)?.[0] || 'https://yoco.my.salesforce.com';

    // Step 1 — find account with standard fields only
    const safeMerchant = merchant.replace(/'/g, "\\'");
    const soql = `SELECT Id, Name, Industry, Type, Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate, LastModifiedDate
      FROM Account WHERE Name LIKE '%${safeMerchant}%'
      ORDER BY LastModifiedDate DESC LIMIT 3`;

    const queryRes = await fetch(
      `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      { headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
    );

    if (!queryRes.ok) {
      const err = await queryRes.json().catch(() => []);
      return res.status(queryRes.status).json({ error: err[0]?.message || 'Query failed' });
    }

    const data = await queryRes.json();
    const records = data.records || [];

    if (records.length === 0) {
      return res.status(200).json({ found: false, summary: `No account found for "${merchant}"` });
    }

    const a = records[0];

    // Step 2 — discover custom fields on this account
    let customFields = {};
    try {
      const descRes = await fetch(
        `${sfInstance}/services/data/v59.0/sobjects/Account/${a.Id}`,
        { headers: { 'Authorization': `Bearer ${sessionId}` } }
      );
      if (descRes.ok) {
        const descData = await descRes.json();
        // Pull any field that looks like BUUID or billing
        customFields = {
          buuid: descData.Business_Uuid__c || descData.BusinessUuid__c || descData.BUUID__c || descData.Business_UUID__c || null,
          billingPackage: descData.Billing_Package__c || descData.BillingPackage__c || descData.Billing_plan__c || null,
          isKeyAccount: descData.Key_Account__c || descData.IsKeyAccount__c || false,
          nps: descData.NPS_Score__c || descData.NPS__c || null,
          health: descData.Account_Health__c || descData.Health__c || null,
          allCustom: Object.keys(descData).filter(k => k.endsWith('__c')).slice(0, 20)
        };
      }
    } catch(e) { /* skip */ }

    return res.status(200).json({
      found: true,
      id: a.Id,
      name: a.Name,
      industry: a.Industry,
      type: a.Type,
      phone: a.Phone,
      city: a.BillingCity,
      country: a.BillingCountry,
      owner: a.Owner?.Name,
      createdDate: a.CreatedDate,
      sfUrl: `${sfInstance}/${a.Id}`,
      ...customFields
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
