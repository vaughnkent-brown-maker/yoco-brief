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
        const d = await descRes.json();
        const allCustomKeys = Object.keys(d).filter(k => k.endsWith('__c'));
        // Find BUUID field — try all likely names
        const buuidKey = allCustomKeys.find(k => k.toLowerCase().includes('uuid') || k.toLowerCase().includes('buuid'));
        const keyAccKey = allCustomKeys.find(k => k.toLowerCase().includes('key_account') || k.toLowerCase().includes('keyaccount'));
        const npsKey = allCustomKeys.find(k => k.toLowerCase().includes('nps'));
        const healthKey = allCustomKeys.find(k => k.toLowerCase().includes('health'));
        customFields = {
          buuid: buuidKey ? d[buuidKey] : null,
          billingPackage: d.Billing_Package__c || d.BillingPackage__c || null,
          isKeyAccount: keyAccKey ? d[keyAccKey] : false,
          nps: npsKey ? d[npsKey] : null,
          health: healthKey ? d[healthKey] : null,
          tpv30Day: d.X30_Day_TPV__c || null,
          openDeals: d.Open_deals__c || null,
          wonDeals: d.Won_deals__c || null,
          lostDeals: d.Lost_deals__c || null,
          volumeThisMonth: d.Pipedrive_Legacy_Volume_this_month__c || null,
          fullyOnboarded: d.Fully_Onboarded__c || null,
          allCustom: allCustomKeys
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
