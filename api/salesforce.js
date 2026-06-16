export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { merchant, accountId, groupAccount } = req.body;
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

    // Multiple accounts — return list for AM to choose
    if (records.length > 1) {
      // Check if a specific account ID was requested
      const { accountId } = req.body;
      if (!accountId) {
        return res.status(200).json({
          found: 'multiple',
          accounts: records.map(r => ({
            id: r.Id,
            name: r.Name,
            industry: r.Industry,
            type: r.Type,
            city: r.BillingCity,
            country: r.BillingCountry,
            owner: r.Owner?.Name,
            lastModified: r.LastModifiedDate
          }))
        });
      }
      // Find the chosen account
      const chosen = records.find(r => r.Id === accountId);
      if (!chosen) return res.status(404).json({ found: false, summary: 'Account not found' });
      records[0] = chosen;
    }

    const a = records[0];

    // Step 2 — fetch previous tasks (last 5 closed/completed)
    let previousTasks = [];
    try {
      const taskSoql = `SELECT Id, Subject, Description, Status, Priority, ActivityDate, CreatedDate, Owner.Name
        FROM Task
        WHERE WhatId = '${a.Id}' AND IsClosed = true
        ORDER BY CreatedDate DESC LIMIT 5`;
      const taskRes = await fetch(
        `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(taskSoql)}`,
        { headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
      );
      if (taskRes.ok) {
        const taskData = await taskRes.json();
        previousTasks = (taskData.records || []).map(t => ({
          subject: t.Subject,
          description: t.Description || '',
          status: t.Status,
          priority: t.Priority,
          date: t.ActivityDate || t.CreatedDate?.split('T')[0],
          owner: t.Owner?.Name
        }));
      }
    } catch(e) { /* skip */ }

    // Step 3 — fetch open tasks
    let openTasks = [];
    try {
      const openSoql = `SELECT Id, Subject, Status, Priority, ActivityDate FROM Task
        WHERE WhatId = '${a.Id}' AND IsClosed = false
        ORDER BY ActivityDate ASC LIMIT 5`;
      const openRes = await fetch(
        `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(openSoql)}`,
        { headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
      );
      if (openRes.ok) {
        const openData = await openRes.json();
        openTasks = (openData.records || []).map(t => ({
          subject: t.Subject,
          status: t.Status,
          priority: t.Priority,
          dueDate: t.ActivityDate
        }));
      }
    } catch(e) { /* skip */ }

    // Step 4 — fetch child/sub accounts if group account requested
    let childAccounts = [];
    if (groupAccount) {
      try {
        const childSoql = `SELECT Id, Name, Industry, Type, Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate
          FROM Account WHERE ParentId = '${a.Id}'
          ORDER BY Name ASC LIMIT 20`;
        const childRes = await fetch(
          `${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(childSoql)}`,
          { headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
        );
        if (childRes.ok) {
          const childData = await childRes.json();
          // For each child, get custom fields
          for (const child of childData.records || []) {
            const childCustomRes = await fetch(
              `${sfInstance}/services/data/v59.0/sobjects/Account/${child.Id}`,
              { headers: { 'Authorization': `Bearer ${sessionId}` } }
            );
            let childCustom = {};
            if (childCustomRes.ok) {
              const cd = await childCustomRes.json();
              const keys = Object.keys(cd).filter(k => k.endsWith('__c'));
              const buuidKey = keys.find(k => k.toLowerCase().includes('uuid') || k.toLowerCase().includes('buuid'));
              childCustom = {
                buuid: buuidKey ? cd[buuidKey] : null,
                billingPackage: cd.Billing_Package__c || cd.BillingPackage__c || null,
                tpv30Day: cd.X30_Day_TPV__c || null,
                volumeThisMonth: cd.Pipedrive_Legacy_Volume_this_month__c || null,
                fullyOnboarded: cd.Fully_Onboarded__c || null
              };
            }
            childAccounts.push({
              id: child.Id,
              name: child.Name,
              industry: child.Industry,
              type: child.Type,
              phone: child.Phone,
              city: child.BillingCity,
              country: child.BillingCountry,
              owner: child.Owner?.Name,
              createdDate: child.CreatedDate,
              sfUrl: `${sfInstance}/${child.Id}`,
              ...childCustom
            });
          }
        }
      } catch(e) { /* skip child accounts */ }
    }

    // Step 5 — discover custom fields on this account
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
