'use strict';

const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API_BASE = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : 'https://decretos-firma-api.dfuentes-e72.workers.dev';
const SESSION_KEY = 'decrees.session';

const RESULT_LABELS = {
  ok: 'Ingreso correcto',
  wrong_pin: 'PIN incorrecto',
  locked: 'Cuenta bloqueada',
  unknown_rut: 'RUT no registrado',
  inactive_account: 'Cuenta inactiva',
  throttled: 'Bloqueado por demasiados intentos desde la IP',
};

const $ = (selector) => document.querySelector(selector);

// ─── helpers ───────────────────────────────────────────────

// Everything coming from the API is rendered through this: RUTs typed into the
// login form and User-Agents are attacker-controlled.
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

function initials(name) {
  return String(name).split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-CL')} · ${d.toLocaleTimeString('es-CL', { hour12: false })}`;
}

const toast = $('#toast');
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('activo');
  setTimeout(() => toast.classList.remove('activo'), 2600);
}

// ─── session ───────────────────────────────────────────────

let session = null; // { token, user: { rut, name, isAdmin, mustChangePin } }

function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage blocked */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

// ─── API ───────────────────────────────────────────────────

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'No se pudo conectar con el servidor.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'session_expired') {
    endSession('Tu sesión expiró. Ingresa nuevamente.');
  }
  return { ok: res.ok, status: res.status, data };
}

// ─── views ─────────────────────────────────────────────────

const views = { login: $('#view-login'), main: $('#view-main'), admin: $('#view-admin') };
const sessionBar = $('#session-bar');
const btnAdmin = $('#btn-admin');
let currentView = 'login';

function showView(name) {
  currentView = name;
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  sessionBar.hidden = name === 'login' || !session;
  if (session) {
    $('#session-name').textContent = session.user.name;
    btnAdmin.hidden = !session.user.isAdmin;
    btnAdmin.textContent = name === 'admin' ? 'Volver a decretos' : 'Administración';
  }
}

function openOverlay(el) { el.classList.add('activo'); }
function closeOverlay(el) { el.classList.remove('activo'); }
function closeAllOverlays() {
  document.querySelectorAll('.overlay').forEach((el) => closeOverlay(el));
  $('#temp-pin-value').textContent = '';
}

function endSession(message) {
  clearSession();
  closeAllOverlays();
  $('#login-error').textContent = message || '';
  showView('login');
}

function enterApp() {
  showView('main');
  if (session.user.mustChangePin) openChangePin({ forced: true });
}

// ─── login / logout ────────────────────────────────────────

const loginRut = $('#login-rut');
const loginPin = $('#login-pin');
const loginError = $('#login-error');
const btnLogin = $('#btn-login');

async function handleLogin() {
  const rut = loginRut.value.trim();
  const pin = loginPin.value.trim();
  loginError.textContent = '';
  if (!rut || !/^\d{4}$/.test(pin)) {
    loginError.textContent = 'Ingresa tu RUT y tu PIN de 4 dígitos.';
    return;
  }
  if (!isValidRut(rut)) {
    loginError.textContent = 'El RUT ingresado no es válido. Revisa el dígito verificador.';
    return;
  }

  btnLogin.disabled = true;
  const { ok, data } = await api('POST', '/api/login', { rut, pin });
  btnLogin.disabled = false;

  if (!ok) {
    loginError.textContent = data.error || 'No se pudo ingresar.';
    loginPin.value = '';
    return;
  }
  session = { token: data.token, user: data.user };
  saveSession();
  loginRut.value = '';
  loginPin.value = '';
  enterApp();
}

async function handleLogout() {
  await api('POST', '/api/logout');
  endSession('');
}

// ─── decrees ───────────────────────────────────────────────

const inputDecree = $('#input-decreto');
const stateEmpty = $('#estado-vacio');
const stateError = $('#estado-error');
const resultBox = $('#resultado');
let currentDecree = null;

async function loadDecree(id) {
  stateError.style.display = 'none';
  resultBox.style.display = 'none';
  stateEmpty.textContent = 'Buscando…';
  stateEmpty.style.display = 'block';

  const { ok, data } = await api('GET', `/api/decrees/${encodeURIComponent(id)}`);
  if (!ok) {
    if (currentView === 'login') return; // session expired, already redirected
    stateEmpty.style.display = 'none';
    stateError.textContent = data.error || 'No se pudo consultar el decreto.';
    stateError.style.display = 'block';
    return;
  }
  currentDecree = data;
  renderDecree(data);
}

