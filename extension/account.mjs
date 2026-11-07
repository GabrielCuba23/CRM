// Passwords live only in this form and its authenticated request. Nothing is
// copied to extension storage, logs, URLs or a separate options page.
export function openPasswordDialog({ request, onChanged }) {
  const existing = document.getElementById('nexo-password-dialog');
  if (existing) { existing.querySelector('input')?.focus(); return existing; }
  const element = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
  const dialog = element('dialog'); dialog.id = 'nexo-password-dialog';
  dialog.setAttribute('aria-labelledby', 'nexo-password-title');
  const title = element('h2', 'Cambiar contraseña'); title.id = 'nexo-password-title';
  const note = element('p', 'Puedes usar una frase fácil de recordar de al menos 12 caracteres. No necesitas símbolos ni mayúsculas. Al guardarla se cerrarán tus sesiones.');
  const form = element('form'); form.id = 'nexo-password-form';
  function field(label, name, autocomplete, minLength = 1) {
    const wrapper = element('label', label), input = element('input');
    Object.assign(input, { name, type: 'password', autocomplete, minLength, maxLength: 1024, required: true });
    wrapper.append(input); form.append(wrapper); return input;
  }
  const current = field('Contraseña actual', 'current', 'current-password');
  const next = field('Nueva contraseña', 'next', 'new-password', 12);
  const confirm = field('Repite la nueva contraseña', 'confirmation', 'new-password', 12);
  const error = element('p'); error.id = 'nexo-password-status'; error.setAttribute('role', 'status');
  const actions = element('div'); actions.className = 'nexo-password-actions';
  const cancel = element('button', 'Cancelar'); cancel.type = 'button';
  const submit = element('button', 'Guardar contraseña'); submit.type = 'submit';
  cancel.addEventListener('click', () => dialog.close());
  actions.append(cancel, submit); form.append(error, actions); dialog.append(title, note, form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { form.reset(); dialog.remove(); }, { once: true });
  let working = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (working) return;
    error.textContent = '';
    if (next.value !== confirm.value) { error.textContent = 'Las contraseñas nuevas no coinciden.'; confirm.focus(); return; }
    const originBody = JSON.stringify({ current: current.value, next: next.value });
    working = true; submit.disabled = true; cancel.disabled = true;
    try {
      const response = await request('/api/password', { method: 'POST', body: originBody });
      const data = await response.json();
      if (response.status === 401) {
        form.reset(); dialog.close();
        onChanged?.('Tu sesión caducó. Inicia sesión aquí y vuelve a cambiar la contraseña.');
        return;
      }
      if (!response.ok) throw Error(data?.error || 'No se pudo cambiar la contraseña.');
      form.reset(); dialog.close();
      onChanged?.('Contraseña cambiada. Entra con tu correo y la nueva contraseña.');
    } catch (cause) {
      current.value = ''; error.textContent = cause.message || 'No se pudo cambiar la contraseña.';
    } finally { working = false; submit.disabled = false; cancel.disabled = false; }
  });
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  dialog.showModal(); current.focus(); return dialog;
}
