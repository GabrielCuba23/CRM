const storageKey = 'crm.clients.v1';
const form = document.querySelector('#client-form');
const search = document.querySelector('#search');
const list = document.querySelector('#clients');
const status = document.querySelector('#status');
let clients = [];
let storageAvailable = true;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved) || !saved.every(client =>
    client && ['id', 'name', 'email', 'phone'].every(key => typeof client[key] === 'string'))) {
    throw new Error('Invalid stored clients');
  }
  clients = saved;
} catch {
  storageAvailable = false;
}

function save(next) {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    clients = next;
    return true;
  } catch {
    status.textContent = 'No se pudieron guardar los cambios. Revisa el almacenamiento del navegador.';
    return false;
  }
}

function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const matches = clients.filter(client =>
    [client.name, client.email, client.phone].some(value => value.toLocaleLowerCase().includes(query)));
  list.replaceChildren();
  status.textContent = storageAvailable
    ? `${matches.length} cliente(s)`
    : 'No se pudieron cargar los datos. Revisa el almacenamiento del navegador antes de continuar.';
  form.querySelector('button').disabled = !storageAvailable;
  for (const client of matches) {
    const item = document.createElement('li');
    const details = document.createElement('span');
    details.textContent = `${client.name}\n${client.email}${client.phone ? `\n${client.phone}` : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Eliminar';
    remove.setAttribute('aria-label', `Eliminar a ${client.name}`);
    remove.addEventListener('click', () => {
      if (confirm(`¿Eliminar a ${client.name}?`) && save(clients.filter(entry => entry.id !== client.id))) render();
    });
    item.append(details, remove);
    list.append(item);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(form);
  const name = data.get('name').trim();
  if (!name) {
    status.textContent = 'Introduce un nombre válido.';
    return;
  }
  const client = { id: crypto.randomUUID(), name, email: data.get('email').trim(), phone: data.get('phone').trim() };
  if (save([...clients, client])) {
    form.reset();
    render();
  }
});
search.addEventListener('input', render);
render();