function renderDecree(data) {
  stateEmpty.style.display = 'none';
  resultBox.style.display = 'block';
  $('#r-decreto-id').textContent = data.id;

  $('#r-tenedor').innerHTML = data.currentHolder
    ? `<div class="tenedor">
         <div class="avatar">${escapeHtml(initials(data.currentHolder.name))}</div>
         <div class="info">
           <div class="nombre">${escapeHtml(data.currentHolder.name)}</div>
           <div class="rut">${escapeHtml(data.currentHolder.rut)}</div>
         </div>
       </div>`
    : '<div class="tenedor sin-tenedor">Este decreto aún no ha sido firmado por nadie</div>';

  $('#r-historial').innerHTML = data.history.length
    ? `<div class="ledger">${data.history.map((s) => `
        <div class="firma-item">
          <div class="marca">${escapeHtml(initials(s.signerName))}</div>
          <div class="detalle">
            <div class="nombre">${escapeHtml(s.signerName)}</div>
            <div class="meta">${escapeHtml(s.signerRut)} · ${escapeHtml(formatDate(s.signedAt))}</div>
          </div>
        </div>`).join('')}</div>`
    : '<div class="sin-historial">Sin firmas registradas todavía.</div>';
}

// ─── sign modal ────────────────────────────────────────────

const overlaySign = $('#overlay');
const pinBoxes = [...document.querySelectorAll('.pin-box')];
const signError = $('#modal-error');
const btnConfirmSign = $('#btn-confirmar-firma');

function openSignModal() {
  if (!currentDecree) return;
  $('#modal-decreto-id').textContent = `Decreto ${currentDecree.id}`;
  signError.textContent = '';
  pinBoxes.forEach((b) => (b.value = ''));
  openOverlay(overlaySign);
  pinBoxes[0].focus();
}

pinBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 1);
    if (box.value && i < pinBoxes.length - 1) pinBoxes[i + 1].focus();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) pinBoxes[i - 1].focus();
    if (e.key === 'Enter') btnConfirmSign.click();
  });
});

async function confirmSign() {
  const pin = pinBoxes.map((b) => b.value).join('');
  if (pin.length !== 4) {
    signError.textContent = 'Ingresa los 4 dígitos del PIN.';
    return;
  }
  btnConfirmSign.disabled = true;
  signError.textContent = '';

  const { ok, data } = await api(
    'POST',
    `/api/decrees/${encodeURIComponent(currentDecree.id)}/sign`,
    { pin }
  );
  btnConfirmSign.disabled = false;

  if (!ok) {
    if (currentView === 'login') return; // session expired
    if (data.code === 'pin_change_required') {
      closeOverlay(overlaySign);
      openChangePin({ forced: true });
      return;
    }
    signError.textContent = data.error || 'No se pudo firmar el decreto.';
    pinBoxes.forEach((b) => (b.value = ''));
    pinBoxes[0].focus();
    return;
  }
  closeOverlay(overlaySign);
  showToast('Decreto firmado correctamente');
  loadDecree(currentDecree.id);
}

// ─── change PIN modal ──────────────────────────────────────

const overlayChangePin = $('#overlay-cambiar-pin');
const cpCurrent = $('#cp-pin-actual');
const cpNew = $('#cp-pin-nuevo');
const cpConfirm = $('#cp-pin-confirmar');
const cpError = $('#cambiar-pin-error');
const btnCpCancel = $('#btn-cambiar-pin-cancelar');
const btnCpSave = $('#btn-cambiar-pin-guardar');
const btnCpLogout = $('#btn-cambiar-pin-salir');
let changePinForced = false;

function openChangePin({ forced = false } = {}) {
  changePinForced = forced;
  cpError.textContent = '';
  cpCurrent.value = '';
  cpNew.value = '';
  cpConfirm.value = '';
  btnCpCancel.hidden = forced;
  btnCpLogout.hidden = !forced;
  const sub = $('#cambiar-pin-sub');
  sub.textContent = forced
    ? 'Estás usando un PIN temporal. Crea un PIN personal que solo tú conozcas para continuar.'
    : 'Actualiza tu PIN de firma. Nadie más podrá verlo.';
  sub.classList.toggle('aviso', forced);
  openOverlay(overlayChangePin);
  cpCurrent.focus();
}

