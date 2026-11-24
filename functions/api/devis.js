const recipient = 'contact@rm-multiservices.re';
const services = new Set([
  'Travaux de rénovation', 'Piscine', 'Dépannage', 'Conciergerie',
  'Nettoyage', 'Espaces verts', 'Entretien courant', 'Autre'
]);
const maxBodyBytes = 48000;

function json(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function available(env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

export function onRequestGet({ env }) {
  return json(200, { siteKey: available(env) ? env.TURNSTILE_SITE_KEY : null });
}

async function readFields(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  return new URLSearchParams(body + decoder.decode());
}

export async function onRequestPost({ request, env }) {
  const unavailable = 'Le formulaire est temporairement indisponible.';
  if (!available(env)) return json(503, { message: unavailable });

  const origin = new URL(request.url);
  const contentType = request.headers.get('Content-Type')?.split(';')[0];
  if (request.headers.get('Origin') !== origin.origin || contentType !== 'application/x-www-form-urlencoded') {
    return json(400, { message: 'Cette demande ne peut pas être traitée.' });
  }

  try {
    const fields = await readFields(request);
    if (!fields) return json(413, { message: 'La demande dépasse la taille autorisée.' });
    const name = fields.get('name')?.trim() ?? '';
    const phone = fields.get('phone')?.trim() ?? '';
    const email = fields.get('email')?.trim() ?? '';
    const service = fields.get('service');
    const message = fields.get('message')?.trim() ?? '';
    const token = fields.get('cf-turnstile-response') ?? '';

    if (!name || name.length > 120 || phone.length > 40 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        !services.has(service) || !message || message.length > 3000) {
      return json(400, { message: 'Vérifiez les champs du formulaire puis réessayez.' });
    }
    if (!token || token.length > 2048) {
      return json(400, { message: 'Effectuez la vérification du formulaire puis réessayez.' });
    }

    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(7500)
    });
    if (!verification.ok) return json(503, { message: unavailable });
    const check = await verification.json();
    if (!check.success || check.action !== 'devis' || check.hostname !== origin.hostname) {
      return json(400, { message: 'La vérification a échoué. Réessayez.' });
    }

    const delivery = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [recipient],
        reply_to: email,
        subject: `Demande de devis – ${service}`,
        text: `Nom : ${name}\nTéléphone : ${phone || 'Non renseigné'}\nE-mail : ${email}\nPrestation : ${service}\n\n${message}`
      }),
      signal: AbortSignal.timeout(7500)
    });
    if (!delivery.ok) return json(502, { message: 'Le service d’envoi a refusé la demande.' });
    const receipt = await delivery.json();
    if (!receipt.id) return json(502, { message: 'La confirmation d’envoi est indisponible.' });
    return json(200, { message: 'Votre demande a été envoyée.' });
  } catch {
    return json(503, { message: 'La confirmation d’envoi est indisponible.' });
  }
}
