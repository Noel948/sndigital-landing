// Hírlevél-feliratkozás → GoHighLevel kontakt + "hirlevel" címke.
// A címke indítja a GHL workflow-t (trigger: Contact Tag added = hirlevel), ami kiküldi a sablont.
//
// Szükséges Vercel környezeti változók:
//   GHL_PRIVATE_TOKEN  – GHL Private Integration token (scope: contacts.write, contacts.readonly)
//   GHL_LOCATION_ID    – a GHL alfiók (location) azonosítója

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const TAG = 'hirlevel';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function ghl(path, body) {
  const res = await fetch(GHL_API + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GHL_PRIVATE_TOKEN}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL ${path} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.GHL_PRIVATE_TOKEN || !process.env.GHL_LOCATION_ID) {
    console.error('subscribe: missing GHL_PRIVATE_TOKEN or GHL_LOCATION_ID');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  // Spam bot: a rejtett mező ki van töltve → csendben "sikeres"
  if (body.company_website) return res.status(200).json({ ok: true });

  const firstName = String(body.first_name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const source = body.source === 'popup' ? 'popup' : 'inline';

  if (!firstName || !EMAIL_RE.test(email) || body.consent !== true) {
    return res.status(400).json({ ok: false, error: 'invalid_input' });
  }

  try {
    const upsert = await ghl('/contacts/upsert', {
      locationId: process.env.GHL_LOCATION_ID,
      firstName,
      email,
      source: 'sndigital.hu hírlevél'
    });
    const contactId = upsert.contact && upsert.contact.id;
    if (!contactId) throw new Error('GHL upsert: no contact id');

    // Külön hívással adjuk hozzá a címkét, hogy a meglévő címkék megmaradjanak
    await ghl(`/contacts/${contactId}/tags`, { tags: [TAG] });

    // Hozzájárulás naplózása (GDPR) — ha ez elbukik, a feliratkozás attól még sikeres
    const consentAt = new Date().toISOString();
    await ghl(`/contacts/${contactId}/notes`, {
      body: `Hírlevél-feliratkozás (${source}) — adatkezelési hozzájárulás: ${consentAt}. Oldal: ${String(body.page || '').slice(0, 200)}`
    }).catch(err => console.error('subscribe: note failed', err.message));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe:', err.message);
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }
};