async function confirmChangePin() {
  const currentPin = cpCurrent.value.trim();
  const newPin = cpNew.value.trim();
  if (!/^\d{4}$/.test(currentPin)) { cpError.textContent = 'Ingresa tu PIN actual (4 dígitos).'; return; }
  if (!/^\d{4}$/.test(newPin)) { cpError.textContent = 'El PIN nuevo debe tener 4 dígitos.'; return; }
  if (newPin !== cpConfirm.value.trim()) { cpError.textContent = 'Los PIN nuevos no coinciden.'; return; }

  btnCpSave.disabled = true;
  cpError.textContent = '';
  const { ok, data } = await api('POST', '/api/change-pin', { currentPin, newPin });
  btnCpSave.disabled = false;

  if (!ok) {
    if (currentView === 'login') return; // session expired
    cpError.textContent = data.error || 'No se pudo cambiar el PIN.';
    return;
  }
  // Changing the PIN ends every session (also this one): log in again.
  changePinForced = false;
  endSession('PIN actualizado. Ingresa con tu nuevo PIN.');
}

// ─── admin ─────────────────────────────────────────────────

const usersBody = $('#users-body');
const accessLogBody = $('#access-log-body');
const adminError = $('#admin-error');

async function openAdmin() {
  adminError.textContent = '';
  showView('admin');
  await Promise.all([loadUsers(), loadAccessLog()]);
}

async function loadUsers() {
  const { ok, data } = await api('GET', '/api/admin/users');
  if (!ok) { adminError.textContent = data.error || 'No se pudo cargar los usuarios.'; return; }
  usersBody.innerHTML = data.users.map((u) => {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    const status = !u.isActive
      ? '<span class="tag bad">Inactivo</span>'
      : locked
        ? '<span class="tag bad">Bloqueado</span>'
        : u.mustChangePin
          ? '<span class="tag">PIN temporal</span>'
          : '<span class="tag good">Activo</span>';
    // An admin cannot reset or deactivate their own account here: a self reset
    // deletes their own session, so the temporary PIN could never be seen.
    // They use "Cambiar mi PIN" instead.
    const isSelf = u.rut === session.user.rut;
    return `<tr>
      <td>${escapeHtml(u.name)}${u.isAdmin ? ' <span class="tag">admin</span>' : ''}</td>
      <td class="mono">${escapeHtml(u.rut)}</td>
      <td>${status}</td>
      <td>
        ${isSelf ? '' : `<button class="btn-small" data-action="toggle" data-rut="${escapeHtml(u.rut)}" data-active="${u.isActive}">${u.isActive ? 'Desactivar' : 'Activar'}</button>`}
        ${isSelf ? '' : `<button class="btn-small" data-action="reset" data-rut="${escapeHtml(u.rut)}" data-name="${escapeHtml(u.name)}">Resetear PIN</button>`}
      </td>
    </tr>`;
  }).join('');
}

