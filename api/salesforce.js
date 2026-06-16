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
    const authRes = await fetch('https://login.salesforce.com/services/Soap/u/59.0', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'login' },
      body: `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${username}</n1:username>
      <n1:password>${password}${token}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`
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

    const query = async (soql) => {
      const r = await fetch(`${sfInstance}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`, {
        headers: { 'Authorization': `Bearer ${sessionId}`, 'Content-Type': 'application/json' }
      });
      if (!r.ok) return { records: [] };
      return r.json();
    };

    const getRecord = async (id) => {
      const r = await fetch(`${sfInstance}/services/data/v59.0/sobjects/Account/${id}`, {
        headers: { 'Authorization': `Bearer ${sessionId}` }
      });
      if (!r.ok) return {};
      return r.json();
    };

    // Step 1 — find accounts
    const safeMerchant = merchant.replace(/'/g, "\\'");
    const accountData = await query(
      `SELECT Id, Name, Industry, Type, Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate, LastModifiedDate
       FROM Account WHERE Name LIKE '%${safeMerchant}%'
       ORDER BY LastModifiedDate DESC LIMIT 10`
    );

    const records = accountData.records || [];
    if (records.length === 0) return res.status(200).json({ found: false, summary: `No account found for "${merchant}"` });

    // Multiple accounts picker
    if (records.length > 1 && !accountId) {
      return res.status(200).json({
        found: 'multiple',
        accounts: records.map(r => ({
          id: r.Id, name: r.Name, industry: r.Industry, type: r.Type,
          city: r.BillingCity, country: r.BillingCountry, owner: r.Owner?.Name,
          lastModified: r.LastModifiedDate
        }))
      });
    }

    const a = accountId ? (records.find(r => r.Id === accountId) || records[0]) : records[0];

    // Step 2 — run all secondary queries IN PARALLEL
    const safeQuery = async (soql) => { try { return await query(soql); } catch(e) { return { records: [] }; } };

    const [customData, prevTasksData, openTasksData, contactsData, oppsData, casesData] = await Promise.all([
      getRecord(a.Id).catch(() => ({})),
      safeQuery(`SELECT Id, Subject, Description, Status, Priority, ActivityDate, CreatedDate, Owner.Name
             FROM Task WHERE WhatId = '${a.Id}' AND IsClosed = true
             ORDER BY CreatedDate DESC LIMIT 5`),
      safeQuery(`SELECT Id, Subject, Status, Priority, ActivityDate
             FROM Task WHERE WhatId = '${a.Id}' AND IsClosed = false
             ORDER BY ActivityDate ASC LIMIT 5`),
      safeQuery(`SELECT Id, FirstName, LastName, Title, Phone, MobilePhone, Email
             FROM Contact WHERE AccountId = '${a.Id}'
             ORDER BY CreatedDate ASC LIMIT 5`),
      safeQuery(`SELECT Id, Name, StageName, Amount, CloseDate, Owner.Name, Description
             FROM Opportunity WHERE AccountId = '${a.Id}' AND IsClosed = false
             ORDER BY CloseDate ASC LIMIT 5`),
      safeQuery(`SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate, ClosedDate, Description, Origin
             FROM Case WHERE AccountId = '${a.Id}'
             ORDER BY CreatedDate DESC LIMIT 10`)
    ]);

    // Child accounts (only if group account requested)
    let childAccounts = [];
    if (groupAccount) {
      const childData = await query(
        `SELECT Id, Name, Industry, Type, Phone, BillingCity, BillingCountry, Owner.Name, CreatedDate
         FROM Account WHERE ParentId = '${a.Id}' ORDER BY Name ASC LIMIT 20`
      );
      // Get custom fields for each child in parallel
      const childCustomPromises = (childData.records || []).map(c => getRecord(c.Id));
      const childCustomResults = await Promise.all(childCustomPromises);
      childAccounts = (childData.records || []).map((c, i) => {
        const cd = childCustomResults[i] || {};
        const keys = Object.keys(cd).filter(k => k.endsWith('__c'));
        const buuidKey = keys.find(k => k.toLowerCase().includes('uuid') || k.toLowerCase().includes('buuid'));
        return {
          id: c.Id, name: c.Name, industry: c.Industry, type: c.Type,
          phone: c.Phone, city: c.BillingCity, country: c.BillingCountry,
          owner: c.Owner?.Name, createdDate: c.CreatedDate,
          sfUrl: `${sfInstance}/${c.Id}`,
          buuid: buuidKey ? cd[buuidKey] : null,
          billingPackage: cd.Billing_Package__c || null,
          tpv30Day: cd.X30_Day_TPV__c || null,
          fullyOnboarded: cd.Fully_Onboarded__c || null
        };
      });
    }

    // Parse custom fields
    const d = customData;
    const allCustomKeys = Object.keys(d).filter(k => k.endsWith('__c'));
    const find = (terms) => allCustomKeys.find(k => terms.every(t => k.toLowerCase().includes(t)));

    const buuidKey = find(['uuid']) || find(['buuid']);
    const keyAccKey = find(['key_account']) || find(['keyaccount']);
    const capitalBalKey = find(['capital', 'balance']);
    const capitalTakenKey = find(['capital', 'amount']) || find(['capital', 'total']) || find(['capital', 'taken']);
    const capitalStatusKey = find(['capital', 'status']);
    const capitalLimitKey = find(['capital', 'limit']);
    const capitalEligKey = find(['capital', 'eligible']);
    const terminalKey = find(['terminal']) || find(['device']);
    const gatewayKey = find(['gateway']) || find(['ecommerce']);
    const savingsKey = find(['saving']);
    const lastTransKey = find(['last', 'transaction']);
    const riskKey = find(['risk']) || find(['churn']);
    const segmentKey = find(['segment']) || find(['merchant_type']);
    const npsKey = find(['nps']);
    const healthKey = find(['health']);
    // Intercom keys
    const intercomIdKey = find(['intercom', 'id']) || find(['intercom']);
    const intercomConvKey = find(['intercom', 'conv']) || find(['intercom', 'ticket']) || find(['intercom', 'open']);
    const intercomHealthKey = find(['intercom', 'health']) || find(['intercom', 'score']);
    const intercomLastKey = find(['intercom', 'last']) || find(['intercom', 'recent']);
    const intercomTagsKey = find(['intercom', 'tag']);
    const intercomCsatKey = find(['intercom', 'csat']) || find(['intercom', 'satisf']);
    const intercomSegKey = find(['intercom', 'segment']) || find(['intercom', 'plan']);
    const supportRatingKey = find(['support', 'rating']) || find(['support', 'score']) || find(['csat']);
    const openTicketsKey = find(['open', 'ticket']) || find(['support', 'ticket']);
    const totalConvsKey = find(['total', 'conv']) || find(['lifetime', 'conv']);

    const previousTasks = (prevTasksData.records || []).map(t => ({
      id: t.Id, subject: t.Subject, description: t.Description || '',
      status: t.Status, priority: t.Priority,
      date: t.ActivityDate || t.CreatedDate?.split('T')[0], owner: t.Owner?.Name
    }));

    const openTasks = (openTasksData.records || []).map(t => ({
      id: t.Id, subject: t.Subject, status: t.Status,
      priority: t.Priority, dueDate: t.ActivityDate
    }));

    const contacts = (contactsData.records || []).map(c => ({
      id: c.Id, firstName: c.FirstName || '', lastName: c.LastName || '',
      name: `${c.FirstName || ''} ${c.LastName || ''}`.trim(),
      title: c.Title || '', phone: c.Phone || '',
      mobile: c.MobilePhone || '', email: c.Email || '',
      sfUrl: `${sfInstance}/${c.Id}`
    }));

    return res.status(200).json({
      found: true,
      id: a.Id, name: a.Name, industry: a.Industry, type: a.Type,
      phone: a.Phone, city: a.BillingCity, country: a.BillingCountry,
      owner: a.Owner?.Name, createdDate: a.CreatedDate,
      sfUrl: `${sfInstance}/${a.Id}`,
      sfInstance,
      // Custom fields
      buuid: buuidKey ? d[buuidKey] : null,
      billingPackage: d.Billing_Package__c || null,
      isKeyAccount: keyAccKey ? d[keyAccKey] : false,
      nps: npsKey ? d[npsKey] : null,
      health: healthKey ? d[healthKey] : null,
      // Intercom
      intercomId: intercomIdKey ? d[intercomIdKey] : null,
      intercomOpenConvs: intercomConvKey ? d[intercomConvKey] : null,
      intercomHealth: intercomHealthKey ? d[intercomHealthKey] : null,
      intercomLastContact: intercomLastKey ? d[intercomLastKey] : null,
      intercomTags: intercomTagsKey ? d[intercomTagsKey] : null,
      intercomCsat: intercomCsatKey ? d[intercomCsatKey] : null,
      intercomSegment: intercomSegKey ? d[intercomSegKey] : null,
      supportRating: supportRatingKey ? d[supportRatingKey] : null,
      openTickets: openTicketsKey ? d[openTicketsKey] : null,
      totalConvs: totalConvsKey ? d[totalConvsKey] : null,
      tpv30Day: d.X30_Day_TPV__c || null,
      openDeals: d.Open_deals__c || null,
      wonDeals: d.Won_deals__c || null,
      lostDeals: d.Lost_deals__c || null,
      volumeThisMonth: d.Pipedrive_Legacy_Volume_this_month__c || null,
      fullyOnboarded: d.Fully_Onboarded__c || null,
      // Capital
      capitalBalance: capitalBalKey ? d[capitalBalKey] : null,
      capitalTaken: capitalTakenKey ? d[capitalTakenKey] : null,
      capitalStatus: capitalStatusKey ? d[capitalStatusKey] : null,
      capitalLimit: capitalLimitKey ? d[capitalLimitKey] : null,
      capitalEligible: capitalEligKey ? d[capitalEligKey] : null,
      // Products
      terminalCount: terminalKey ? d[terminalKey] : null,
      hasGateway: gatewayKey ? d[gatewayKey] : null,
      hasSavings: savingsKey ? d[savingsKey] : null,
      lastTransaction: lastTransKey ? d[lastTransKey] : null,
      riskFlag: riskKey ? d[riskKey] : null,
      segment: segmentKey ? d[segmentKey] : null,
      // Related data
      openTasks, previousTasks, contacts,
      cases: (casesData.records || []).map(c => ({
        id: c.Id,
        caseNumber: c.CaseNumber,
        subject: c.Subject,
        status: c.Status,
        priority: c.Priority,
        origin: c.Origin,
        created: c.CreatedDate?.split('T')[0],
        closed: c.ClosedDate?.split('T')[0],
        description: c.Description || ''
      })),
      opportunities: (oppsData.records || []).map(o => ({
        id: o.Id,
        name: o.Name,
        stage: o.StageName,
        amount: o.Amount,
        closeDate: o.CloseDate,
        owner: o.Owner?.Name,
        description: o.Description || '',
        sfUrl: `${sfInstance}/${o.Id}`
      })),
      childAccounts, isGroupAccount: groupAccount || false,
      allCustom: allCustomKeys
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0,3).join(' | ') });
  }
}
