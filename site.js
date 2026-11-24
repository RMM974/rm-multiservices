const menu = document.getElementById('menuBtn');
const navigation = document.getElementById('navLinks');
const mobile = matchMedia('(max-width: 720px)');

function closeMenu(restoreFocus = false) {
  menu.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menu.focus();
}

menu.hidden = false;
menu.addEventListener('click', () => {
  menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') === 'false'));
});
navigation.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || !mobile.matches) return;
  const target = document.querySelector(link.hash);
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  closeMenu();
});
document.querySelector('header').addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') closeMenu(true);
});
mobile.addEventListener('change', () => closeMenu(mobile.matches && navigation.contains(document.activeElement)));

const form = document.getElementById('quoteForm');
const status = document.getElementById('quoteStatus');
const submit = form.querySelector('button[type="submit"]');
const contactLinks = [...status.querySelectorAll('a')];

function say(message, includeContacts = false) {
  status.textContent = message;
  if (includeContacts) status.append(' Contactez-nous par ', contactLinks[0], ' ou par ', contactLinks[1], '.');
}

async function enableForm() {
  const response = await fetch(form.action, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) return;
  const { siteKey } = await response.json();
  if (!siteKey) return;

  let widget;
  let token;
  let sending = false;
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.addEventListener('load', () => {
    if (!window.turnstile) return;
    window.turnstile.ready(() => {
      widget = window.turnstile.render('#quoteChallenge', {
        sitekey: siteKey,
        action: 'devis',
        language: 'fr',
        size: 'compact',
        callback(value) {
          token = value;
          submit.disabled = sending;
        },
        'expired-callback'() {
          token = undefined;
          submit.disabled = true;
        },
        'error-callback'() {
          token = undefined;
          submit.disabled = true;
          say('La vérification du formulaire est indisponible.', true);
        }
      });
      form.hidden = false;
      say('Décrivez votre projet pour recevoir une réponse par e-mail.');
    });
  });

  submit.disabled = true;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !token) return;
    sending = true;
    submit.disabled = true;
    say('Envoi en cours…');
    const fields = new URLSearchParams(new FormData(form));
    fields.set('cf-turnstile-response', token);
    try {
      const result = await fetch(form.action, {
        method: 'POST',
        body: fields,
        signal: AbortSignal.timeout(22000)
      });
      const { message } = await result.json();
      if (!result.ok) {
        say(message, true);
        return;
      }
      form.reset();
      say(message);
    } catch {
      say('La confirmation d’envoi est indisponible.', true);
    } finally {
      sending = false;
      token = undefined;
      window.turnstile.reset(widget);
    }
  });

  document.head.append(script);
}

enableForm().catch(() => {
  // The direct contact links are already visible.
});