async function loadAccessLog() {
  const { ok, data } = await api('GET', '/api/admin/access-log?limit=50');
  if (!ok) return;
  accessLogBody.innerHTML = data.entries.map((e) => `<tr>
    <td>${escapeHtml(formatDate(e.createdAt))}</td>
    <td class="mono">${escapeHtml(e.rutAttempted)}</td>
    <td>${escapeHtml(RESULT_LABELS[e.result] || e.result)}</td>
    <td class="mono">${escapeHtml(e.ip || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="4">Sin accesos registrados.</td></tr>';
}

async function handleCreateUser() {
  const rut = $('#new-user-rut').value.trim();
  const name = $('#new-user-name').value.trim();
  adminError.textContent = '';
  if (!rut || !name) { adminError.textContent = 'Ingresa RUT y nombre.'; return; }
  if (!isValidRut(rut)) { adminError.textContent = 'El RUT ingresado no es válido. Revisa el dígito verificador.'; return; }

  const { ok, data } = await api('POST', '/api/admin/users', { rut, name });
  if (!ok) { adminError.textContent = data.error || 'No se pudo crear el usuario.'; return; }

  $('#new-user-rut').value = '';
  $('#new-user-name').value = '';
  showTempPin(data.name, data.tempPin);
  loadUsers();
}

usersBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, rut } = button.dataset;
  adminError.textContent = '';

  if (action === 'toggle') {
    const makeActive = button.dataset.active !== 'true';
    if (!makeActive && !confirm(`¿Desactivar a ${rut}? No podrá ingresar.`)) return;
    const { ok, data } = await api('PATCH', `/api/admin/users/${encodeURIComponent(rut)}`, { isActive: makeActive });
    if (!ok) { adminError.textContent = data.error || 'No se pudo actualizar.'; return; }
    loadUsers();
  }

  if (action === 'reset') {
    if (!confirm(`¿Resetear el PIN de ${button.dataset.name}? Se cerrará su sesión.`)) return;
    const { ok, data } = await api('PATCH', `/api/admin/users/${encodeURIComponent(rut)}`, { resetPin: true });
    if (!ok) { adminError.textContent = data.error || 'No se pudo resetear el PIN.'; return; }
    showTempPin(button.dataset.name, data.tempPin);
    loadUsers();
  }
});

// ─── temporary PIN modal ───────────────────────────────────

const overlayTempPin = $('#overlay-temp-pin');
const tempPinValue = $('#temp-pin-value');

function showTempPin(name, tempPin) {
  $('#temp-pin-sub').textContent = `Entrégaselo a ${name}.`;
  tempPinValue.textContent = tempPin;
  openOverlay(overlayTempPin);
}

function closeTempPin() {
  tempPinValue.textContent = ''; // do not leave the PIN in the DOM
  closeOverlay(overlayTempPin);
}

async function copyTempPin() {
  const pin = tempPinValue.textContent;
  try {
    await navigator.clipboard.writeText(pin);
    showToast('PIN copiado');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(tempPinValue);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    showToast('Selecciona el PIN y copia con Ctrl+C');
  }
}

// ─── wiring ────────────────────────────────────────────────

// RUT fields: format while typing (19.572.933-6) and flag an invalid RUT on blur.
function wireRutField(input, errorEl) {
  input.addEventListener('input', () => {
    input.value = formatRut(input.value);
    if (errorEl.textContent.startsWith('El RUT')) errorEl.textContent = '';
  });
  input.addEventListener('blur', () => {
    if (input.value && !isValidRut(input.value)) {
      errorEl.textContent = 'El RUT ingresado no es válido. Revisa el dígito verificador.';
    }
  });
}
wireRutField(loginRut, loginError);
wireRutField($('#new-user-rut'), adminError);

btnLogin.addEventListener('click', handleLogin);
loginPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
loginRut.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPin.focus(); });
$('#btn-logout').addEventListener('click', handleLogout);

$('#btn-buscar').addEventListener('click', () => {
  const id = inputDecree.value.trim();
  if (id) loadDecree(id);
});
inputDecree.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-buscar').click(); });

$('#btn-firmar').addEventListener('click', openSignModal);
$('#btn-cancelar').addEventListener('click', () => closeOverlay(overlaySign));
btnConfirmSign.addEventListener('click', confirmSign);
overlaySign.addEventListener('click', (e) => { if (e.target === overlaySign) closeOverlay(overlaySign); });

$('#btn-open-change-pin').addEventListener('click', () => openChangePin());
btnCpCancel.addEventListener('click', () => closeOverlay(overlayChangePin));
btnCpSave.addEventListener('click', confirmChangePin);
btnCpLogout.addEventListener('click', handleLogout);
overlayChangePin.addEventListener('click', (e) => {
  if (e.target === overlayChangePin && !changePinForced) closeOverlay(overlayChangePin);
});

btnAdmin.addEventListener('click', () => (currentView === 'admin' ? showView('main') : openAdmin()));
$('#btn-create-user').addEventListener('click', handleCreateUser);
$('#btn-temp-pin-copy').addEventListener('click', copyTempPin);
$('#btn-temp-pin-close').addEventListener('click', closeTempPin);

async function boot() {
  const stored = loadSession();
  if (!stored || !stored.token) { showView('login'); return; }
  session = stored;
  const { ok, data } = await api('GET', '/api/me');
  if (!ok) { clearSession(); showView('login'); return; }
  session.user = data;
  saveSession();
  enterApp();
}

boot();
