/**
 * LÓGICA FRONTEND — SAT BAZA MAZANO 2.0 (2026 / 2027)
 * LAIBE STUDIO AI — VALLADOLID
 */

const state = {
  role: 'mando', // 'mando' | 'tecnico' | 'admin'
  mandoTab: 'triaje', // 'triaje' | 'mapa' | 'semana' | 'perdidos' | 'catalogos'
  mobileTab: 'citas', // 'citas' | 'semana' | 'radar' | 'pins'
  adminTab: 'aliquo', // 'aliquo' | 'contratos' | 'flota'
  activeTariffYear: '2026',
  authToken: localStorage.getItem('sat_baza_auth_token') || '',
  authUser: null,
  bootstrap: null,
  avisos: [],
  selectedAviso: null,
  citas: [],
  allCitas: [],
  calViewDate: new Date(),
  calCrewFilter: 'TODOS',
  mobileCrewPartners: new Set(),
  activeFichaje: null,
  closingRepuestos: [],
  lastTariffBreakdown: null,
  compressedPhotoDataUrl: '',
  mapInstance: null,
  mapMarkers: []
};

const ESTADOS_AVISO_14 = [
  'SIN PROCESAR',
  'REALIZABLE',
  'AGENDADO',
  'PENDIENTE',
  'PENDIENTE PEDIR MATERIAL/REPUESTO',
  'PENDIENTE LLEGAR MATERIAL/REPUESTO',
  'PENDIENTE PRESUPUESTO JACOBO',
  'SEGUIMIENTO',
  'APLAZADO HASTA QUE LLAME EL CLIENTE',
  'FINALIZADO, PASAR ALIQUO',
  'PASADO ALIQUO',
  'PASADO ALIQUO Y PENDIENTE REVISAR JACOBO',
  'FINALIZADO. SIN ALIQUO.',
  'CANCELADO'
];

// =========================================================================
// AUTENTICACIÓN POR PIN (FASE 1) Y HELPER apiFetch
// =========================================================================
function withAuthToken(url) {
  if (!state.authToken) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(state.authToken)}`;
}

async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (state.authToken) {
    headers['Authorization'] = `Bearer ${state.authToken}`;
  }
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (res.status === 401) {
    state.authToken = '';
    state.authUser = null;
    localStorage.removeItem('sat_baza_auth_token');
    showPinAuthOverlay('Sesión caducada o PIN requerido. Introduce tu PIN personal.');
  }
  return res;
}

function showPinAuthOverlay(msg = '') {
  const ov = document.getElementById('pinAuthOverlay');
  if (ov) ov.style.display = 'flex';
  const errEl = document.getElementById('pinAuthError');
  if (errEl) {
    errEl.textContent = msg || '';
    errEl.style.display = msg ? 'block' : 'none';
  }
  const input = document.getElementById('pinAuthInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 80);
  }
}

function hidePinAuthOverlay() {
  const ov = document.getElementById('pinAuthOverlay');
  if (ov) ov.style.display = 'none';
  const errEl = document.getElementById('pinAuthError');
  if (errEl) errEl.style.display = 'none';
}

function applyAuthUserUi() {
  const user = state.authUser;
  const badge = document.getElementById('currentUserBadge');
  const btnSwitch = document.getElementById('btnSwitchUserPin');
  const btnMando = document.getElementById('btnRoleMando');
  const btnTec = document.getElementById('btnRoleTecnico');
  const btnAdmin = document.getElementById('btnRoleAdmin');
  const btnNuevoAviso = document.getElementById('btnNuevoAvisoExpress');
  const techSelect = document.getElementById('mobileTechSelect');

  if (!user) {
    if (badge) badge.style.display = 'none';
    if (btnSwitch) btnSwitch.style.display = 'none';
    if (btnNuevoAviso) btnNuevoAviso.style.display = 'none';
    return;
  }

  if (badge) {
    badge.textContent = `👤 ${user.nombre}`;
    badge.style.display = 'inline-flex';
  }
  if (btnSwitch) btnSwitch.style.display = 'inline-flex';
  if (btnNuevoAviso) btnNuevoAviso.style.display = user.canCreateAviso ? '' : 'none';

  const roles = Array.isArray(user.roles) ? user.roles : ['mando'];
  if (btnMando) btnMando.style.display = roles.includes('mando') ? '' : 'none';
  if (btnTec) btnTec.style.display = roles.includes('tecnico') ? '' : 'none';
  if (btnAdmin) btnAdmin.style.display = (user.canSeeAdmin && roles.includes('admin')) ? '' : 'none';
  const tabRent = document.getElementById('adminTabRentabilidad');
  if (tabRent) tabRent.style.display = user.canSeeCostes ? '' : 'none';

  if (techSelect) {
    if (user.lockedTechEmail) {
      techSelect.value = user.lockedTechEmail;
      techSelect.disabled = true;
      techSelect.title = 'Bloqueado a tu usuario por seguridad de fichajes';
    } else {
      techSelect.disabled = false;
      techSelect.title = '';
    }
  }

  const targetRole = roles.includes(state.role) && (state.role !== 'admin' || user.canSeeAdmin)
    ? state.role
    : (user.defaultRole || roles[0] || 'mando');
  switchRole(targetRole);
}

async function initAuthenticatedApp() {
  await loadBootstrap();
  await loadAvisosList();
  await loadCitasList();
  loadBuzonAlertas();
  startDespertadorPolling();
  initKeywordAlertListeners();
}

async function checkAuthSession() {
  if (!state.authToken) {
    try {
      const probe = await fetch('/api/auth/me');
      if (probe.status === 404) {
        // Modo integrado en Portal Baza Hub (sin PIN obligatorio)
        hidePinAuthOverlay();
        return true;
      }
    } catch (e) {}
    showPinAuthOverlay('');
    return false;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${state.authToken}` }
    });
    if (res.status === 404) {
      hidePinAuthOverlay();
      return true;
    }
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      state.authUser = data.user;
      hidePinAuthOverlay();
      applyAuthUserUi();
      return true;
    }
  } catch (e) {}
  state.authToken = '';
  localStorage.removeItem('sat_baza_auth_token');
  showPinAuthOverlay('');
  return false;
}

async function submitPinLogin(e) {
  e.preventDefault();
  const input = document.getElementById('pinAuthInput');
  const errEl = document.getElementById('pinAuthError');
  const btn = document.getElementById('btnPinSubmit');
  const pin = String(input ? input.value : '').trim();

  if (!pin) return;
  if (btn) btn.disabled = true;
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (errEl) {
        errEl.textContent = data.error || 'PIN incorrecto';
        errEl.style.display = 'block';
      }
      if (input) {
        input.value = '';
        input.focus();
      }
      return;
    }

    state.authToken = data.token;
    state.authUser = data.user;
    localStorage.setItem('sat_baza_auth_token', data.token);
    hidePinAuthOverlay();
    applyAuthUserUi();
    await initAuthenticatedApp();
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Error de conexión con el servidor SAT.';
      errEl.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function logoutPin() {
  state.authToken = '';
  state.authUser = null;
  localStorage.removeItem('sat_baza_auth_token');
  applyAuthUserUi();
  showPinAuthOverlay('Introduce el PIN del nuevo usuario.');
}

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSignaturePad();
  updateDespertadorSoundUi();

  const portalLink = document.getElementById('btnPortalBazaLink');
  if (portalLink && location.pathname.startsWith('/sat')) {
    portalLink.style.display = 'inline-flex';
  }

  if ('serviceWorker' in navigator) {
    const swUrl = location.pathname.startsWith('/sat') ? '/sat/sw.js' : '/sw.js';
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }

  const authenticated = await checkAuthSession();
  if (authenticated) {
    await initAuthenticatedApp();
  }
});

async function loadBootstrap() {
  try {
    const res = await apiFetch('/api/bootstrap');
    const data = await res.json();
    if (!data.ok) return;
    state.bootstrap = data;

    // Actualizar subtítulo superior con cifras reales de BD y catálogo Aliquo
    const hdrStats = document.getElementById('headerStatsText');
    if (hdrStats && data.kpis) {
      const k = data.kpis;
      const aliqCount = Number(data.aliquoCacheCount || 0).toLocaleString('es-ES');
      hdrStats.textContent = `C/ Annapurna 22, Valladolid · ${Number(k.totalAvisos || 0).toLocaleString('es-ES')} Avisos · ${k.contratosCmTotal || 0} Contratos CM · ${aliqCount} Clientes Aliquo · Tarifas 2026 & 2027`;
    }

    // Poblar datalist de marcas y selector de repuestos
    const dl = document.getElementById('marcasDatalist');
    if (dl && Array.isArray(data.marcas)) {
      dl.innerHTML = data.marcas.map(m => `<option value="${escapeHtml(m.marca)}">${escapeHtml(m.proveedor || '')}</option>`).join('');
    }
    const repPicker = document.getElementById('selectRepuestoPicker');
    if (repPicker && Array.isArray(data.repuestos)) {
      repPicker.innerHTML = `<option value="">-- Seleccionar Repuesto Oficial (${data.repuestos.length} en tarifa/Aliquo) --</option>` +
        data.repuestos.map((r, idx) => `<option value="${idx}">[${escapeHtml(r.codigo)}] ${escapeHtml(r.descripcion)} — ${Number(r.pvp).toFixed(2)} €</option>`).join('');
    }

    // Detectar si el técnico seleccionado tiene un fichaje abierto
    syncActiveFichajeForCurrentTech();
    renderMandoKpis();
    renderAdminKpis();
  } catch (e) {
    console.error('Error cargando bootstrap:', e);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badgeForEstado(estado) {
  const st = String(estado || '').toUpperCase();
  if (st === 'SIN PROCESAR') return `<span class="badge badge-red">🔴 SIN PROCESAR</span>`;
  if (st === 'REALIZABLE') return `<span class="badge badge-green">🟢 REALIZABLE</span>`;
  if (st === 'AGENDADO' || st === 'ASIGNADO') return `<span class="badge badge-blue">📅 ${escapeHtml(st)}</span>`;
  if (st.includes('JACOBO') || st.includes('DISCONFORME')) return `<span class="badge badge-red" style="font-weight:800;background:#ef4444;color:#fff;">🚨 REVISAR JACOBO / DISCONFORME</span>`;
  if (st === 'FINALIZADO, PASAR ALIQUO') return `<span class="badge badge-purple">🟣 PASAR ALIQUO</span>`;
  if (st === 'PASADO ALIQUO') return `<span class="badge badge-green">✅ PASADO ALIQUO</span>`;
  if (st.includes('MATERIAL') || st.includes('PRESUP')) return `<span class="badge badge-amber">📦 ${escapeHtml(st)}</span>`;
  return `<span class="badge badge-orange">${escapeHtml(st)}</span>`;
}

function badgeForPrioridad(prio) {
  const p = String(prio || 'MEDIA').toUpperCase();
  if (p === 'ALTA') return `<span class="badge badge-red" title="Prioridad de avería: ALTA (urgente sin calefacción)">🔴 Urgencia: ALTA</span>`;
  if (p === 'BAJA') return `<span class="badge badge-blue" title="Prioridad de avería: BAJA (mantenimiento o revisión ordinaria)">🔵 Urgencia: BAJA</span>`;
  return `<span class="badge badge-amber" title="Prioridad de avería: MEDIA">🟡 Urgencia: MEDIA</span>`;
}

function findBrandInfo(marcaStr) {
  if (!state.bootstrap || !Array.isArray(state.bootstrap.marcas) || !marcaStr) return null;
  const upper = String(marcaStr).toUpperCase().trim();
  return state.bootstrap.marcas.find(m =>
    m.marca.toUpperCase() === upper ||
    upper.includes(m.marca.toUpperCase()) ||
    m.marca.toUpperCase().includes(upper)
  ) || null;
}

// =========================================================================
// CAMBIO DE ROL (1. MANDO SAT | 2. APP MÓVIL TÉCNICOS | 3. ADMINISTRACIÓN)
// =========================================================================
function switchRole(role) {
  if (state.authUser) {
    const allowed = Array.isArray(state.authUser.roles) ? state.authUser.roles : ['mando'];
    if (!allowed.includes(role) || (role === 'admin' && !state.authUser.canSeeAdmin)) {
      alert('Acceso no autorizado para tu usuario PIN.');
      role = state.authUser.defaultRole || allowed[0] || 'mando';
    }
  }
  state.role = role;
  document.getElementById('btnRoleMando').classList.toggle('active', role === 'mando');
  document.getElementById('btnRoleTecnico').classList.toggle('active', role === 'tecnico');
  document.getElementById('btnRoleAdmin').classList.toggle('active', role === 'admin');

  document.getElementById('viewRoleMando').style.display = role === 'mando' ? 'block' : 'none';
  document.getElementById('viewRoleTecnico').style.display = role === 'tecnico' ? 'block' : 'none';
  document.getElementById('viewRoleAdmin').style.display = role === 'admin' ? 'block' : 'none';

  if (role === 'tecnico') {
    refreshMobileView();
  } else if (role === 'admin') {
    renderAdminView();
  } else if (role === 'mando' && state.mandoTab === 'mapa') {
    setTimeout(() => refreshDispatchMap(), 120);
  }
}

function changeActiveTariffYear(year) {
  state.activeTariffYear = year;
  const lbl = document.getElementById('tariffSeasonLabel');
  if (lbl) lbl.textContent = `Tarifa ${year}`;
  if (state.mandoTab === 'catalogos') renderCatalogosMando();
  recalcClosingTariff();
}

// =========================================================================
// ROL 1: CONSOLA DE MANDO SAT (JACOBO Y LEANDRO)
// =========================================================================
function renderMandoKpis() {
  const el = document.getElementById('mandoKpiStrip');
  if (!el || !state.bootstrap) return;
  const k = state.bootstrap.kpis;
  el.innerHTML = `
    <div class="kpi-card" onclick="quickFilterEstado('SIN PROCESAR')">
      <div class="label"><span>🔴 Sin Procesar</span><span>Triaje</span></div>
      <div class="val" style="color:#f87171;">${k.sinProcesar}</div>
    </div>
    <div class="kpi-card" onclick="quickFilterEstado('REALIZABLE')">
      <div class="label"><span>🟢 Realizables</span><span>Para Cita</span></div>
      <div class="val" style="color:#34d399;">${k.realizables}</div>
    </div>
    <div class="kpi-card" onclick="quickFilterEstado('AGENDADO')">
      <div class="label"><span>📅 Agendados</span><span>En Ruta</span></div>
      <div class="val" style="color:#60a5fa;">${k.agendados}</div>
    </div>
    <div class="kpi-card" onclick="quickFilterEstado('MATERIALES')">
      <div class="label"><span>📦 Materiales</span><span>Repuestos</span></div>
      <div class="val" style="color:#fbbf24;">${k.esperandoMaterial}</div>
    </div>
    <div class="kpi-card" onclick="switchMandoTab('perdidos')">
      <div class="label"><span>🚨 Avisos Perdidos</span><span>Sin Fichaje</span></div>
      <div class="val" style="color:#ef4444;">${k.avisosPerdidosCount}</div>
    </div>
    <div class="kpi-card" onclick="quickFilterEstado('FINALIZADO, PASAR ALIQUO')">
      <div class="label"><span>🟣 Pasar a Aliquo</span><span>Facturación</span></div>
      <div class="val" style="color:#c084fc;">${k.pasarAliquo}</div>
    </div>
  `;
}

function quickFilterEstado(estado) {
  switchMandoTab('triaje');
  const sel = document.getElementById('filterEstadoAviso');
  if (sel) {
    sel.value = estado;
    loadAvisosList();
  }
}

function switchMandoTab(tab) {
  state.mandoTab = tab;
  document.getElementById('mandoTabTriaje')?.classList.toggle('active', tab === 'triaje');
  document.getElementById('mandoTabMapaCalendario')?.classList.toggle('active', tab === 'mapa');
  document.getElementById('mandoTabCalendarioSemanal')?.classList.toggle('active', tab === 'semana');
  document.getElementById('mandoTabPerdidos')?.classList.toggle('active', tab === 'perdidos');
  document.getElementById('mandoTabCatalogos')?.classList.toggle('active', tab === 'catalogos');

  const secTriaje = document.getElementById('mandoSectionTriaje');
  const secMapa = document.getElementById('mandoSectionMapa');
  const secCal = document.getElementById('mandoSectionCalendario');
  const secPerdidos = document.getElementById('mandoSectionPerdidos');
  const secCat = document.getElementById('mandoSectionCatalogos');

  if (secTriaje) secTriaje.style.display = tab === 'triaje' ? 'grid' : 'none';
  if (secMapa) secMapa.style.display = tab === 'mapa' ? 'block' : 'none';
  if (secCal) secCal.style.display = tab === 'semana' ? 'block' : 'none';
  if (secPerdidos) secPerdidos.style.display = tab === 'perdidos' ? 'block' : 'none';
  if (secCat) secCat.style.display = tab === 'catalogos' ? 'block' : 'none';

  if (tab === 'mapa') {
    setTimeout(() => refreshDispatchMap(), 100);
    renderCitasCalendarList();
  } else if (tab === 'semana') {
    renderWeeklyCalendar('mandoSectionCalendario', false);
  } else if (tab === 'perdidos') {
    loadAvisosPerdidosTable();
  } else if (tab === 'catalogos') {
    renderCatalogosMando();
  }
}

let searchTimer = null;
function debounceLoadAvisos() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadAvisosList(), 220);
}

function formatDateES(str) {
  if (!str) return '-';
  const s = String(str).trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s;
  const parsed = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (!isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    return (s.length <= 10 && !s.includes(':')) ? `${d}/${m}/${y}` : `${d}/${m}/${y} ${hh}:${mm}`;
  }
  return s;
}

async function loadAvisosList() {
  const estado = document.getElementById('filterEstadoAviso').value;
  const operario = document.getElementById('filterOperarioAviso').value;
  const tipoServicioEl = document.getElementById('filterTipoServicioAviso');
  const prioridadEl = document.getElementById('filterPrioridadAviso');
  const sortEl = document.getElementById('sortAvisosOrder');
  const tipoServicio = tipoServicioEl ? tipoServicioEl.value : 'TODOS';
  const prioridad = prioridadEl ? prioridadEl.value : 'TODAS';
  const sort = sortEl ? sortEl.value : 'newest';
  const q = document.getElementById('searchAvisosInput').value;

  const params = new URLSearchParams({ estado, operario, tipoServicio, prioridad, sort, q, limit: '150' });
  const res = await apiFetch(`/api/avisos?${params}`);
  const data = await res.json();
  if (!data.ok) return;

  state.avisos = data.avisos || [];
  document.getElementById('listCountBadge').textContent = `${data.total} avisos`;
  document.getElementById('listPanelTitle').textContent = `📋 Cola: ${estado}`;

  const container = document.getElementById('avisosListContainer');
  if (state.avisos.length === 0) {
    container.innerHTML = `<div style="padding:36px;text-align:center;color:var(--text-muted);font-size:13px;">No hay avisos con este filtro.</div>`;
    return;
  }

  container.innerHTML = state.avisos.map(a => {
    const isSel = state.selectedAviso && state.selectedAviso.idAviso === a.idAviso;
    const isFuego = Boolean(a.esFuego) || Number(a.llamadasTienda || 0) > 0;
    const prioUpper = String(a.prioridad || 'MEDIA').toUpperCase();
    const prioClass = isFuego ? 'prio-fuego' : (prioUpper === 'ALTA' ? 'prio-alta' : (prioUpper === 'BAJA' ? 'prio-baja' : 'prio-media'));
    return `
      <div class="aviso-item ${prioClass} ${isSel ? 'selected' : ''}" onclick="selectAviso('${a.idAviso}')">
        <div class="aviso-item-top">
          <span class="aviso-num">#${a.numero} · ${escapeHtml(a.poblacion || 'VALLADOLID')} (${a.kmIdaVuelta || 14} km I/V)</span>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            ${isFuego ? `<span class="badge badge-red" style="background:#dc2626;color:#fff;">🔥 FUEGO${a.llamadasTienda > 1 ? ' (' + a.llamadasTienda + ')' : ''}</span>` : ''}
            ${badgeForPrioridad(a.prioridad)}
          </div>
        </div>
        <div class="aviso-client">
          ${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}
          ${a.tipoServicio === 'MONTAJE_GOTERA' ? `<span class="badge badge-amber" style="margin-left:4px;">🏗️ MONTAJE/GOTERA</span>` : ''}
          ${a.codigoCliente && a.codigoCliente !== 'NO ES CLIENTE' ? `<span class="badge badge-blue" style="margin-left:4px;">${escapeHtml(a.codigoCliente)}</span>` : ''}
          ${a.contratoMant ? `<span class="badge badge-green" style="margin-left:4px;">🛡️ CM</span>` : ''}
        </div>
        <div class="aviso-meta">
          <span>🔥 ${escapeHtml(a.tipoAparato)} · <strong>${escapeHtml(a.marca || 'S/M')}</strong> ${escapeHtml(a.modelo || '')}</span>
          <span>👷 ${escapeHtml(a.operarioPreasignado || 'JACOBO')}</span>
        </div>
        ${(a.precioComunicado !== null && a.precioComunicado !== undefined) || Number(a.importeAbonadoPrevio || 0) > 0 ? `
          <div style="margin-top:4px;font-size:10.5px;color:#34d399;font-weight:700;">
            💶 ${a.precioComunicado !== null && a.precioComunicado !== undefined ? `Acordado: ${Number(a.precioComunicado).toFixed(2)}€` : ''}${Number(a.importeAbonadoPrevio || 0) > 0 ? ` · Abonado: ${Number(a.importeAbonadoPrevio).toFixed(2)}€ (${escapeHtml(a.metodoPagoPrevio || 'Previo')})` : ''}
          </div>
        ` : ''}
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          ${badgeForEstado(a.estadoAviso)}
          <span class="intervencion-hero-badge">🔧 ${escapeHtml(a.tipoIntervencion || 'SAT NORMAL')}</span>
        </div>
        <div style="margin-top:4px;font-size:10.5px;color:var(--text-muted);display:flex;justify-content:space-between;">
          <span>📅 Entrada: ${escapeHtml(formatDateES(a.fecha))}</span>
          <span>Anotó: ${escapeHtml(a.anota || 'OFICINA')}</span>
        </div>
      </div>
    `;
  }).join('');

  if (!state.selectedAviso || !state.avisos.some(x => x.idAviso === state.selectedAviso.idAviso)) {
    selectAviso(state.avisos[0].idAviso);
  } else {
    selectAviso(state.selectedAviso.idAviso);
  }
}

async function selectAviso(idAviso) {
  const av = state.avisos.find(a => a.idAviso === idAviso);
  if (!av) return;
  state.selectedAviso = av;

  // Marcar visualmente en la lista
  document.querySelectorAll('.aviso-item').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('onclick') === `selectAviso('${idAviso}')`);
  });

  const brandInfo = findBrandInfo(av.marca);
  const panel = document.getElementById('avisoDetailPanel');

  const tratoColor = av.tratoCliente === 'MALO' ? 'badge-red' : (av.tratoCliente === 'REGULAR' ? 'badge-amber' : 'badge-green');
  const isFuego = Boolean(av.esFuego) || Number(av.llamadasTienda || 0) > 0;

  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>
          Aviso #${av.numero} — ${escapeHtml(av.nombreCliente)} ${escapeHtml(av.apellidosCliente)}
          <span class="intervencion-hero-badge" style="font-size:12px;">🔧 ${escapeHtml(av.tipoIntervencion || 'SAT NORMAL')}</span>
          ${isFuego ? `<span class="badge badge-red" style="background:#dc2626;color:#fff;">🔥 FUEGO (${av.llamadasTienda || 1} llamadas)</span>` : ''}
          ${av.codigoCliente ? `<span class="badge badge-blue">${escapeHtml(av.codigoCliente)}</span>` : ''}
          ${av.contratoMant ? `<span class="badge badge-green">🛡️ CONTRATO MANT. ACTIVO</span>` : ''}
          <span class="badge ${tratoColor}">Trato: ${escapeHtml(av.tratoCliente || 'BUENO')}</span>
        </h2>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">
          📍 ${escapeHtml(av.direccionCompleta)} · <strong>${av.kmIdaVuelta || 14} km I/V desde C/ Annapurna 22</strong> · 📅 Entrada: <strong>${escapeHtml(formatDateES(av.fecha))}</strong> · Anotó: <strong>${escapeHtml(av.anota || 'OFICINA')}</strong>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ${isFuego ? 'btn-primary' : 'btn-ghost'}" style="${isFuego ? 'background:#dc2626;border-color:#b91c1c;' : ''}" onclick="quickUpdateAviso('${av.idAviso}', { esFuego: true, llamadasTienda: ${Number(av.llamadasTienda || 0) + 1} })" title="Marcar o sumar llamada insistente del cliente">
          🔥 Rellamó (+1)
        </button>
        <button class="btn btn-ghost" onclick="openCrearDespertadorModal('${av.idAviso}')" title="Programar despertador/alarma para este aviso">
          ⏰ Despertador
        </button>
        <button class="btn btn-primary" onclick="openAgendarCitaModal('${av.idAviso}')">
          📅 Agendar Cita / Pareja
        </button>
        <button class="btn btn-green" onclick="openCerrarFichajeModal(null, '${av.idAviso}')">
          🛠️ Registrar / Cerrar Parte
        </button>
        <a class="btn btn-ghost" href="${withAuthToken(`/api/parte-pdf/${av.idAviso}`)}" target="_blank" style="text-decoration:none;">
          🖨️ Parte PDF
        </a>
      </div>
    </div>

    <div class="panel-body">
      <!-- BARRA DE EDICIÓN RÁPIDA EN 1 CLIC (QUICK EDIT IGUAL QUE APPSHEET PERO INSTANTÁNEO) -->
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#fb923c;text-transform:uppercase;margin-bottom:8px;">
          ⚡ Triaje Rápido en 1 Clic (Se guarda al instante sin recargar)
        </div>
        <div class="form-grid triaje-grid-4" style="grid-template-columns: repeat(4, 1fr);">
          <div class="field">
            <label>Estado del Aviso (14 Estados)</label>
            <select onchange="quickUpdateAviso('${av.idAviso}', { estadoAviso: this.value })">
              ${ESTADOS_AVISO_14.map(st => `<option value="${st}" ${av.estadoAviso === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Prioridad</label>
            <select onchange="quickUpdateAviso('${av.idAviso}', { prioridad: this.value })">
              <option value="ALTA" ${av.prioridad === 'ALTA' ? 'selected' : ''}>🔴 ALTA</option>
              <option value="MEDIA" ${av.prioridad === 'MEDIA' ? 'selected' : ''}>🟡 MEDIA</option>
              <option value="BAJA" ${av.prioridad === 'BAJA' ? 'selected' : ''}>🔵 BAJA</option>
            </select>
          </div>
          <div class="field">
            <label>Operario Preasignado</label>
            <select onchange="quickUpdateAviso('${av.idAviso}', { operarioPreasignado: this.value })">
              <option value="JACOBO" ${av.operarioPreasignado === 'JACOBO' ? 'selected' : ''}>🔵 JACOBO</option>
              <option value="ALEX" ${av.operarioPreasignado === 'ALEX' ? 'selected' : ''}>🟢 ALEX</option>
              <option value="DIONI" ${av.operarioPreasignado === 'DIONI' ? 'selected' : ''}>🟠 DIONI</option>
              <option value="ROBERTO" ${av.operarioPreasignado === 'ROBERTO' ? 'selected' : ''}>🟣 ROBERTO</option>
              <option value="ISMA" ${av.operarioPreasignado === 'ISMA' ? 'selected' : ''}>🟡 ISMA</option>
              <option value="DANY" ${av.operarioPreasignado === 'DANY' ? 'selected' : ''}>🏗️ DANY (Montaje/Gotera)</option>
              <option value="JUAN" ${av.operarioPreasignado === 'JUAN' ? 'selected' : ''}>🏗️ JUAN (Montaje/Gotera)</option>
            </select>
          </div>
          <div class="field">
            <label>Semáforo Trato Cliente</label>
            <select onchange="quickUpdateAviso('${av.idAviso}', { tratoCliente: this.value })">
              <option value="BUENO" ${av.tratoCliente === 'BUENO' ? 'selected' : ''}>🟢 BUENO</option>
              <option value="REGULAR" ${av.tratoCliente === 'REGULAR' ? 'selected' : ''}>🟡 REGULAR</option>
              <option value="MALO" ${av.tratoCliente === 'MALO' ? 'selected' : ''}>🔴 MALO (Ir en pareja)</option>
            </select>
          </div>
        </div>
        <div class="form-grid" style="grid-template-columns: repeat(5, 1fr); gap:8px; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border);">
          <div class="field">
            <label>Circuito</label>
            <select onchange="quickUpdateAviso('${av.idAviso}', { tipoServicio: this.value })">
              <option value="SAT" ${av.tipoServicio !== 'MONTAJE_GOTERA' ? 'selected' : ''}>🔧 SAT</option>
              <option value="MONTAJE_GOTERA" ${av.tipoServicio === 'MONTAJE_GOTERA' ? 'selected' : ''}>🏗️ Montaje/Gotera</option>
            </select>
          </div>
          <div class="field">
            <label>Precio Acordado (€)</label>
            <input type="number" step="0.01" id="editPrecioComunicado_${av.idAviso}" value="${av.precioComunicado !== null && av.precioComunicado !== undefined ? Number(av.precioComunicado) : ''}" placeholder="0.00" />
          </div>
          <div class="field">
            <label>Estado Cobro Previo</label>
            <select id="editEstadoCobroPrevio_${av.idAviso}">
              <option value="PENDIENTE" ${(av.estadoCobroPrevio || 'PENDIENTE') === 'PENDIENTE' ? 'selected' : ''}>⏳ Pendiente</option>
              <option value="SENAL_PARCIAL" ${av.estadoCobroPrevio === 'SENAL_PARCIAL' ? 'selected' : ''}>🟡 Señal / Parcial</option>
              <option value="ABONADO_TOTAL" ${av.estadoCobroPrevio === 'ABONADO_TOTAL' ? 'selected' : ''}>✅ Abonado Total</option>
            </select>
          </div>
          <div class="field">
            <label>Abonado (€) / Método</label>
            <div style="display:flex;gap:4px;">
              <input type="number" step="0.01" id="editImporteAbonado_${av.idAviso}" value="${Number(av.importeAbonadoPrevio || 0) || ''}" placeholder="€" style="width:72px;" />
              <select id="editMetodoPagoPrevio_${av.idAviso}" style="flex:1;">
                <option value="">--</option>
                <option value="EFECTIVO" ${av.metodoPagoPrevio === 'EFECTIVO' ? 'selected' : ''}>Efectivo</option>
                <option value="TARJETA" ${av.metodoPagoPrevio === 'TARJETA' ? 'selected' : ''}>Tarjeta</option>
                <option value="BIZUM" ${av.metodoPagoPrevio === 'BIZUM' ? 'selected' : ''}>Bizum</option>
                <option value="TRANSFERENCIA" ${av.metodoPagoPrevio === 'TRANSFERENCIA' ? 'selected' : ''}>Transf.</option>
                <option value="FINANCIACION" ${av.metodoPagoPrevio === 'FINANCIACION' ? 'selected' : ''}>Financ.</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>Fecha Pago Previo</label>
            <div style="display:flex;gap:4px;">
              <input type="date" id="editFechaPagoPrevio_${av.idAviso}" value="${escapeHtml(av.fechaPagoPrevio || '')}" style="flex:1;" />
              <button type="button" class="btn btn-green" style="padding:4px 8px;font-size:11px;" onclick="saveAvisoEconomico('${av.idAviso}')" title="Guardar datos económicos previos">💾</button>
            </div>
          </div>
        </div>
      </div>

      <!-- TARJETA EMBEBIDA DE CÓDIGOS DE RESET Y TELÉFONO SAT FÁBRICA (TABLA MARCAS) -->
      ${brandInfo ? `
      <div class="brand-pin-box">
        <h4>
          <span>🔑 CHULETA TÉCNICA DE MARCA DETECTADA: ${escapeHtml(brandInfo.marca)} (${escapeHtml(brandInfo.proveedor || 'Oficial')})</span>
          ${brandInfo.telefonoFabrica ? `<a href="tel:${escapeHtml(brandInfo.telefonoFabrica)}" class="btn btn-primary" style="padding:4px 10px;font-size:11px;text-decoration:none;">📞 SAT Fábrica: ${escapeHtml(brandInfo.telefonoFabrica)}</a>` : ''}
        </h4>
        <div style="font-size:12px;margin-top:4px;">
          <strong>Códigos Reset / Menú Técnico:</strong> <span class="pin-code-highlight">${escapeHtml(brandInfo.codigosReset || 'Consultar manual')}</span>
        </div>
        ${brandInfo.observaciones ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">📌 ${escapeHtml(brandInfo.observaciones)}</div>` : ''}
      </div>
      ` : ''}

      <!-- DATOS DE CONTACTO, MÁQUINA Y OBSERVACIONES -->
      <div class="form-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:14px;">
        <div class="box" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;margin-bottom:6px;">📞 Contacto y Ubicación</div>
          <p style="font-size:13px;margin-bottom:6px;"><strong>Teléfonos:</strong> <a href="tel:${escapeHtml(av.telefono1)}" style="color:#fb923c;">${escapeHtml(av.telefono1 || 'S/T')}</a> ${av.telefono2 ? ` / <a href="tel:${escapeHtml(av.telefono2)}" style="color:#fb923c;">${escapeHtml(av.telefono2)}</a>` : ''}</p>
          <p style="font-size:13px;margin-bottom:6px;"><strong>Horario disponible:</strong> ${escapeHtml(av.horariosDisponibles || 'No especificado')}</p>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <a class="btn btn-ghost" style="font-size:11px;text-decoration:none;" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(av.direccionCompleta)}" target="_blank">🗺️ Abrir en Google Maps</a>
            <button class="btn btn-green" style="font-size:11px;" onclick="openWhatsappDirectClient('${escapeHtml(av.telefono1)}', '${escapeHtml(av.nombreCliente)}', ${av.numero})">💬 WhatsApp Cliente</button>
          </div>
        </div>

        <div class="box" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;margin-bottom:6px;">🔥 Máquina, Contrato e Importe Acumulado</div>
          <p style="font-size:13px;margin-bottom:4px;"><strong>Equipo:</strong> ${escapeHtml(av.tipoAparato)} · <strong>${escapeHtml(av.marca)}</strong> ${escapeHtml(av.modelo)}</p>
          <p style="font-size:12.5px;margin-bottom:4px;color:var(--text);">
            <strong>📅 Fecha Contrato / Compra:</strong> <span style="color:#fb923c;font-weight:700;">${escapeHtml(formatDateES(av.fechaInstalacion))}</span>
            ${av.docCompra ? ` · <strong>📄 Nº Contrato:</strong> <span class="badge badge-blue">${escapeHtml(av.docCompra)}</span>` : ''}
            ${av.numSerie ? ` · <strong>🔢 Nº Serie:</strong> <code>${escapeHtml(av.numSerie)}</code>` : ''}
          </p>
          <p style="font-size:12.5px;margin-bottom:4px;">
            <strong>Instalación / Origen:</strong>
            ${av.relacion === 'NO ES NUESTRA'
              ? `<span class="badge badge-red">⚠️ NO ES DE BAZA (EXTERNA)</span>`
              : (av.relacion === 'SUMINISTRADO'
                ? `<span class="badge badge-amber">📦 SUMINISTRO SIN INSTALAR</span>`
                : `<span class="badge badge-green">✅ INSTALADA POR BAZA MAZANO</span>`)}
            · <span style="color:var(--text-muted);">${escapeHtml(av.tipoIntervencion)}</span>
          </p>
          <p style="font-size:14px;margin-top:8px;color:#34d399;"><strong>Suma Importes Partes (` + '`SUMA IMPORTES AVISO`' + `):</strong> ${Number(av.sumaImportes || 0).toFixed(2)} €</p>
        </div>
      </div>

      ${av.observacionesAliquo ? `
      <div class="field" style="margin-bottom:14px;">
        <label style="color:#38bdf8;">📋 Historial Unificado "Varios" en Aliquo (Contrato, Máquina e Intervenciones Previas)</label>
        <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:10px 12px;font-size:12px;white-space:pre-wrap;color:var(--text);max-height:150px;overflow-y:auto;line-height:1.45;">${escapeHtml(av.observacionesAliquo)}</div>
      </div>
      ` : ''}

      <div class="field" style="margin-bottom:14px;">
        <label>📝 Observaciones del Aviso (Síntoma / Pedido de Repuesto)</label>
        <textarea rows="3" onchange="quickUpdateAviso('${av.idAviso}', { observaciones: this.value })">${escapeHtml(av.observaciones)}</textarea>
      </div>

      <div class="field">
        <label>🛠️ Historial Acumulado de Fichajes (` + '`NOTAS GENERADAS FICHAJES`' + `)</label>
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;color:var(--text);min-height:70px;">${escapeHtml(av.notasFichajes || 'Sin intervenciones cerradas todavía en este aviso.')}</div>
      </div>
    </div>
  `;
}

async function quickUpdateAviso(idAviso, patch) {
  const res = await apiFetch(`/api/avisos/${idAviso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const data = await res.json();
  if (data.ok) {
    const idx = state.avisos.findIndex(a => a.idAviso === idAviso);
    if (idx >= 0) state.avisos[idx] = data.aviso;
    state.selectedAviso = data.aviso;
    await loadBootstrap();
    selectAviso(idAviso);
  }
}

// =========================================================================
// SUB-TAB 1.2: DESPACHADOR MAPA + CALENDARIO DE PAREJAS (`CITAS`)
// =========================================================================
function formatCitaBadgeTime(inicio, fin) {
  if (!inicio) return '';
  const d1 = new Date(inicio);
  if (isNaN(d1.getTime())) return inicio;
  const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const diaSemana = diasSemana[d1.getDay()];
  const diaMes = String(d1.getDate()).padStart(2, '0');
  const mes = String(d1.getMonth() + 1).padStart(2, '0');
  const año = d1.getFullYear();
  const hora1 = d1.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  let hora2 = '';
  if (fin) {
    const d2 = new Date(fin);
    if (!isNaN(d2.getTime())) {
      hora2 = ' - ' + d2.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }
  return `${diaSemana} ${diaMes}/${mes}/${año} · 🕒 ${hora1}${hora2}`;
}

function formatCitaTimeShort(inicio, fin) {
  if (!inicio) return '';
  const d1 = new Date(inicio);
  if (isNaN(d1.getTime())) return inicio;
  const hora1 = d1.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!fin) return `🕒 ${hora1}`;
  const d2 = new Date(fin);
  if (isNaN(d2.getTime())) return `🕒 ${hora1}`;
  const hora2 = d2.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `🕒 ${hora1} - ${hora2}`;
}

async function ensureAllCitasLoaded() {
  if (state.allCitas && state.allCitas.length > 500) return;
  try {
    const res = await apiFetch('/api/citas?limit=2500');
    const data = await res.json();
    if (data.ok && data.citas) {
      state.allCitas = data.citas;
    }
  } catch (e) {
    console.error('Error cargando citas:', e);
  }
}

async function loadCitasList(emailFilter = '') {
  const params = new URLSearchParams({ limit: '200' });
  if (emailFilter) params.set('email', emailFilter);
  const res = await apiFetch(`/api/citas?${params}`);
  const data = await res.json();
  if (data.ok) {
    state.citas = data.citas || [];
    renderCitasCalendarList();
  }
  ensureAllCitasLoaded();
}

function filterCitasByCrew(emailSubstr) {
  loadCitasList(emailSubstr);
}

function formatCrewBadges(asistentesStr) {
  const raw = String(asistentesStr || '').toLowerCase();
  const badges = [];
  if (raw.includes('jacobo')) badges.push(`<span class="badge badge-blue">🔵 JACOBO</span>`);
  if (raw.includes('alejandro') || raw.includes('alex')) badges.push(`<span class="badge badge-green">🟢 ALEX</span>`);
  if (raw.includes('dioni')) badges.push(`<span class="badge badge-orange">🟠 DIONI</span>`);
  if (raw.includes('rober')) badges.push(`<span class="badge badge-purple">🟣 ROBERTO</span>`);
  if (badges.length === 0) badges.push(`<span class="badge badge-orange">${escapeHtml(asistentesStr || 'SIN ASIGNAR')}</span>`);
  if (badges.length > 1) {
    badges.unshift(`<span class="badge badge-amber">🤝 PAREJA</span>`);
  }
  return badges.join(' ');
}

function getCitaTechClass(asistentesStr) {
  const raw = String(asistentesStr || '').toLowerCase();
  const techs = [];
  if (raw.includes('alex') || raw.includes('alejandro')) techs.push('alex');
  if (raw.includes('jacobo')) techs.push('jacobo');
  if (raw.includes('dioni')) techs.push('dioni');
  if (raw.includes('rober')) techs.push('roberto');

  if (techs.length > 1) return 'cita-tech-team';
  if (techs.length === 1) return `cita-tech-${techs[0]}`;
  return '';
}

function renderCitasCalendarList() {
  const el = document.getElementById('citasCalendarList');
  if (!el) return;
  if (state.citas.length === 0) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);">No hay citas para este filtro.</div>`;
    return;
  }

  el.innerHTML = state.citas.slice(0, 45).map(c => {
    const av = c.aviso;
    const tel = av ? av.telefono1 : '';
    const cli = av ? `${av.nombreCliente} ${av.apellidosCliente}`.trim() : c.titulo;
    return `
      <div class="tech-cita-card ${getCitaTechClass(c.asistentes)}" style="padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <strong style="color:#ea580c;font-size:12.5px;">${formatCitaBadgeTime(c.inicio, c.fin)}</strong>
          <div>${formatCrewBadges(c.asistentes)}</div>
        </div>
        <div class="tech-cita-title" style="font-size:13.5px;margin-bottom:4px;">
          #${c.avisoNumero} · ${escapeHtml(c.titulo)}
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
          📍 ${escapeHtml(c.direccion)}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            ${c.whatsappConfirmado
              ? `<span class="badge badge-green">✅ Cliente avisado por WhatsApp</span>`
              : `<button class="btn btn-green" style="padding:5px 10px;font-size:11px;" onclick="openConfirmarWhatsappModal('${c.idCita}', '${escapeHtml(tel)}', '${escapeHtml(cli)}', '${escapeHtml(c.inicio)}', '${escapeHtml(c.direccion)}')">📲 Confirmar Cita por WhatsApp</button>`
            }
          </div>
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px;" onclick="openCerrarFichajeModal(null, '${c.idAviso}')">
            🛠️ Abrir Parte
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// =========================================================================
// SUB-TAB 1.5 & APP MÓVIL: CALENDARIO SEMANAL GENERAL (SEMANA VISTA CARGAS)
// =========================================================================
function changeCalendarWeek(deltaWeeks, containerId, isMobile) {
  if (!state.calViewDate) state.calViewDate = new Date();
  const d = new Date(state.calViewDate);
  d.setDate(d.getDate() + (deltaWeeks * 7));
  state.calViewDate = d;
  renderWeeklyCalendar(containerId, isMobile);
}

function setCalendarToday(containerId, isMobile) {
  state.calViewDate = new Date();
  renderWeeklyCalendar(containerId, isMobile);
}

function setCalendarDemoWeek(dateStr, containerId, isMobile) {
  if (dateStr === 'NEXT_WEEK') {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    state.calViewDate = d;
  } else {
    state.calViewDate = new Date(dateStr + 'T08:00:00');
  }
  renderWeeklyCalendar(containerId, isMobile);
}

function setCalendarCrewFilter(crew, containerId, isMobile) {
  state.calCrewFilter = crew;
  renderWeeklyCalendar(containerId, isMobile);
}

async function renderWeeklyCalendar(containerId = 'mandoSectionCalendario', isMobile = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;">🔄 Cargando citas de la semana...</div>`;

  await ensureAllCitasLoaded();

  if (!state.calViewDate) {
    state.calViewDate = new Date();
  }
  if (!state.calCrewFilter) {
    state.calCrewFilter = 'TODOS';
  }

  // Calcular Lunes y días de la semana (Lunes a Sábado)
  const d = new Date(state.calViewDate);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const days = [];
  const dayNames = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  for (let i = 0; i < 6; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    days.push(cur);
  }

  const saturday = days[5];
  const weekLabel = `Semana: Lun ${days[0].getDate()} ${monthNames[days[0].getMonth()]} — Sáb ${saturday.getDate()} ${monthNames[saturday.getMonth()]} ${saturday.getFullYear()}`;

  // Filtrar citas por técnico
  const allList = state.allCitas || state.citas || [];
  let filtered = allList;
  if (state.calCrewFilter !== 'TODOS') {
    const cf = state.calCrewFilter.toLowerCase();
    filtered = allList.filter(c => {
      const as = String(c.asistentes || '').toLowerCase();
      if (cf === 'alex') return as.includes('alex') || as.includes('alejandro');
      if (cf === 'jacobo') return as.includes('jacobo');
      if (cf === 'dioni') return as.includes('dioni');
      if (cf === 'roberto') return as.includes('rober');
      return as.includes(cf);
    });
  }

  // Agrupar citas por cada día
  const dayBuckets = days.map((dayDate, idx) => {
    const y = dayDate.getFullYear();
    const m = String(dayDate.getMonth() + 1).padStart(2, '0');
    const dayNum = String(dayDate.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${dayNum}`;

    const citas = filtered.filter(c => String(c.inicio || '').startsWith(ymd));
    citas.sort((a, b) => String(a.inicio || '').localeCompare(String(b.inicio || '')));

    const totalCitas = citas.length;
    const estHoras = (totalCitas * 1.5).toFixed(1);

    // Semáforo de saturación
    let statusClass = 'badge-blue';
    let statusLabel = '0 citas (Libre)';
    if (totalCitas > 0 && totalCitas <= 3) {
      statusClass = 'badge-green';
      statusLabel = `🟢 ${totalCitas} citas (~${estHoras}h)`;
    } else if (totalCitas >= 4 && totalCitas <= 6) {
      statusClass = 'badge-orange';
      statusLabel = `🟠 ${totalCitas} citas (~${estHoras}h)`;
    } else if (totalCitas >= 7) {
      statusClass = 'badge-red';
      statusLabel = `🔴 ${totalCitas} citas (Saturado ~${estHoras}h)`;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = ymd === todayStr;

    return {
      dayDate,
      ymd,
      dayName: dayNames[idx],
      displayDate: `${dayDate.getDate()} ${monthNames[dayDate.getMonth()]}`,
      citas,
      totalCitas,
      estHoras,
      statusClass,
      statusLabel,
      isToday
    };
  });

  const totalWeekCitas = dayBuckets.reduce((acc, b) => acc + b.totalCitas, 0);
  const totalWeekHoras = (totalWeekCitas * 1.5).toFixed(1);

  // Botones de filtro de técnicos
  const crews = [
    { key: 'TODOS', label: '👥 Todos' },
    { key: 'ALEX', label: '🟢 Alex' },
    { key: 'JACOBO', label: '🔵 Jacobo' },
    { key: 'DIONI', label: '🟠 Dioni' },
    { key: 'ROBERTO', label: '🟣 Roberto' }
  ];

  container.innerHTML = `
    <div class="weekly-calendar-wrap">
      <!-- CABECERA PRINCIPAL DE NAVEGACIÓN Y FILTROS -->
      <div class="weekly-calendar-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost" onclick="changeCalendarWeek(-1, '${containerId}', ${isMobile})">⟨ Sem. Ant.</button>
            <button class="btn btn-ghost" onclick="changeCalendarWeek(1, '${containerId}', ${isMobile})">Sem. Sig. ⟩</button>
          </div>
          <strong style="font-size:14px;color:var(--text);">${weekLabel}</strong>
          <span class="badge badge-orange" style="font-size:12px;">${totalWeekCitas} Citas en Semana (~${totalWeekHoras} h)</span>
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px;" onclick="setCalendarToday('${containerId}', ${isMobile})">📍 Hoy / Semana Actual</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px;" onclick="setCalendarDemoWeek('NEXT_WEEK', '${containerId}', ${isMobile})">⏩ Próxima Semana (+7d)</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px;" onclick="setCalendarDemoWeek('2026-09-14', '${containerId}', ${isMobile})">🔥 Histórico Pico (14-19 Sep · 38 citas)</button>
        </div>
      </div>

      <!-- FILTRO DE TÉCNICOS POR PÍLDORAS -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:12px;font-weight:700;color:var(--text-muted);">Filtrar Técnico:</span>
        ${crews.map(c => `
          <button class="btn ${state.calCrewFilter === c.key ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 12px;font-size:11.5px;font-weight:700;" onclick="setCalendarCrewFilter('${c.key}', '${containerId}', ${isMobile})">
            ${c.label}
          </button>
        `).join('')}
      </div>

      <!-- BARRA RESUMEN DE CARGA SEMANAL POR DÍA -->
      <div class="weekly-workload-bar">
        <strong style="color:var(--text);margin-right:6px;">📊 Carga Diaria:</strong>
        ${dayBuckets.map(b => `
          <div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);font-size:11px;">
            <strong>${b.dayName.slice(0, 3)}:</strong>
            <span class="badge ${b.statusClass}" style="padding:2px 6px;font-size:10.5px;">${b.totalCitas} citas</span>
          </div>
        `).join('')}
      </div>

      <!-- CUADRÍCULA DE 6 COLUMNAS (LUNES A SÁBADO) -->
      <div class="weekly-grid-6">
        ${dayBuckets.map(b => `
          <div class="weekly-day-col ${b.isToday ? 'is-today' : ''}">
            <div class="weekly-day-header">
              <div>
                <div class="day-name">${b.dayName}</div>
                <div class="day-date">${b.displayDate} ${b.isToday ? '· <strong>HOY</strong>' : ''}</div>
              </div>
              <span class="badge ${b.statusClass}" style="font-size:10.5px;padding:2px 6px;">${b.totalCitas}</span>
            </div>

            <div class="weekly-day-body">
              ${b.citas.length === 0 ? `
                <div style="padding:30px 10px;text-align:center;color:var(--text-muted);font-size:11.5px;">
                  ⚪ Sin citas agendadas
                </div>
              ` : b.citas.map(c => {
                const av = c.aviso;
                const tel = av ? av.telefono1 : '';
                const cli = av ? `${av.nombreCliente} ${av.apellidosCliente}`.trim() : c.titulo;
                return `
                  <div class="weekly-cita-item ${getCitaTechClass(c.asistentes)}" onclick="openCerrarFichajeModal(null, '${c.idAviso}')">
                    <div class="weekly-cita-time">
                      <span>${formatCitaTimeShort(c.inicio, c.fin)}</span>
                      <div>${formatCrewBadges(c.asistentes)}</div>
                    </div>
                    <div class="weekly-cita-title">
                      #${c.avisoNumero} · ${escapeHtml(c.titulo)}
                    </div>
                    ${c.descripcion ? `
                      <div style="font-size:11px;color:var(--text);margin-top:3px;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.descripcion)}">
                        ⚠️ ${escapeHtml(c.descripcion)}
                      </div>
                    ` : ''}
                    <div class="weekly-cita-meta" style="margin-top:6px;">
                      <div>📍 ${escapeHtml(c.direccion)}</div>
                      ${av && av.kmIdaVuelta ? `<div style="color:#fb923c;font-weight:700;">🚗 ${av.kmIdaVuelta} km I/V</div>` : ''}
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:6px;" onclick="event.stopPropagation()">
                      <button class="btn btn-ghost" style="padding:4px 8px;font-size:10.5px;" onclick="openCerrarFichajeModal(null, '${c.idAviso}')">
                        🛠️ Ver / Cerrar
                      </button>
                      <button class="btn btn-green" style="padding:4px 8px;font-size:10.5px;" onclick="openConfirmarWhatsappModal('${c.idCita}', '${escapeHtml(tel)}', '${escapeHtml(cli)}', '${escapeHtml(c.inicio)}', '${escapeHtml(c.direccion)}')">
                        💬 WhatsApp
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function refreshDispatchMap(resetZoom = false) {
  const mapEl = document.getElementById('dispatchMap');
  if (!mapEl || typeof L === 'undefined') return;

  if (!state.mapInstance) {
    state.mapInstance = L.map('dispatchMap').setView([41.6191565, -4.7209136], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.mapInstance);
  } else {
    state.mapInstance.invalidateSize();
    if (resetZoom) {
      state.mapInstance.setView([41.6191565, -4.7209136], 14);
    }
  }

  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];

  // Marcador Base Baza Mazano (C/ Annapurna 22, Pinar de Jalón, 47013 Valladolid)
  const hqMarker = L.circleMarker([41.6191565, -4.7209136], {
    radius: 9,
    fillColor: '#f97316',
    color: '#fff',
    weight: 2,
    fillOpacity: 1
  }).addTo(state.mapInstance);
  hqMarker.bindPopup(`<strong>🏢 BASE CENTRAL BAZA MAZANO S.L.</strong><br>Calle Annapurna 22 (Pinar de Jalón), 47013 Valladolid<br><em>Origen de cálculo de franquicia 30 km I/V</em>`);
  state.mapMarkers.push(hqMarker);

  // Pintar avisos activos en el mapa
  const avisosParaMapa = state.avisos.slice(0, 100);
  const validMarkers = [hqMarker];

  for (const a of avisosParaMapa) {
    if (!a.lat || !a.lng) continue;
    const color = a.estadoAviso === 'SIN PROCESAR' ? '#ef4444' :
                  (a.estadoAviso === 'REALIZABLE' ? '#10b981' : '#3b82f6');
    const marker = L.circleMarker([a.lat, a.lng], {
      radius: 8,
      fillColor: color,
      color: '#ffffff',
      weight: 1.5,
      fillOpacity: 0.95
    }).addTo(state.mapInstance);

    marker.bindPopup(`
      <div style="font-family:sans-serif;min-width:230px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="color:#ea580c;font-size:14px;">Aviso #${a.numero}</strong>
          <span style="font-size:10px;padding:2px 6px;border-radius:99px;background:#f1f5f9;color:#334155;font-weight:700;">${escapeHtml(a.estadoAviso)}</span>
        </div>
        <div style="font-weight:700;font-size:13px;margin:3px 0;">${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}</div>
        <div style="font-size:12px;color:#475569;">📍 ${escapeHtml(a.direccionCompleta)}</div>
        <div style="font-size:12px;margin-top:6px;background:#f8fafc;padding:6px;border-radius:6px;border:1px solid #e2e8f0;">
          <div>🏘️ <strong>Municipio:</strong> ${escapeHtml(a.poblacion || 'VALLADOLID')}</div>
          <div>🛣️ <strong>${a.kmIdaVuelta || 14} km I/V</strong> desde C/ Annapurna 22</div>
          <div>🔥 ${escapeHtml(a.marca || '')} ${escapeHtml(a.modelo || '')} (${escapeHtml(a.tipoIntervencion || 'SAT')})</div>
        </div>
        <button onclick="openAgendarCitaModal('${a.idAviso}')" style="margin-top:8px;width:100%;background:#ea580c;color:#fff;border:none;padding:7px 10px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">
          📅 Agendar Cita Aquí
        </button>
      </div>
    `);
    state.mapMarkers.push(marker);
    validMarkers.push(marker);
  }

  // Auto-ajustar el zoom del mapa para encuadrar la base y todos los pueblos con aviso
  if (validMarkers.length > 1 && !resetZoom) {
    try {
      const group = L.featureGroup(validMarkers);
      state.mapInstance.fitBounds(group.getBounds().pad(0.12));
    } catch (e) {}
  }
}

// =========================================================================
// SUB-TAB 1.3: RADAR DE AVISOS PERDIDOS (AGENDADOS SIN FICHAJE)
// =========================================================================
async function loadAvisosPerdidosTable() {
  const res = await apiFetch('/api/avisos?estado=PERDIDOS&limit=80');
  const data = await res.json();
  if (!data.ok) return;

  document.getElementById('perdidosTotalBadge').textContent = `${data.total} avisos agendados sin parte cerrado`;
  const wrap = document.getElementById('perdidosTableWrap');

  if (!data.avisos || data.avisos.length === 0) {
    wrap.innerHTML = `<div style="padding:30px;text-align:center;color:#34d399;">🎉 ¡Cero avisos perdidos! Todos los avisos agendados tienen su parte de fichaje al día.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nº Aviso</th>
          <th>Fecha</th>
          <th>Cliente</th>
          <th>Municipio / Dirección</th>
          <th>Máquina</th>
          <th>Técnico Asignado</th>
          <th>Acciones Anti-Olvido</th>
        </tr>
      </thead>
      <tbody>
        ${data.avisos.map(a => `
          <tr>
            <td><strong style="color:#fb923c;">#${a.numero}</strong></td>
            <td>${escapeHtml(a.fecha)}</td>
            <td><strong>${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}</strong></td>
            <td>${escapeHtml(a.direccionCompleta)}</td>
            <td>${escapeHtml(a.marca)} ${escapeHtml(a.modelo)}</td>
            <td><span class="badge badge-blue">👷 ${escapeHtml(a.operarioPreasignado || 'JACOBO')}</span></td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-green" style="padding:5px 10px;font-size:11px;" onclick="openCerrarFichajeModal(null, '${a.idAviso}')">
                ✅ Cerrar Parte Ahora
              </button>
              <button class="btn btn-primary" style="padding:5px 10px;font-size:11px;" onclick="pingTecnicoWhatsapp('${escapeHtml(a.operarioPreasignado)}', ${a.numero}, '${escapeHtml(a.nombreCliente)}')">
                📲 Reclamar por WhatsApp al Técnico
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const searchVal = document.getElementById('repuestosCatalogSearch') ? document.getElementById('repuestosCatalogSearch').value : '';
  renderRepuestosCatalogTable(searchVal);
}

function renderRepuestosCatalogTable(query = '') {
  if (!state.bootstrap) return;
  const container = document.getElementById('repuestosCatalogContainer');
  const countEl = document.getElementById('repuestosCatalogCount');
  if (!container) return;

  const canCostes = Boolean(state.authUser && state.authUser.canSeeCostes);
  const all = Array.isArray(state.bootstrap.repuestos) ? state.bootstrap.repuestos : [];
  const q = String(query || '').trim().toLowerCase();
  const filtered = q
    ? all.filter(r =>
        String(r.codigo || '').toLowerCase().includes(q) ||
        String(r.descripcion || '').toLowerCase().includes(q) ||
        String(r.marca || '').toLowerCase().includes(q)
      )
    : all;

  if (countEl) countEl.textContent = `${filtered.length}${q ? ` / ${all.length}` : ''}`;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No hay repuestos que coincidan con "${escapeHtml(q)}".</div>`;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción Repuesto</th>
          <th>Marca / Familia</th>
          ${canCostes ? '<th style="text-align:right;">Coste Neto</th>' : ''}
          <th style="text-align:right;">PVP</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(r => {
          const pvp = Number(r.pvp ?? r.precio ?? 0);
          const neto = Number(r.precioNeto || 0);
          return `
            <tr>
              <td><span class="badge badge-blue">${escapeHtml(r.codigo || '-')}</span></td>
              <td><strong>${escapeHtml(r.descripcion || '-')}</strong></td>
              <td style="color:var(--text-muted);">${escapeHtml(r.marca || 'GENERAL')}</td>
              ${canCostes ? `<td style="text-align:right;color:var(--text-muted);">${neto.toFixed(2)} €</td>` : ''}
              <td style="text-align:right;"><strong style="color:#34d399;">${pvp.toFixed(2)} €</strong></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function pingTecnicoWhatsapp(operario, numero, cliente) {
  const msg = `🚨 Hola ${operario || 'equipo'}, el Aviso #${numero} (${cliente}) figura como AGENDADO pero aún no tiene el Parte de Fichaje cerrado. Por favor, ciérralo en la App SAT Baza 2.0 para pasar a Aliquo.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// =========================================================================
// SUB-TAB 1.4: CATÁLOGOS DE MARCAS (PINS RESET) Y TARIFAS 2026 / 2027
// =========================================================================
function renderCatalogosMando() {
  if (!state.bootstrap) return;
  const marcasEl = document.getElementById('marcasCatalogContainer');
  const tarifasEl = document.getElementById('tarifasCatalogContainer');

  marcasEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Marca</th><th>Proveedor / SAT</th><th>Tel. Fábrica</th><th>Códigos Reset / Contraseñas</th></tr>
      </thead>
      <tbody>
        ${state.bootstrap.marcas.map(m => `
          <tr>
            <td><strong style="color:#fb923c;">${escapeHtml(m.marca)}</strong></td>
            <td>${escapeHtml(m.proveedor)}</td>
            <td>${m.telefonoFabrica ? `<a href="tel:${escapeHtml(m.telefonoFabrica)}" style="color:#34d399;font-weight:700;">📞 ${escapeHtml(m.telefonoFabrica)}</a>` : '-'}</td>
            <td><span style="color:#fde047;font-weight:700;">${escapeHtml(m.codigosReset || '-')}</span><br><small style="color:var(--text-muted);">${escapeHtml(m.observaciones || '')}</small></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const year = state.activeTariffYear || '2026';
  const t = state.bootstrap.tarifas.tablas[year] || state.bootstrap.tarifas.tablas['2026'];

  tarifasEl.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--brand);border-radius:10px;padding:14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#fb923c;font-size:14px;">${escapeHtml(t.nombre)}</strong>
        <span class="badge badge-green">Franquicia: 30 km I/V (C/ Annapurna 22)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px;">
        <div style="background:var(--bg-card);border:1px solid var(--border);padding:10px;border-radius:8px;">
          <div style="color:var(--text-muted);">Salida Base (incl. 30 km)</div>
          <strong style="font-size:18px;color:var(--text);">${t.salidaBase.toFixed(2)} €</strong>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);padding:10px;border-radius:8px;">
          <div style="color:var(--text-muted);">Hora M.O. Cliente / No Cli.</div>
          <strong style="font-size:18px;color:#10b981;">${t.horaManoObraCliente} € / ${t.horaManoObraNoCliente} €</strong>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);padding:10px;border-radius:8px;">
          <div style="color:var(--text-muted);">Km Extra (> 30 km I/V)</div>
          <strong style="font-size:18px;color:#f59e0b;">${t.precioKmExtra.toFixed(2)} €/km</strong>
        </div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Operación / Servicio Oficial</th>
          <th>Aire (Cliente / No Cli.)</th>
          <th>Agua / Hidro (Cliente / No Cli.)</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(t.servicios).map(([op, val]) => `
          <tr>
            <td><strong>${escapeHtml(op)}</strong></td>
            <td><span style="color:#34d399;font-weight:700;">${val.aireCliente} €</span> / ${val.aireNoCliente} €</td>
            <td><span style="color:#60a5fa;font-weight:700;">${val.aguaCliente} €</span> / ${val.aguaNoCliente} €</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const searchVal = document.getElementById('repuestosCatalogSearch') ? document.getElementById('repuestosCatalogSearch').value : '';
  renderRepuestosCatalogTable(searchVal);
}

function renderRepuestosCatalogTable(query = '') {
  if (!state.bootstrap) return;
  const container = document.getElementById('repuestosCatalogContainer');
  const countEl = document.getElementById('repuestosCatalogCount');
  if (!container) return;

  const canCostes = Boolean(state.authUser && state.authUser.canSeeCostes);
  const all = Array.isArray(state.bootstrap.repuestos) ? state.bootstrap.repuestos : [];
  const q = String(query || '').trim().toLowerCase();
  const filtered = q
    ? all.filter(r =>
        String(r.codigo || '').toLowerCase().includes(q) ||
        String(r.descripcion || '').toLowerCase().includes(q) ||
        String(r.marca || '').toLowerCase().includes(q)
      )
    : all;

  if (countEl) countEl.textContent = `${filtered.length}${q ? ` / ${all.length}` : ''}`;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No hay repuestos que coincidan con "${escapeHtml(q)}".</div>`;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción Repuesto</th>
          <th>Marca / Familia</th>
          ${canCostes ? '<th style="text-align:right;">Coste Neto</th>' : ''}
          <th style="text-align:right;">PVP</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(r => {
          const pvp = Number(r.pvp ?? r.precio ?? 0);
          const neto = Number(r.precioNeto || 0);
          return `
            <tr>
              <td><span class="badge badge-blue">${escapeHtml(r.codigo || '-')}</span></td>
              <td><strong>${escapeHtml(r.descripcion || '-')}</strong></td>
              <td style="color:var(--text-muted);">${escapeHtml(r.marca || 'GENERAL')}</td>
              ${canCostes ? `<td style="text-align:right;color:var(--text-muted);">${neto.toFixed(2)} €</td>` : ''}
              <td style="text-align:right;"><strong style="color:#34d399;">${pvp.toFixed(2)} €</strong></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// =========================================================================
// ROL 2: APP MÓVIL TÉCNICOS (ALEX, JACOBO, DIONI, ROBERTO) + GEOCERCA 1 KM
// =========================================================================
function syncActiveFichajeForCurrentTech() {
  if (!state.bootstrap) return;
  const sel = document.getElementById('mobileTechSelect');
  const email = sel ? sel.value.toLowerCase() : 'alejandro.bazamazano@gmail.com';
  const abiertos = state.bootstrap.fichajesAbiertos || [];
  state.activeFichaje = abiertos.find(f => String(f.operario || '').toLowerCase() === email) || null;
  updateGeofenceBarUI();
}

function updateGeofenceBarUI() {
  const bar = document.getElementById('geofenceStatusBar');
  const title = document.getElementById('geofenceStatusTitle');
  const sub = document.getElementById('geofenceStatusSub');
  if (!bar || !title || !sub) return;

  if (state.activeFichaje) {
    bar.classList.add('danger');
    title.innerHTML = `🔴 PARTE #${state.activeFichaje.avisoNumero} EN CURSO (${escapeHtml(state.activeFichaje.clienteNombre || 'Cliente')})`;
    sub.innerHTML = `Iniciado a las ${escapeHtml(state.activeFichaje.inicio)} · GPS vigilando radio 1,0 km. ¡No olvides cerrarlo al salir!`;
  } else {
    bar.classList.remove('danger');
    title.innerHTML = `🛰️ Geocerca Anti-Olvidos Activa (Radio 1,0 km)`;
    sub.innerHTML = `Ningún parte abierto ahora mismo. Puedes iniciar tu siguiente cita con normalidad.`;
  }
}

function switchMobileTab(tab) {
  state.mobileTab = tab;
  document.getElementById('mobTabMisCitas')?.classList.toggle('active', tab === 'citas');
  document.getElementById('mobTabSemana')?.classList.toggle('active', tab === 'semana');
  document.getElementById('mobTabRadar')?.classList.toggle('active', tab === 'radar');
  document.getElementById('mobTabPins')?.classList.toggle('active', tab === 'pins');
  refreshMobileView();
}

function onMobileTechChanged() {
  const sel = document.getElementById('mobileTechSelect');
  const activeTechName = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : 'ALEX';
  if (state.mobileCrewPartners.has(activeTechName)) {
    state.mobileCrewPartners.delete(activeTechName);
  }
  updateMobileCrewPillsUI();
  refreshMobileView();
}

function toggleMobileCrewTeammate(tech) {
  const sel = document.getElementById('mobileTechSelect');
  const activeTechName = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : 'ALEX';
  if (tech === activeTechName) {
    alert(`No puedes ponerte a ti mismo (${tech}) como compañero de apoyo.`);
    return;
  }

  if (state.mobileCrewPartners.has(tech)) {
    state.mobileCrewPartners.delete(tech);
  } else {
    state.mobileCrewPartners.add(tech);
  }
  updateMobileCrewPillsUI();
}

function updateMobileCrewPillsUI() {
  const allTechs = ['JACOBO', 'ALEX', 'DIONI', 'ROBERTO'];
  allTechs.forEach(t => {
    const btn = document.getElementById(`crewPill${t.charAt(0) + t.slice(1).toLowerCase()}`);
    if (!btn) return;
    const isAct = state.mobileCrewPartners.has(t);
    btn.classList.toggle('active', isAct);
    const emojiMap = { JACOBO: '🔵', ALEX: '🟢', DIONI: '🟠', ROBERTO: '🟣' };
    btn.innerHTML = isAct ? `✅ ${t}` : `${emojiMap[t]} ${t}`;
  });

  const badge = document.getElementById('crewSelectedBadge');
  if (badge) {
    const count = state.mobileCrewPartners.size;
    if (count === 0) {
      badge.textContent = 'Solo (Sin apoyo)';
      badge.className = 'badge badge-ghost';
    } else {
      badge.textContent = `🤝 Equipo: ${Array.from(state.mobileCrewPartners).join(' + ')}`;
      badge.className = 'badge badge-amber';
    }
  }
}

function getSelectedMobilePartnersString() {
  if (!state.mobileCrewPartners || state.mobileCrewPartners.size === 0) return '';
  return Array.from(state.mobileCrewPartners).join(' + ');
}

async function refreshMobileView() {
  syncActiveFichajeForCurrentTech();
  updateMobileCrewPillsUI();
  const sel = document.getElementById('mobileTechSelect');
  const email = sel ? sel.value : 'alejandro.bazamazano@gmail.com';
  const techName = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name : 'ALEX';
  const area = document.getElementById('mobileContentArea');

  if (state.mobileTab === 'semana') {
    renderWeeklyCalendar('mobileContentArea', true);
    return;
  }

  if (state.mobileTab === 'citas') {
    const res = await apiFetch(`/api/citas?email=${encodeURIComponent(email)}&limit=40`);
    const data = await res.json();
    const misCitas = data.citas || [];

    area.innerHTML = `
      ${state.activeFichaje ? `
        <div style="background:rgba(239,68,68,0.18);border:2px solid #ef4444;border-radius:12px;padding:14px;margin-bottom:14px;">
          <div style="font-weight:800;color:#fca5a5;font-size:14px;">🛠️ TIENES UN PARTE EN CURSO (#${state.activeFichaje.avisoNumero})</div>
          <div style="font-size:12px;margin:4px 0 10px;">📍 ${escapeHtml(state.activeFichaje.direccion)}</div>
          <button class="btn btn-green" style="width:100%;padding:12px;font-size:13px;" onclick="openCerrarFichajeModal('${state.activeFichaje.idFichaje}', '${state.activeFichaje.idAviso}')">
            ✅ Cerrar Parte #${state.activeFichaje.avisoNumero} en 3 Pasos
          </button>
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="font-size:13px;">📅 Mis Citas Asignadas (${techName})</strong>
        <span class="badge badge-blue">${misCitas.length} citas</span>
      </div>

      ${misCitas.slice(0, 20).map(c => {
        const av = c.aviso;
        const infoMarca = c.infoMarca;
        return `
          <div class="tech-cita-card ${getCitaTechClass(c.asistentes)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span class="badge badge-orange">${formatCitaBadgeTime(c.inicio, c.fin)}</span>
              <div>${formatCrewBadges(c.asistentes)}</div>
            </div>
            <div class="tech-cita-title">
              #${c.avisoNumero} · ${escapeHtml(c.titulo)}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
              📍 ${escapeHtml(c.direccion)} ${av ? `· <strong>${av.kmIdaVuelta || 14} km I/V</strong>` : ''}
            </div>

            ${av && ((av.precioComunicado !== null && av.precioComunicado !== undefined) || Number(av.importeAbonadoPrevio || 0) > 0 || (av.estadoCobroPrevio && av.estadoCobroPrevio !== 'PENDIENTE')) ? `
              <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11.5px;color:#6ee7b7;">
                💶 <strong>Económico Previo:</strong>
                ${av.precioComunicado !== null && av.precioComunicado !== undefined ? `Precio acordado <strong>${Number(av.precioComunicado).toFixed(2)} €</strong>` : ''}
                ${Number(av.importeAbonadoPrevio || 0) > 0 ? ` · Abonado <strong>${Number(av.importeAbonadoPrevio).toFixed(2)} €</strong> (${escapeHtml(av.metodoPagoPrevio || 'Previo')}${av.fechaPagoPrevio ? ', ' + escapeHtml(av.fechaPagoPrevio) : ''})` : ''}
                ${av.estadoCobroPrevio === 'ABONADO_TOTAL' ? ' · ✅ YA ABONADO' : (av.estadoCobroPrevio === 'SENAL_PARCIAL' ? ' · 🟡 SEÑAL PARCIAL' : '')}
              </div>
            ` : ''}

            ${infoMarca ? `
              <div class="brand-pin-box" style="padding:8px 10px;margin-bottom:10px;font-size:11px;">
                <strong style="color:#fb923c;">🔑 PIN Reset ${escapeHtml(infoMarca.marca)}:</strong>
                <span class="pin-code-highlight">${escapeHtml(infoMarca.codigosReset || 'Ver manual')}</span>
                ${infoMarca.telefonoFabrica ? ` · <a href="tel:${escapeHtml(infoMarca.telefonoFabrica)}" style="color:#10b981;font-weight:700;">📞 Fábrica: ${escapeHtml(infoMarca.telefonoFabrica)}</a>` : ''}
              </div>
            ` : ''}

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <a class="btn btn-ghost" href="tel:${escapeHtml(av ? av.telefono1 : '')}" style="text-decoration:none;">📞 Llamar Cliente</a>
              <a class="btn btn-ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}" target="_blank" style="text-decoration:none;">🗺️ Navegar GPS</a>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="btn btn-blue" onclick="iniciarFichajeEnTerreno('${c.idAviso}', ${c.avisoNumero})">
                ▶️ Iniciar Fichaje (GPS)
              </button>
              <button class="btn btn-green" onclick="openCerrarFichajeModal(null, '${c.idAviso}')">
                ✅ Cerrar Parte
              </button>
            </div>
          </div>
        `;
      }).join('')}
    `;
  } else if (state.mobileTab === 'radar') {
    const res = await apiFetch(`/api/radar-cercanos?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    const cercanos = data.cercanos || [];

    area.innerHTML = `
      <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:12px;margin-bottom:12px;font-size:12px;">
        <strong>🛣️ ¿Has terminado pronto tu cita?</strong><br>
        Aquí tienes los avisos <code>REALIZABLES</code> ordenados por cercanía a tu ruta actual para aprovechar el viaje sin llamadas de oficina:
      </div>
      ${cercanos.map(a => `
        <div class="tech-cita-card" style="padding:12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span class="badge badge-green">📍 A ${a.distanciaDesdeTecnicoKm} km de ti (${escapeHtml(a.poblacion)})</span>
            ${badgeForPrioridad(a.prioridad)}
          </div>
          <div class="tech-cita-title" style="font-size:14px;">#${a.numero} · ${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin:3px 0;">${escapeHtml(a.direccionCompleta)}</div>
          <div style="font-size:12px;color:#fb923c;margin-bottom:8px;">🔥 ${escapeHtml(a.tipoAparato)} · ${escapeHtml(a.marca)} ${escapeHtml(a.modelo)} (${escapeHtml(a.tipoIntervencion)})</div>
          <button class="btn btn-primary" style="width:100%;" onclick="cogerAvisoDeCamino('${a.idAviso}', ${a.numero})">
            🚐 Coger este aviso de camino e Iniciar Fichaje
          </button>
        </div>
      `).join('')}
    `;
  } else if (state.mobileTab === 'pins') {
    const marcas = (state.bootstrap && state.bootstrap.marcas) || [];
    area.innerHTML = `
      <input type="search" placeholder="🔍 Filtrar marca (EOSS, RAVELLI, MCZ, ECOFOREST, EDILKAMIN...)" oninput="filterMobilePins(this.value)" style="width:100%;margin-bottom:12px;" />
      <div id="mobilePinsList">
        ${renderMobilePinsCards(marcas)}
      </div>
    `;
  }
}

function renderMobilePinsCards(marcas) {
  return marcas.map(m => `
    <div class="tech-cita-card" style="padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:#fb923c;font-size:14px;">${escapeHtml(m.marca)}</strong>
        ${m.telefonoFabrica ? `<a href="tel:${escapeHtml(m.telefonoFabrica)}" class="btn btn-green" style="padding:4px 8px;font-size:11px;text-decoration:none;">📞 ${escapeHtml(m.telefonoFabrica)}</a>` : ''}
      </div>
      <div style="font-size:12px;font-weight:700;margin-top:5px;">🔑 Reset / Menú: <span class="pin-code-highlight">${escapeHtml(m.codigosReset || 'Sin código')}</span></div>
      ${m.observaciones ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(m.observaciones)}</div>` : ''}
    </div>
  `).join('');
}

function filterMobilePins(q) {
  const lower = String(q || '').toLowerCase();
  const marcas = ((state.bootstrap && state.bootstrap.marcas) || []).filter(m =>
    m.marca.toLowerCase().includes(lower) ||
    (m.proveedor || '').toLowerCase().includes(lower) ||
    (m.codigosReset || '').toLowerCase().includes(lower)
  );
  const el = document.getElementById('mobilePinsList');
  if (el) el.innerHTML = renderMobilePinsCards(marcas);
}

async function iniciarFichajeEnTerreno(idAviso, avisoNumero, forzarApertura = false) {
  const operario = document.getElementById('mobileTechSelect').value;
  const companeroApoyo = getSelectedMobilePartnersString();

  const res = await apiFetch('/api/fichajes/iniciar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idAviso, avisoNumero, operario, companeroApoyo, forzarApertura })
  });
  const data = await res.json();

  if (res.status === 409 && data.code === 'PARTE_PREVIO_ABIERTO') {
    // Cinturón de seguridad #2: Bloqueo por parte anterior sin cerrar
    const prev = data.fichajeAbierto;
    if (confirm(`⚠️ CINTURÓN ANTI-OLVIDOS:\n\nTienes el Parte #${prev.avisoNumero} abierto desde las ${prev.inicio}.\n\n¿Quieres abrir ahora el asistente para CERRAR el Parte #${prev.avisoNumero} antes de empezar este?`)) {
      openCerrarFichajeModal(prev.idFichaje, prev.idAviso);
    }
    return;
  }

  if (data.ok) {
    await loadBootstrap();
    refreshMobileView();
    alert(`✅ Fichaje iniciado en Aviso #${avisoNumero}.\n🛰️ Geocerca de 1,0 km activada.`);
  }
}

async function cogerAvisoDeCamino(idAviso, avisoNumero) {
  await iniciarFichajeEnTerreno(idAviso, avisoNumero);
  switchMobileTab('citas');
}

// SIMULADOR DE ALEJAMIENTO > 1 KM (GEOCERCA EN VIVO CON SONIDO + MODAL ROJO)
function simulateGeofenceDeparture() {
  // Emitir pitido de alerta con Web Audio API
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {}

  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);

  const num = state.activeFichaje ? state.activeFichaje.avisoNumero : (state.selectedAviso ? state.selectedAviso.numero : 23192);
  const cli = state.activeFichaje ? state.activeFichaje.clienteNombre : (state.selectedAviso ? `${state.selectedAviso.nombreCliente} ${state.selectedAviso.apellidosCliente}` : 'Cliente en Ruta');

  document.getElementById('geofenceAlertText').innerHTML = `
    Has superado el radio de <strong>1,0 km</strong> respecto al domicilio del <strong>Aviso #${num} (${escapeHtml(cli)})</strong> y el fichaje sigue en estado <code>EN CURSO</code>.
  `;
  document.getElementById('modalGeofenceAlert').classList.add('open');
}

function closePartFromGeofenceAlert(ajustar3Min) {
  closeModal('modalGeofenceAlert');
  document.getElementById('chkAjustarSalida3Min').checked = Boolean(ajustar3Min);
  if (state.activeFichaje) {
    openCerrarFichajeModal(state.activeFichaje.idFichaje, state.activeFichaje.idAviso);
  } else if (state.selectedAviso) {
    openCerrarFichajeModal(null, state.selectedAviso.idAviso);
  } else if (state.avisos.length > 0) {
    openCerrarFichajeModal(null, state.avisos[0].idAviso);
  }
}

// =========================================================================
// ASISTENTE DE CIERRE DE PARTE (`FICHAJE` EN 3 PASOS + CALCULADORA TARIFA)
// =========================================================================
function openCerrarFichajeModal(idFichaje = null, idAviso = null) {
  const av = state.avisos.find(a => a.idAviso === idAviso) || state.selectedAviso || state.avisos[0];
  document.getElementById('closeFichajeId').value = idFichaje || (state.activeFichaje ? state.activeFichaje.idFichaje : '');
  document.getElementById('closeAvisoId').value = av ? av.idAviso : (idAviso || '');
  document.getElementById('fichajeModalTitle').textContent = av
    ? `🛠️ Cerrar Parte de Trabajo — Aviso #${av.numero} (${av.nombreCliente} ${av.apellidosCliente})`
    : `🛠️ Cerrar Parte de Trabajo SAT`;

  document.getElementById('closeNotas').value = '';
  const chk3 = document.getElementById('chkAjustarSalida3Min');
  if (chk3) chk3.checked = false;
  document.getElementById('closeMinutos').value = 45;
  document.getElementById('closeKmIdaVuelta').value = av ? (av.kmIdaVuelta || 14) : 14;
  document.getElementById('closeTipoIntervencion').value = av && av.tipoIntervencion ? av.tipoIntervencion : 'SAT NORMAL';

  if (av && av.contratoMant) {
    document.getElementById('closeCondicionCliente').value = 'CLIENTE_CM';
  } else if (av && av.clienteExistente) {
    document.getElementById('closeCondicionCliente').value = 'CLIENTE';
  } else {
    document.getElementById('closeCondicionCliente').value = 'CLIENTE';
  }

  // Reset repuestos
  state.closingRepuestos = [];
  const searchInput = document.getElementById('inputSearchRepuesto');
  if (searchInput) searchInput.value = '';
  const hiddenObj = document.getElementById('selectedRepuestoObjJson');
  if (hiddenObj) hiddenObj.value = '';
  const cantInput = document.getElementById('selectRepuestoCant');
  if (cantInput) cantInput.value = '1';
  const dd = document.getElementById('repuestosDropdownResults');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }

  state.compressedPhotoDataUrl = '';
  document.getElementById('photoCompressInfo').textContent = '';
  renderSelectedRepuestos();
  clearSignaturePad();
  recalcClosingTariff();

  document.getElementById('modalCerrarFichaje').classList.add('open');

  // Ajustar tamaño del canvas al contenedor real tras abrir el modal
  setTimeout(() => {
    const canvas = document.getElementById('signatureCanvas');
    if (canvas && canvas.parentElement) {
      const w = canvas.parentElement.clientWidth || 600;
      canvas.width = Math.max(280, Math.min(w, 800));
      canvas.height = 140;
    }
  }, 100);
}

function appendQuickNote(text) {
  const el = document.getElementById('closeNotas');
  el.value = el.value ? `${el.value}\n${text}` : text;
}

function onTratoClienteChange(val) {
  const estadoSelect = document.getElementById('closeNuevoEstadoAviso');
  if (!estadoSelect) return;
  if (val === 'MALO') {
    estadoSelect.value = 'PENDIENTE REVISAR JACOBO';
    alert('⚠️ AVISO DE SEGURIDAD:\n\nAl marcar el trato como MALO / DISCONFORME, la app frenará el volcado automático a Aliquo. El parte se cerrará para Alex pero quedará retenido con ALERTA ROJA en oficina para que Jacobo revise la incidencia.');
  } else if (val === 'BUENO' && estadoSelect.value === 'PENDIENTE REVISAR JACOBO') {
    estadoSelect.value = 'PASADO ALIQUO';
  }
}

function startVoiceDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Tu navegador no soporta dictado por voz directo. Usa el micrófono del teclado del móvil.');
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = 'es-ES';
  rec.onresult = event => {
    const transcript = event.results[0][0].transcript;
    appendQuickNote(transcript);
  };
  rec.start();
}

function handlePhotoCompress(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const origKb = Math.round(file.size / 1024);
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1000;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      state.compressedPhotoDataUrl = canvas.toDataURL('image/webp', 0.78);
      const finalKb = Math.round((state.compressedPhotoDataUrl.length * 3) / 4 / 1024);
      document.getElementById('photoCompressInfo').textContent = `✅ Foto optimizada en cliente: ${origKb} KB → ${finalKb} KB (WebP ultrarrápido)`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addRepuestoToFichaje() {
  const idx = document.getElementById('selectRepuestoPicker').value;
  if (idx === '' || !state.bootstrap) return;
  const rep = state.bootstrap.repuestos[Number(idx)];
  if (!rep) return;
  const cant = Math.max(1, Number(document.getElementById('selectRepuestoCant').value) || 1);

  state.closingRepuestos.push({
    codigo: rep.codigo,
    descripcion: rep.descripcion,
    cantidad: cant,
    pvp: rep.pvp
  });
  renderSelectedRepuestos();
  recalcClosingTariff();
}

// Búsqueda predictiva de repuestos en tiempo real
function onRepuestoSearchInput(query) {
  const dropdown = document.getElementById('repuestosDropdownResults');
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  if (!q || !state.bootstrap || !Array.isArray(state.bootstrap.repuestos)) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }
  const filtered = state.bootstrap.repuestos.filter(r =>
    (r.descripcion && r.descripcion.toLowerCase().includes(q)) ||
    (r.codigo && r.codigo.toLowerCase().includes(q))
  ).slice(0, 15);

  if (filtered.length === 0) {
    dropdown.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">Sin resultados para "${escapeHtml(query)}"</div>`;
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = filtered.map(r => `
    <div class="autocomplete-item" onclick="selectRepuestoSuggestion('${escapeHtml(r.codigo)}', '${escapeHtml(r.descripcion)}', ${Number(r.pvp || 0)})">
      <div style="font-weight:700;color:var(--text);font-size:12px;">[${escapeHtml(r.codigo)}] ${escapeHtml(r.descripcion)}</div>
      <div style="font-size:11px;color:#34d399;margin-top:2px;">PVP Oficial: ${Number(r.pvp || 0).toFixed(2)} €</div>
    </div>
  `).join('');
  dropdown.style.display = 'block';
}

function selectRepuestoSuggestion(codigo, descripcion, pvp) {
  const input = document.getElementById('inputSearchRepuesto');
  const hidden = document.getElementById('selectedRepuestoObjJson');
  const dropdown = document.getElementById('repuestosDropdownResults');

  if (input) input.value = `[${codigo}] ${descripcion}`;
  if (hidden) hidden.value = JSON.stringify({ codigo, descripcion, pvp });
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
}

function addSelectedRepuestoFromInput() {
  const hidden = document.getElementById('selectedRepuestoObjJson');
  const input = document.getElementById('inputSearchRepuesto');
  const cantInput = document.getElementById('selectRepuestoCant');
  let rep = null;

  if (hidden && hidden.value) {
    try {
      rep = JSON.parse(hidden.value);
    } catch (e) {}
  }

  if (!rep && input && input.value.trim() && state.bootstrap && Array.isArray(state.bootstrap.repuestos)) {
    const q = input.value.trim().toLowerCase();
    rep = state.bootstrap.repuestos.find(r =>
      (r.descripcion && r.descripcion.toLowerCase().includes(q)) ||
      (r.codigo && r.codigo.toLowerCase().includes(q))
    );
  }

  if (!rep) {
    alert('Por favor, selecciona un repuesto del buscador predictivo.');
    return;
  }

  const cant = Math.max(1, Number(cantInput ? cantInput.value : 1) || 1);
  state.closingRepuestos.push({
    codigo: rep.codigo,
    descripcion: rep.descripcion,
    cantidad: cant,
    pvp: Number(rep.pvp || 0)
  });

  if (input) input.value = '';
  if (hidden) hidden.value = '';
  if (cantInput) cantInput.value = '1';
  const dropdown = document.getElementById('repuestosDropdownResults');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }

  renderSelectedRepuestos();
  recalcClosingTariff();
}

function removeRepuestoFromFichaje(i) {
  state.closingRepuestos.splice(i, 1);
  renderSelectedRepuestos();
  recalcClosingTariff();
}

function renderSelectedRepuestos() {
  const el = document.getElementById('selectedRepuestosList');
  if (!el) return;
  if (state.closingRepuestos.length === 0) {
    el.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">Sin repuestos añadidos en esta intervención.</div>`;
    return;
  }
  el.innerHTML = state.closingRepuestos.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-card);border:1px solid var(--border);padding:6px 10px;border-radius:6px;margin-bottom:4px;font-size:12px;">
      <span><strong>${r.cantidad}x [${escapeHtml(r.codigo)}]</strong> ${escapeHtml(r.descripcion)}</span>
      <span>
        <strong style="color:#34d399;margin-right:8px;">${(r.cantidad * r.pvp).toFixed(2)} €</strong>
        <button type="button" class="btn btn-red" style="padding:2px 6px;font-size:10px;" onclick="removeRepuestoFromFichaje(${i})">✕</button>
      </span>
    </div>
  `).join('');
}

async function recalcClosingTariff() {
  const avId = document.getElementById('closeAvisoId') ? document.getElementById('closeAvisoId').value : '';
  const av = state.avisos.find(a => a.idAviso === avId) || state.selectedAviso;
  const minutosTrabajados = Number(document.getElementById('closeMinutos') ? document.getElementById('closeMinutos').value : 45);
  const kmIdaVuelta = Number(document.getElementById('closeKmIdaVuelta') ? document.getElementById('closeKmIdaVuelta').value : 14);
  const tipoIntervencion = document.getElementById('closeTipoIntervencion') ? document.getElementById('closeTipoIntervencion').value : 'SAT NORMAL';
  const cond = document.getElementById('closeCondicionCliente') ? document.getElementById('closeCondicionCliente').value : 'CLIENTE';

  const payload = {
    temporada: state.activeTariffYear || '2026',
    tipoIntervencion,
    tipoAparato: av ? av.tipoAparato : 'PELLET AIRE',
    esCliente: cond !== 'NO_CLIENTE',
    tieneContratoMant: cond === 'CLIENTE_CM',
    minutosTrabajados,
    kmIdaVuelta,
    repuestosSeleccionados: state.closingRepuestos
  };

  try {
    const res = await apiFetch('/api/calcular-tarifa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) return;
    const d = data.desglose;
    state.lastTariffBreakdown = d;

    const impInput = document.getElementById('closeImporteFinal');
    if (impInput) impInput.value = d.total.toFixed(2);

    const metodoSelect = document.getElementById('closeMetodoPago');
    if (metodoSelect) {
      if (tipoIntervencion.includes('EJEC. CONT. MANT')) metodoSelect.value = 'ABONADO PREVIAMENTE';
      else if (tipoIntervencion.includes('GARANTÍA')) metodoSelect.value = 'EN GARANTÍA, SIN COSTE';
    }

    const bdEl = document.getElementById('closingTariffBreakdown');
    if (bdEl) {
      bdEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
          <span><strong>Regla Aplicada:</strong> ${escapeHtml(d.notaRegla)}</span>
          <strong style="color:#fb923c;font-size:14px;">Total Calculado: ${d.total.toFixed(2)} €</strong>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;color:var(--text-muted);font-size:11px;">
          ${d.costeTarifaFija > 0 ? `<span>Tarifa Servicio: <strong>${d.costeTarifaFija.toFixed(2)} €</strong></span>` : ''}
          ${d.costeSalida > 0 ? `<span>Salida (incl. 30 km): <strong>${d.costeSalida.toFixed(2)} €</strong></span>` : ''}
          ${d.costeManoObra > 0 ? `<span>Mano de Obra (${d.minutosTrabajados} min): <strong>${d.costeManoObra.toFixed(2)} €</strong></span>` : ''}
          <span>Km Extra (${d.kmExtra} km > 30 km): <strong>${d.costeKmExtra.toFixed(2)} €</strong></span>
          <span>Repuestos (${d.repuestosDetalle.length}): <strong>${d.costeRepuestos.toFixed(2)} €</strong></span>
        </div>
      `;
    }
  } catch (e) {}
}

async function submitCerrarFichaje() {
  const idFichaje = document.getElementById('closeFichajeId').value;
  const idAviso = document.getElementById('closeAvisoId').value;
  const notas = document.getElementById('closeNotas').value.trim();
  if (!notas) {
    alert('Por favor, escribe o dicta una breve nota del trabajo realizado en el Paso 1.');
    return;
  }

  const canvas = document.getElementById('signatureCanvas');
  const firmaDataUrl = canvas ? canvas.toDataURL('image/png') : '';

  const payload = {
    idFichaje,
    idAviso,
    operario: document.getElementById('mobileTechSelect') ? document.getElementById('mobileTechSelect').value : 'jacobo.bazamazano@gmail.com',
    companeroApoyo: getSelectedMobilePartnersString(),
    minutosTrabajados: Number(document.getElementById('closeMinutos').value) || 45,
    kmIdaVuelta: Number(document.getElementById('closeKmIdaVuelta').value) || 14,
    tipoIntervencion: document.getElementById('closeTipoIntervencion') ? document.getElementById('closeTipoIntervencion').value : 'SAT NORMAL',
    condicionCliente: document.getElementById('closeCondicionCliente') ? document.getElementById('closeCondicionCliente').value : 'CLIENTE',
    importe: Number(document.getElementById('closeImporteFinal').value) || 0,
    metodoPago: document.getElementById('closeMetodoPago').value,
    tratoCliente: document.getElementById('closeTratoCliente').value,
    nuevoEstadoAviso: document.getElementById('closeNuevoEstadoAviso').value,
    ajustarSalida3MinAntes: document.getElementById('chkAjustarSalida3Min').checked,
    notas,
    repuestosUsados: state.closingRepuestos,
    desgloseTarifa: state.lastTariffBreakdown,
    firma: firmaDataUrl,
    fotoAdjuntar: state.compressedPhotoDataUrl
  };

  const res = await apiFetch('/api/fichajes/cerrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    closeModal('modalCerrarFichaje');
    await loadBootstrap();
    await loadAvisosList();
    if (state.role === 'tecnico') refreshMobileView();
    if (state.role === 'admin') renderAdminView();

    if (data.albaran) {
      alert(`📦 PARTE CERRADO Y PREPARADO PARA ALIQUO:\n\n• Ref. Albarán Cola SAT: ${data.albaran.idAlbaran}\n• Cliente: ${data.albaran.clienteNombre}\n• Total: ${Number(data.albaran.totalImporte).toFixed(2)} €\n• Líneas: ${data.albaran.lineas.length}\n\nQueda en cola local SAT para su revisión/volcado en Aliquo.`);
    }

    if (confirm(`✅ ¡Parte cerrado correctamente y volcado al Aviso #${data.aviso ? data.aviso.numero : ''}!\n\n¿Deseas abrir el Parte de Trabajo Oficial en PDF para imprimir o enviar al cliente?`)) {
      window.open(withAuthToken(`/api/parte-pdf/${data.fichaje.idFichaje}`), '_blank');
    }

    if (payload.tratoCliente === 'BUENO' && data.aviso) {
      openGoogleReviewModal(data.aviso, payload.operario);
    }
  }
}

function openGoogleReviewModal(aviso, operarioEmail) {
  const reviewUrl = (state.bootstrap && state.bootstrap.googleReviewUrl) || 'https://g.page/r/CeTJ0YmzOC_AEAE/review';
  const techShort = String(operarioEmail || '').split('@')[0].split('.')[0];
  const techName = techShort ? techShort.charAt(0).toUpperCase() + techShort.slice(1) : 'nuestro equipo';
  const firstName = String(aviso.nombreCliente || '').trim().split(/\s+/)[0];
  const greetingName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : '';

  document.getElementById('revTelefono').value = aviso.telefono1 || '';
  document.getElementById('revEmail').value = aviso.email || '';
  document.getElementById('revMensajeTexto').value =
    `¡Hola${greetingName ? ` ${greetingName}` : ''}! Soy ${techName} del equipo técnico de Baza Mazano 👋\n\n` +
    `Ha sido un placer atenderte hoy.\n` +
    `Si ha quedado todo perfecto con nuestro servicio, *¿nos echas una mano con una valoración rápida en Google?*\n` +
    `*Solo son 20 segundos* y, como empresa local, tus palabras nos ayudan muchísimo a seguir mejorando:\n\n` +
    `⭐ ${reviewUrl}\n\n` +
    `¡Mil gracias de parte de todo el equipo!`;
  document.getElementById('modalResenaGoogle').classList.add('open');
}

function sendGoogleReviewWhatsapp() {
  const tel = String(document.getElementById('revTelefono').value || '').replace(/\D/g, '');
  const msg = document.getElementById('revMensajeTexto').value;
  const cleanPhone = tel.startsWith('34') ? tel : (tel.length === 9 ? `34${tel}` : tel);
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  closeModal('modalResenaGoogle');
}

function sendGoogleReviewEmail() {
  const email = document.getElementById('revEmail').value || '';
  const msg = document.getElementById('revMensajeTexto').value;
  window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('¿Qué tal el servicio técnico de Baza Mazano?')}&body=${encodeURIComponent(msg)}`, '_blank');
  closeModal('modalResenaGoogle');
}

// =========================================================================
// ROL 3: PANEL ADMINISTRACIÓN, FLOTA Y CONTRATOS CM (SILVIA Y LIDIA)
// =========================================================================
function renderAdminKpis() {
  const el = document.getElementById('adminKpiStrip');
  if (!el || !state.bootstrap) return;
  const k = state.bootstrap.kpis;
  const totalGastosFlota = (state.bootstrap.gastosVehiculos || []).reduce((s, g) => s + (Number(g.importe) || 0), 0);

  el.innerHTML = `
    <div class="kpi-card" onclick="switchAdminTab('aliquo')">
      <div class="label"><span>🟣 Pendientes Pasar a Aliquo</span><span>Facturación</span></div>
      <div class="val" style="color:#c084fc;">${k.pasarAliquo}</div>
    </div>
    <div class="kpi-card" onclick="switchAdminTab('contratos')">
      <div class="label"><span>🛡️ Contratos CM26 / CM27</span><span>Total Activos</span></div>
      <div class="val" style="color:#34d399;">${k.contratosCmTotal}</div>
    </div>
    <div class="kpi-card" onclick="switchAdminTab('contratos')">
      <div class="label"><span>⚡ CM Pendientes Activar</span><span>1-Clic a Avisos</span></div>
      <div class="val" style="color:#fb923c;">${k.contratosCmPendientes}</div>
    </div>
    <div class="kpi-card" onclick="switchAdminTab('flota')">
      <div class="label"><span>🚐 Flota (8 Vehículos)</span><span>Gasto Acumulado</span></div>
      <div class="val" style="color:#60a5fa;">${totalGastosFlota.toFixed(0)} €</div>
    </div>
  `;
}

function switchAdminTab(tab) {
  state.adminTab = tab;
  document.getElementById('adminTabAliquo').classList.toggle('active', tab === 'aliquo');
  document.getElementById('adminTabContratos').classList.toggle('active', tab === 'contratos');
  document.getElementById('adminTabFlota').classList.toggle('active', tab === 'flota');
  const histTab = document.getElementById('adminTabHistorico');
  if (histTab) histTab.classList.toggle('active', tab === 'historico');
  const rentTab = document.getElementById('adminTabRentabilidad');
  if (rentTab) rentTab.classList.toggle('active', tab === 'rentabilidad');

  document.getElementById('adminSectionAliquo').style.display = tab === 'aliquo' ? 'block' : 'none';
  document.getElementById('adminSectionContratos').style.display = tab === 'contratos' ? 'block' : 'none';
  document.getElementById('adminSectionFlota').style.display = tab === 'flota' ? 'block' : 'none';
  const histSec = document.getElementById('adminSectionHistorico');
  if (histSec) histSec.style.display = tab === 'historico' ? 'block' : 'none';
  const rentSec = document.getElementById('adminSectionRentabilidad');
  if (rentSec) rentSec.style.display = tab === 'rentabilidad' ? 'block' : 'none';

  renderAdminView();
}

async function renderAdminView() {
  renderAdminKpis();
  if (state.adminTab === 'aliquo') {
    const res = await apiFetch('/api/avisos?estado=FINALIZADO,%20PASAR%20ALIQUO&limit=150');
    const data = await res.json();
    const list = data.avisos || [];
    const el = document.getElementById('adminSectionAliquo');

    el.innerHTML = `
      <div class="panel">
        <div class="panel-header" style="flex-wrap:wrap;gap:10px;">
          <h2>🧾 Bandeja de Facturación y Cierre en Aliquo (` + '`FINALIZADO, PASAR ALIQUO`' + `)</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="badge badge-purple">${list.length} partes listos para contabilizar</span>
            <a class="btn btn-ghost" style="padding:6px 12px;font-size:12px;text-decoration:none;" href="${withAuthToken('/api/admin/backup')}" download>
              💾 Descargar Backup DB (.json)
            </a>
          </div>
        </div>
        <div class="panel-body" style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nº Aviso</th>
                <th>Código Aliquo / Cliente</th>
                <th>Municipio</th>
                <th>Intervención / Máquina</th>
                <th>Resumen Estructurado de Partes y Repuestos</th>
                <th>Importe Total</th>
                <th>Acciones Silvia / Lidia</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(a => `
                <tr>
                  <td><strong style="color:#fb923c;">#${a.numero}</strong></td>
                  <td>
                    <strong>${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}</strong><br>
                    <span class="badge badge-blue">${escapeHtml(a.codigoCliente || 'NO ES CLIENTE')}</span>
                  </td>
                  <td>${escapeHtml(a.poblacion)} (${a.kmIdaVuelta || 14} km)</td>
                  <td>${escapeHtml(a.tipoIntervencion)}<br><small style="color:var(--text-muted);">${escapeHtml(a.marca)} ${escapeHtml(a.modelo)}</small></td>
                  <td style="max-width:380px;white-space:pre-wrap;font-size:12px;color:var(--text);line-height:1.45;">${escapeHtml(a.notasFichajes || a.observaciones)}</td>
                  <td><strong style="font-size:15px;color:#10b981;">${Number(a.sumaImportes || 0).toFixed(2)} €</strong></td>
                  <td style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-ghost" style="padding:5px 9px;font-size:11px;" onclick="copyAliquoLine(${a.numero}, '${escapeHtml(a.codigoCliente)}', '${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}', ${Number(a.sumaImportes || 0)})">
                      📋 Copiar Concepto Aliquo
                    </button>
                    <a class="btn btn-ghost" style="padding:5px 9px;font-size:11px;text-decoration:none;" href="${withAuthToken(`/api/parte-pdf/${a.idAviso}`)}" target="_blank">
                      🖨️ PDF
                    </a>
                    <button class="btn btn-green" style="padding:5px 9px;font-size:11px;" onclick="volcarAlbaranDirectoAliquo('${a.idAviso}', ${a.numero})">
                      📦 Preparar Albarán Aliquo
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (state.adminTab === 'contratos') {
    const res = await apiFetch('/api/contratos-cm');
    const data = await res.json();
    const contratos = data.contratos || [];
    const pendientes = contratos.filter(c => !c.pasadoAAvisos);
    const activados = contratos.filter(c => c.pasadoAAvisos);
    const totalSuma = contratos.reduce((sum, c) => sum + (Number(c.cuotaAnual2026) || 175), 0);
    const el = document.getElementById('adminSectionContratos');

    if (typeof state.contratosFilter === 'undefined') state.contratosFilter = 'TODOS';
    if (typeof state.contratosSearch === 'undefined') state.contratosSearch = '';

    const filter = state.contratosFilter;
    const search = (state.contratosSearch || '').toLowerCase().trim();

    let displayList = contratos;
    if (filter === 'PENDIENTES') displayList = pendientes;
    if (filter === 'ACTIVADOS') displayList = activados;

    if (search) {
      displayList = displayList.filter(c =>
        (c.nombreCliente && c.nombreCliente.toLowerCase().includes(search)) ||
        (c.apellidosCliente && c.apellidosCliente.toLowerCase().includes(search)) ||
        (c.direccionCompleta && c.direccionCompleta.toLowerCase().includes(search)) ||
        (c.poblacion && c.poblacion.toLowerCase().includes(search)) ||
        (c.codigoCliente && c.codigoCliente.toLowerCase().includes(search)) ||
        (c.marca && c.marca.toLowerCase().includes(search)) ||
        (c.modelo && c.modelo.toLowerCase().includes(search)) ||
        (String(c.numeroSlot).includes(search))
      );
    }

    el.innerHTML = `
      <!-- TOP KPIS REMESA SANTANDER Y CONTRATOS CM -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:16px;">
        <div class="panel" style="padding:14px;border-left:4px solid #ef4444;">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">🏦 BANCO SANTANDER · REMESA SEPA</div>
          <div style="font-size:22px;font-weight:900;color:#ef4444;margin:6px 0;">${totalSuma.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</div>
          <div style="font-size:11px;color:var(--text-muted);">ES82 0075 5814 · Norma 19 (XML)</div>
        </div>
        <div class="panel" style="padding:14px;border-left:4px solid #3b82f6;">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">🛡️ CONTRATOS EN CARTERA</div>
          <div style="font-size:22px;font-weight:900;color:#3b82f6;margin:6px 0;">${contratos.length}</div>
          <div style="font-size:11px;color:var(--text-muted);">Campaña Anual (175€ Aire / 210€ Agua)</div>
        </div>
        <div class="panel" style="padding:14px;border-left:4px solid #f59e0b;">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">⏳ PENDIENTES ACTIVAR EN RUTA</div>
          <div style="font-size:22px;font-weight:900;color:#f59e0b;margin:6px 0;">${pendientes.length}</div>
          <div style="font-size:11px;color:var(--text-muted);">Listos para generar parte 0€</div>
        </div>
        <div class="panel" style="padding:14px;border-left:4px solid #10b981;">
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;">✅ ACTIVADOS EN MAPA / AVISOS</div>
          <div style="font-size:22px;font-weight:900;color:#10b981;margin:6px 0;">${activados.length}</div>
          <div style="font-size:11px;color:var(--text-muted);">Visibles para Alex, Jacobo y técnicos</div>
        </div>
      </div>

      <!-- PANEL DE CONTROL SANTANDER: GENERACIÓN SEPA XML Y CONFIRMACIÓN MASIVA -->
      <div class="santander-banner">
        <div class="panel-header" style="flex-wrap:wrap;gap:12px;background:transparent;border-bottom:none;padding:0;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="badge" style="background:#dc2626;color:#ffffff;font-weight:800;letter-spacing:0.5px;">🏦 BANCO SANTANDER</span>
              <h2 class="santander-title">Remesa Bancaria SEPA Santander (Norma 19 / pain.008.001.02 XML)</h2>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.4;">
              Genera el fichero bancario XML estándar ISO 20022 para cargar en la banca online del <strong>Banco Santander</strong> (Cuenta Baza Mazano S.L.: <code>ES82 0075 5814 7806 0135 3513</code> · CIF: <code>B-47312376</code>). Sustituye la hoja puente <code>TRANSITO CM26 A AVISOS</code>.
            </p>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <a href="${withAuthToken('/api/contratos-cm/descargar-remesa-sepa')}" download="REMESA_SEPA_CM2026_BAZA_MAZANO.xml" class="btn btn-primary" style="background:#dc2626;border-color:#b91c1c;padding:10px 16px;font-size:12px;" title="Descargar fichero bancario XML para subir al Banco Santander">
              📥 Descargar XML SEPA Santander (${totalSuma.toLocaleString('es-ES', { minimumFractionDigits: 0 })} €)
            </a>
            <button class="btn btn-green" style="padding:10px 16px;font-size:12px;" onclick="confirmarRemesaMasiva(${pendientes.length})">
              ⚡ Confirmar Remesa Cobrada y Activar ${pendientes.length} Avisos en Ruta
            </button>
          </div>
        </div>
      </div>

      <!-- TABLA DE CONTRATOS CON FILTROS Y BÚSQUEDA RÁPIDA -->
      <div class="panel">
        <div class="panel-header" style="flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <h2>🛡️ Cartera de Contratos CM (${displayList.length})</h2>
            <div class="tab-pills" style="margin-left:8px;">
              <button class="tab-pill ${filter === 'TODOS' ? 'active' : ''}" onclick="setContratosFilter('TODOS')">Todos (${contratos.length})</button>
              <button class="tab-pill ${filter === 'PENDIENTES' ? 'active' : ''}" onclick="setContratosFilter('PENDIENTES')">Pendientes (${pendientes.length})</button>
              <button class="tab-pill ${filter === 'ACTIVADOS' ? 'active' : ''}" onclick="setContratosFilter('ACTIVADOS')">En Avisos (${activados.length})</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="contratosSearchInput" placeholder="🔍 Buscar cliente, código, calle, pueblo..." value="${escapeHtml(state.contratosSearch || '')}" oninput="onContratosSearch(this.value)" style="width:260px;padding:7px 12px;font-size:12px;" />
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px;" onclick="activarLoteContratosCm()">🚀 Activar Lote de 5</button>
          </div>
        </div>
        <div class="panel-body" style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Slot CM</th>
                <th>Cód. Cliente</th>
                <th>Cliente</th>
                <th>Dirección / Municipio</th>
                <th>Máquina</th>
                <th>Alcance</th>
                <th>Cuota Anual</th>
                <th>Estado Banco / SAT</th>
                <th>Acción 1-Clic</th>
              </tr>
            </thead>
            <tbody>
              ${displayList.length === 0 ? `
                <tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">No se encontraron contratos con el filtro seleccionado.</td></tr>
              ` : displayList.slice(0, 100).map(c => `
                <tr>
                  <td><strong>#${c.numeroSlot}</strong></td>
                  <td><span class="badge badge-blue">${escapeHtml(c.codigoCliente || 'CM')}</span></td>
                  <td><strong>${escapeHtml(c.nombreCliente)} ${escapeHtml(c.apellidosCliente)}</strong></td>
                  <td>${escapeHtml(c.direccionCompleta)} (${c.kmIdaVuelta || 12} km I/V)</td>
                  <td>${escapeHtml(c.tipoAparato)} · <strong>${escapeHtml(c.marca)}</strong> ${escapeHtml(c.modelo)}</td>
                  <td><span class="badge badge-orange">${escapeHtml(c.alcance)}</span></td>
                  <td><strong>${c.cuotaAnual2026} €</strong></td>
                  <td>${c.pasadoAAvisos ? `<span class="badge badge-green">✅ EN AVISOS ${c.avisoGeneradoNumero ? '#' + c.avisoGeneradoNumero : ''}</span>` : `<span class="badge badge-amber">⏳ PENDIENTE ACTIVAR</span>`}</td>
                  <td>
                    ${c.pasadoAAvisos
                      ? `<span style="font-size:11px;color:#34d399;font-weight:700;">🟢 En ruta (0€)</span>`
                      : `<button class="btn btn-green" style="padding:5px 10px;font-size:11px;" onclick="activarContratoCmIndividual('${c.idContrato}')">⚡ Generar Aviso CM (0€)</button>`
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${displayList.length > 100 ? `<div style="text-align:center;padding:10px;font-size:11px;color:var(--text-muted);">Mostrando primeros 100 de ${displayList.length} contratos. Utiliza el buscador para afinar.</div>` : ''}
        </div>
      </div>
    `;
  } else if (state.adminTab === 'flota') {
    const gastos = (state.bootstrap && state.bootstrap.gastosVehiculos) || [];
    const vehiculos = (state.bootstrap && state.bootstrap.vehiculos) || [
      '7206GDH - OPEL VIVARO COM6',
      '0986FVB - MERCEDES SPRINTER 300 EXTRALARGA',
      '9390HSV - DACIA DOKKER 1.5DCI',
      '6572KPN - MERCEDES SPRINTER FURGON 311CDI',
      '6772LPF - HONDA FORZA 750 (MOTO)',
      '5823NBT - RENAULT RAFALE 1.2 E-TECH PHEV',
      '4037NJX - RENAULT TRAFIC L1H1 BLUEDCI 130',
      '9851MFL - RENAULT KANGOO E-TECH EV45'
    ];
    const resumenPorFurgo = vehiculos.map(v => {
      const clave = v.split(' ')[0];
      const regs = gastos.filter(g => String(g.vehiculo || '').includes(clave));
      const total = regs.reduce((s, r) => s + (Number(r.importe) || 0), 0);
      const maxKm = regs.reduce((m, r) => (r.kms > m ? r.kms : m), 0);
      return { nombre: v, count: regs.length, total, maxKm };
    });
    const todayStr = new Date().toISOString().slice(0, 10);

    const el = document.getElementById('adminSectionFlota');
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(210px, 1fr));gap:12px;margin-bottom:16px;">
        ${resumenPorFurgo.map(f => `
          <div class="panel" style="padding:14px;">
            <div style="font-size:11px;color:var(--text-muted);font-weight:700;">🚐 ${escapeHtml(f.nombre)}</div>
            <div style="font-size:22px;font-weight:900;color:#fb923c;margin:6px 0;">${f.total.toFixed(2)} €</div>
            <div style="font-size:11px;color:var(--text-muted);">${f.count} repostajes/gastos · Último Km: ${f.maxKm || 'N/D'}</div>
          </div>
        `).join('')}
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>⛽ Registro Histórico y Alta de Repostajes / Gastos (8 Vehículos + Ticket)</h2>
        </div>
        <div class="panel-body">
          <form onsubmit="submitNuevoGastoVehiculo(event)" class="flota-form-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;background:var(--bg-surface);padding:12px;border-radius:10px;border:1px solid var(--border);">
            <input type="date" id="gvFecha" value="${todayStr}" required title="Fecha del ticket" />
            <select id="gvOperario" required title="Operario que realiza el repostaje">
              <option value="JACOBO">🔵 JACOBO</option>
              <option value="ALEX">🟢 ALEX</option>
              <option value="DIONI">🟠 DIONI</option>
              <option value="ROBERTO">🟣 ROBERTO</option>
              <option value="ISMA">🟡 ISMA</option>
              <option value="LEANDRO">👔 LEANDRO</option>
              <option value="OFICINA">🏢 OFICINA</option>
            </select>
            <select id="gvVehiculo" required>
              ${vehiculos.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
            </select>
            <select id="gvConcepto">
              <option value="GASOIL">⛽ GASOIL / GASOLINA</option>
              <option value="TALLER / MANTENIMIENTO">🔧 TALLER / MANTENIMIENTO</option>
              <option value="ITV / SEGURO">📄 ITV / SEGURO</option>
            </select>
            <input type="number" id="gvKms" placeholder="Kilómetros marcador" required />
            <input type="number" step="0.01" id="gvImporte" placeholder="Importe (€)" required />
            <label class="btn btn-ghost" style="cursor:pointer;justify-content:center;font-size:12px;">
              📸 Foto Ticket
              <input type="file" accept="image/*" style="display:none;" onchange="handleFlotaTicketCompress(event)" />
            </label>
            <button type="submit" class="btn btn-primary">➕ Registrar Ticket</button>
          </form>
          <div id="flotaPhotoInfo" style="font-size:11px;color:#34d399;margin:-8px 0 12px 2px;"></div>

          <table class="data-table">
            <thead>
              <tr><th>Fecha</th><th>Operario</th><th>Vehículo</th><th>Concepto</th><th>Kilómetros</th><th>Importe</th><th>Ticket</th><th>Observaciones</th></tr>
            </thead>
            <tbody>
              ${gastos.slice(0, 60).map(g => `
                <tr>
                  <td>${escapeHtml(formatDateES(g.fecha))}</td>
                  <td><span class="badge badge-amber">${escapeHtml(g.operario || 'N/D')}</span></td>
                  <td><strong>${escapeHtml(g.vehiculo)}</strong></td>
                  <td><span class="badge badge-blue">${escapeHtml(g.tipoGasto)}</span></td>
                  <td>${g.kms || '-'} km</td>
                  <td><strong style="color:#fb923c;">${Number(g.importe || 0).toFixed(2)} €</strong></td>
                  <td>${g.fotoTicket ? `<a href="${withAuthToken(g.fotoTicket)}" target="_blank" class="badge badge-green" style="text-decoration:none;">📎 Ver Ticket</a>` : '-'}</td>
                  <td>${escapeHtml(g.observaciones || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (state.adminTab === 'historico') {
    await renderHistoricoAdminSection();
  } else if (state.adminTab === 'rentabilidad') {
    await renderRentabilidadAdminSection();
  }
}

function copyAliquoLine(numero, codigo, cliente, importe) {
  const txt = `PARTE SAT #${numero} | CLI: ${codigo} (${cliente}) | IMPORTE: ${Number(importe).toFixed(2)} EUR`;
  navigator.clipboard.writeText(txt);
  alert(`📋 Copiado al portapapeles para pegar en Aliquo:\n\n${txt}`);
}

async function markAsPasadoAliquo(idAviso) {
  await quickUpdateAviso(idAviso, { estadoAviso: 'PASADO ALIQUO' });
  renderAdminView();
}

async function volcarAlbaranDirectoAliquo(idAviso, numero) {
  await openVolcadoAliquoModal(idAviso, numero);
}

async function openVolcadoAliquoModal(idAviso, numero, customSerial = '') {
  const modal = document.getElementById('modalVolcadoAliquo');
  const titleEl = document.getElementById('aliquoPreviewTitle');
  const bodyEl = document.getElementById('aliquoPreviewBody');
  if (!modal || !bodyEl) return;

  if (titleEl) titleEl.textContent = `🚀 Vista Previa Volcado Real a Aliquo — Aviso #${numero || idAviso}`;
  bodyEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">Consultando cliente y líneas en Aliquo API...</div>';
  modal.classList.add('open');

  try {
    const qs = new URLSearchParams({ idAviso: String(idAviso || numero) });
    if (customSerial) qs.set('serialCode', customSerial);
    const res = await apiFetch(`/api/aliquo/preview-volcado?${qs}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      bodyEl.innerHTML = `<div style="padding:18px;color:#fca5a5;">❌ ${escapeHtml(data.error || 'Error cargando vista previa')}</div>`;
      return;
    }
    const p = data.preview;
    const lines = (p.notePayload && p.notePayload.lines) || [];

    bodyEl.innerHTML = `
      ${p.yaVolcadoReal ? `
        <div style="background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;color:#fecaca;">
          ⚠️ <strong>ATENCIÓN (Anti-duplicados):</strong> Este aviso ya fue volcado a Aliquo como <strong>${escapeHtml(p.aliquoDocPrevio || String(p.aliquoIdNotaPrevio || ''))}</strong>.
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;padding:12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;">
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Cliente en Aliquo</div>
          <div style="font-size:14px;font-weight:800;margin-top:2px;">[${escapeHtml(p.clienteCodigo)}] ${escapeHtml(p.clienteNombre)}</div>
          <div style="margin-top:4px;">
            ${p.clienteExisteEnAliquo
              ? '<span class="badge badge-green">✅ Cliente existente en Aliquo</span>'
              : '<span class="badge badge-amber">🆕 Pre-Alta — Se creará en Clientes de Aliquo</span>'}
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;display:block;margin-bottom:4px;">Serie de Albarán Aliquo (Editable)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" id="aliquoSerialInput" value="${escapeHtml(p.serialCode)}" style="width:110px;font-weight:800;text-transform:uppercase;" />
            <span class="badge badge-blue">Almacén: Alm · IVA Inc.</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Total Albarán: <strong style="color:#34d399;font-size:13px;">${Number(p.totalImporte).toFixed(2)} €</strong></div>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:800;color:#fb923c;margin-bottom:6px;">📦 Líneas que entrarán en el Albarán (SalesDeliveryNote)</div>
        <table class="data-table">
          <thead>
            <tr><th>Código</th><th>Concepto</th><th style="text-align:right;">Uds</th><th style="text-align:right;">PVP (IVA inc.)</th><th style="text-align:right;">Subtotal</th></tr>
          </thead>
          <tbody>
            ${lines.map(l => `
              <tr>
                <td><span class="badge badge-blue">${escapeHtml(l.code)}</span></td>
                <td>${escapeHtml(l.name)}</td>
                <td style="text-align:right;">${Number(l.quantity)}</td>
                <td style="text-align:right;">${Number(l.retailPrice).toFixed(2)} €</td>
                <td style="text-align:right;"><strong>${(Number(l.quantity) * Number(l.retailPrice)).toFixed(2)} €</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:800;color:#38bdf8;display:block;margin-bottom:4px;">📋 Bloque que se añadirá al campo "Varios" (Observaciones) sin borrar historial previo:</label>
        <textarea id="aliquoBloqueVariosInput" rows="4" style="width:100%;font-size:12px;font-family:inherit;">${escapeHtml(p.bloqueAnexarVarios)}</textarea>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:12px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="aliquoChkActualizarVarios" checked />
            Actualizar campo "Varios" en ficha del cliente
          </label>
          ${!p.clienteExisteEnAliquo ? `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="aliquoChkCrearCliente" checked />
              Crear cliente nuevo en Aliquo
            </label>
          ` : ''}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--border);">
        <button type="button" class="btn btn-ghost" onclick="confirmarVolcadoAliquo('${escapeHtml(p.idAviso)}', ${p.numero}, false)">
          💾 Solo marcar local (sin enviar a Aliquo)
        </button>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-ghost" onclick="closeModal('modalVolcadoAliquo')">Cancelar</button>
          <button type="button" class="btn btn-green" id="btnConfirmarVolcadoReal" ${p.yaVolcadoReal ? 'disabled' : ''} onclick="confirmarVolcadoAliquo('${escapeHtml(p.idAviso)}', ${p.numero}, true)">
            🚀 Confirmar y Volcar REAL a Aliquo API
          </button>
        </div>
      </div>
    `;
  } catch (e) {
    bodyEl.innerHTML = `<div style="padding:18px;color:#fca5a5;">❌ Error de conexión: ${escapeHtml(e.message)}</div>`;
  }
}

async function confirmarVolcadoAliquo(idAviso, numero, modoReal) {
  if (modoReal) {
    const ok = confirm(`¿Confirmas crear el Albarán REAL en Aliquo ERP para el Aviso #${numero}?`);
    if (!ok) return;
  }
  const btn = document.getElementById('btnConfirmarVolcadoReal');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Volcando a Aliquo...'; }

  const serialCode = (document.getElementById('aliquoSerialInput')?.value || '').trim().toUpperCase();
  const bloqueAnexarVarios = document.getElementById('aliquoBloqueVariosInput')?.value || '';
  const actualizarVarios = Boolean(document.getElementById('aliquoChkActualizarVarios')?.checked);
  const crearClienteSiNoExiste = document.getElementById('aliquoChkCrearCliente')
    ? Boolean(document.getElementById('aliquoChkCrearCliente').checked)
    : false;

  try {
    const res = await apiFetch('/api/aliquo/volcar-albaran', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idAviso,
        numero,
        modoReal: Boolean(modoReal),
        serialCode,
        bloqueAnexarVarios,
        actualizarVarios,
        crearClienteSiNoExiste
      })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      closeModal('modalVolcadoAliquo');
      if (data.modoReal) {
        alert(
          `✅ ALBARÁN REAL CREADO EN ALIQUO ERP\n\n` +
          `• Documento Aliquo: ${data.aliquoDoc} (ID #${data.aliquoIdNota || '-'})\n` +
          `• Cliente creado: ${data.clienteCreadoReal ? 'SÍ (Alta en Clientes)' : 'Ya existía'}\n` +
          `• Campo "Varios" actualizado: ${data.variosActualizado ? 'SÍ (Oficina + Técnico)' : ('NO' + (data.variosError ? ' — ' + data.variosError : ''))}`
        );
      } else {
        alert(`💾 Marcado en local como [PASADO ALIQUO] (Ref: ${data.albaran.idAlbaran}) sin enviar a Aliquo API.`);
      }
      await loadAvisosList();
      renderAdminView();
      renderAdminKpis();
    } else {
      alert(`❌ Error en volcado Aliquo: ${data.error || 'Desconocido'}`);
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Confirmar y Volcar REAL a Aliquo API'; }
    }
  } catch (e) {
    alert(`❌ Error de conexión: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Confirmar y Volcar REAL a Aliquo API'; }
  }
}

window.openVolcadoAliquoModal = openVolcadoAliquoModal;
window.confirmarVolcadoAliquo = confirmarVolcadoAliquo;

async function activarContratoCmIndividual(idContrato) {
  const res = await apiFetch('/api/contratos-cm/activar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idContrato, anota: 'SILVIA' })
  });
  const data = await res.json();
  if (data.ok && data.avisosCreados.length > 0) {
    await loadBootstrap();
    renderAdminView();
    alert(`✅ Contrato activado: Creado Aviso #${data.avisosCreados[0].numero} (EJEC. CONT. MANT. CONTRATADO · 0€) en estado REALIZABLE.`);
  }
}

async function activarLoteContratosCm() {
  const resList = await apiFetch('/api/contratos-cm?pendientes=1');
  const dList = await resList.json();
  const ids = (dList.contratos || []).slice(0, 5).map(c => c.idContrato);
  if (ids.length === 0) {
    alert('Todos los contratos CM están ya activados en Avisos.');
    return;
  }
  const res = await apiFetch('/api/contratos-cm/activar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, anota: 'SILVIA' })
  });
  const data = await res.json();
  if (data.ok) {
    await loadBootstrap();
    renderAdminView();
    alert(`🚀 Activados ${data.activadosCount} contratos de mantenimiento y volcados a la cola REALIZABLE.`);
  }
}

async function confirmarRemesaMasiva(pendientesCount) {
  if (pendientesCount === 0) {
    alert('No hay contratos pendientes de activar. Todos los contratos CM están ya volcados en ruta.');
    return;
  }

  const confirmMsg = `¿Confirmar cobro bancario en BANCO SANTANDER y activar los ${pendientesCount} contratos de mantenimiento pendientes en el mapa?\n\n` +
    `• Se generarán los avisos tipo "EJEC. CONT. MANT. CONTRATADO" en estado REALIZABLE.\n` +
    `• Importe: 0,00 € (la cuota anual ya queda cobrada por banco).\n` +
    `• Aparecerán geolocalizados en el mapa para Alex, Jacobo y el equipo técnico.`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await apiFetch('/api/contratos-cm/confirmar-remesa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.ok) {
      await loadBootstrap();
      renderAdminView();
      alert(`🎉 ¡ÉXITO! Remesa confirmada en Banco Santander.\n\nSe han activado ${data.activadosCount} contratos de mantenimiento como avisos REALIZABLES (0 €) en la ruta de los técnicos.`);
    } else {
      alert('Error al confirmar remesa: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al comunicar con el servidor: ' + err.message);
  }
}

function setContratosFilter(filtro) {
  state.contratosFilter = filtro;
  renderAdminView();
}

function onContratosSearch(query) {
  state.contratosSearch = query;
  renderAdminView();
}

let flotaTicketDataUrl = '';
function handleFlotaTicketCompress(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1000;
      const scale = img.width > maxW ? (maxW / img.width) : 1;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      flotaTicketDataUrl = canvas.toDataURL('image/webp', 0.72);
      const info = document.getElementById('flotaPhotoInfo');
      if (info) info.textContent = `✅ Ticket comprimido (${Math.round(flotaTicketDataUrl.length / 1024)} KB) listo para subir.`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function submitNuevoGastoVehiculo(e) {
  e.preventDefault();
  const payload = {
    fecha: document.getElementById('gvFecha') ? document.getElementById('gvFecha').value : '',
    operario: document.getElementById('gvOperario') ? document.getElementById('gvOperario').value : 'OFICINA',
    vehiculo: document.getElementById('gvVehiculo').value,
    tipoGasto: document.getElementById('gvConcepto').value,
    kms: Number(document.getElementById('gvKms').value) || 0,
    importe: Number(document.getElementById('gvImporte').value) || 0,
    fotoTicket: flotaTicketDataUrl
  };
  const res = await apiFetch('/api/vehiculos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if ((await res.json()).ok) {
    flotaTicketDataUrl = '';
    await loadBootstrap();
    renderAdminView();
  }
}

// =========================================================================
// MODALES: ALTA AVISO CON AUTOCOMPLETADO ALIQUO SQL + AGENDAR CITA + WHATSAPP
// =========================================================================
function openNuevoAvisoModal() {
  document.getElementById('formNuevoAviso').reset();
  if (state.authUser) {
    const anotaSel = document.getElementById('newAnota');
    const firstWord = String(state.authUser.nombre || '').split(' ')[0].toUpperCase();
    if (anotaSel && Array.from(anotaSel.options).some(o => o.value === firstWord)) {
      anotaSel.value = firstWord;
    }
  }
  document.getElementById('newCodigoCliente').value = 'NO ES CLIENTE';
  document.getElementById('intakeSearchClient').value = '';
  document.getElementById('intakeAutocompleteList').style.display = 'none';
  const obsWrap = document.getElementById('newObservacionesAliquoWrap');
  if (obsWrap) obsWrap.style.display = 'none';
  const obsAliquo = document.getElementById('newObservacionesAliquo');
  if (obsAliquo) obsAliquo.value = '';
  const instBaza = document.getElementById('newInstalacionBaza');
  if (instBaza) instBaza.value = '';

  const banner = document.getElementById('intakeStatusBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = 'rgba(56,189,248,0.1)';
    banner.style.border = '1px solid #38bdf8';
    banner.style.color = '#38bdf8';
    banner.innerHTML = '⚡ <strong>Modo Alta Directa:</strong> Si el cliente no existe en Aliquo, se le creará automáticamente una ficha contable al guardar.';
  }

  document.getElementById('modalNuevoAviso').classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

let intakeTimer = null;
function onIntakeClientSearch(val) {
  if (intakeTimer) clearTimeout(intakeTimer);
  const box = document.getElementById('intakeAutocompleteList');
  if (!val || val.trim().length < 2) {
    box.style.display = 'none';
    return;
  }
  intakeTimer = setTimeout(async () => {
    const res = await apiFetch(`/api/sat/buscar-cliente?q=${encodeURIComponent(val)}`);
    const data = await res.json();
    if (!data.ok || !data.clientes || data.clientes.length === 0) {
      box.innerHTML = `<div class="autocomplete-item" style="color:var(--text-muted);">Sin coincidencias en catálogo Aliquo para "${escapeHtml(val)}". Se guardará pre-alta local en SAT al crear el aviso.</div>`;
      box.style.display = 'block';
      return;
    }

    state.lastIntakeClients = data.clientes;
    box.innerHTML = data.clientes.map((c, idx) => {
      const relBadge = c.relacion === 'NO ES NUESTRA'
        ? `<span class="badge badge-red" style="font-size:10px;">⚠️ NO ES DE BAZA</span>`
        : (c.relacion === 'SUMINISTRADO'
          ? `<span class="badge badge-amber" style="font-size:10px;">📦 SIN INSTALAR</span>`
          : (c.marca || c.marcaModelo || c.fechaContrato ? `<span class="badge badge-blue" style="font-size:10px;">✅ INSTALADA BAZA</span>` : ''));
      return `
      <div class="autocomplete-item" onclick="selectIntakeClient(${idx})">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <strong style="color:#fb923c;">${escapeHtml(c.nombreCompleto)} (${escapeHtml(c.codigoCliente)})</strong>
          <div style="display:flex;gap:4px;align-items:center;">
            ${relBadge}
            <span class="badge badge-green">${escapeHtml(c.origen)}</span>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.4;">
          📍 ${escapeHtml(c.direccionCompleta)} · 📞 ${escapeHtml(c.telefono1)}
          ${(c.marca || c.modelo || c.marcaModelo) ? `<br>🔥 <strong style="color:var(--text);">${escapeHtml(c.tipoAparato)} · ${escapeHtml(c.marca)} ${escapeHtml(c.modelo || c.marcaModelo)}</strong>` : ''}
          ${c.fechaContrato ? ` · 📅 <strong>Compra/Cto: ${escapeHtml(c.fechaContrato)}</strong>` : ''}
          ${c.numContrato ? ` · 📄 <strong>${escapeHtml(c.numContrato)}</strong>` : ''}
          ${c.numSerie ? ` · 🔢 <code>S/N: ${escapeHtml(c.numSerie)}</code>` : ''}
          ${c.contratoMant ? ` · <span style="color:#34d399;font-weight:700;">[🛡️ CON CONTRATO CM]</span>` : ''}
        </div>
      </div>
    `}).join('');
    box.style.display = 'block';
  }, 200);
}

function selectIntakeClient(idx) {
  const c = state.lastIntakeClients && state.lastIntakeClients[idx];
  if (!c) return;
  document.getElementById('newCodigoCliente').value = c.codigoCliente || 'CLIENTE';
  document.getElementById('newNombreCliente').value = c.nombreCliente || c.nombreCompleto || '';
  document.getElementById('newApellidosCliente').value = c.apellidosCliente || '';
  document.getElementById('newTelefono1').value = c.telefono1 || '';
  document.getElementById('newDireccionCompleta').value = c.direccionCompleta || '';
  if (c.email && document.getElementById('newEmail')) document.getElementById('newEmail').value = c.email;
  if (c.tipoAparato) document.getElementById('newTipoAparato').value = c.tipoAparato;
  document.getElementById('newMarca').value = c.marca || '';
  document.getElementById('newModelo').value = c.modelo || c.marcaModelo || '';
  if (document.getElementById('newFechaInstalacion')) {
    document.getElementById('newFechaInstalacion').value = c.fechaContrato || '';
  }
  if (document.getElementById('newDocCompra')) {
    document.getElementById('newDocCompra').value = c.numContrato || '';
  }
  if (document.getElementById('newNumSerie')) {
    document.getElementById('newNumSerie').value = c.numSerie || '';
  }
  if (document.getElementById('newRelacion')) {
    document.getElementById('newRelacion').value = c.relacion || 'INSTALADO';
  }
  if (document.getElementById('newInstalacionBaza')) {
    document.getElementById('newInstalacionBaza').value = c.instalacionBaza || '';
  }
  const obsWrap = document.getElementById('newObservacionesAliquoWrap');
  const obsTextarea = document.getElementById('newObservacionesAliquo');
  if (obsWrap && obsTextarea) {
    if (c.observacionesAliquo) {
      obsTextarea.value = c.observacionesAliquo;
      obsWrap.style.display = 'block';
    } else {
      obsTextarea.value = '';
      obsWrap.style.display = 'none';
    }
  }
  document.getElementById('newContratoMant').value = c.contratoMant ? 'true' : 'false';
  document.getElementById('intakeAutocompleteList').style.display = 'none';

  const banner = document.getElementById('intakeStatusBanner');
  if (banner) {
    banner.style.display = 'block';
    if (c.relacion === 'NO ES NUESTRA') {
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.border = '1px solid #ef4444';
      banner.style.color = '#fca5a5';
      banner.innerHTML = `⚠️ <strong>ATENCIÓN — MÁQUINA EXTERNA (NO INSTALADA POR BAZA):</strong> [${escapeHtml(c.codigoCliente)}] ${escapeHtml(c.nombreCompleto)} · ${escapeHtml(c.marca)} ${escapeHtml(c.modelo)}`;
    } else {
      banner.style.background = 'rgba(16,185,129,0.15)';
      banner.style.border = '1px solid #10b981';
      banner.style.color = '#34d399';
      const extraMeta = [
        c.fechaContrato ? `📅 Compra: <strong>${escapeHtml(c.fechaContrato)}</strong>` : '',
        c.numContrato ? `📄 Cto: <strong>${escapeHtml(c.numContrato)}</strong>` : '',
        (c.marca || c.modelo) ? `🔥 <strong>${escapeHtml(c.marca)} ${escapeHtml(c.modelo)}</strong>` : '',
        c.instalacionBaza ? `(${escapeHtml(c.instalacionBaza)})` : ''
      ].filter(Boolean).join(' · ');
      banner.innerHTML = `✅ <strong>Ficha Autocompletada del Tirón:</strong> [${escapeHtml(c.codigoCliente)}] ${escapeHtml(c.nombreCompleto)} ${extraMeta ? '<br>' + extraMeta : ''}`;
    }
  }
}

async function submitNuevoAviso(e) {
  e.preventDefault();
  const dni = document.getElementById('newDni') ? document.getElementById('newDni').value.trim() : '';
  const email = document.getElementById('newEmail') ? document.getElementById('newEmail').value.trim() : '';

  const payload = {
    codigoCliente: document.getElementById('newCodigoCliente').value,
    nombreCliente: document.getElementById('newNombreCliente').value,
    apellidosCliente: document.getElementById('newApellidosCliente').value,
    dni,
    email,
    telefono1: document.getElementById('newTelefono1').value,
    direccionCompleta: document.getElementById('newDireccionCompleta').value,
    tipoAparato: document.getElementById('newTipoAparato').value,
    marca: document.getElementById('newMarca').value,
    modelo: document.getElementById('newModelo').value,
    fechaInstalacion: document.getElementById('newFechaInstalacion') ? document.getElementById('newFechaInstalacion').value.trim() : '',
    docCompra: document.getElementById('newDocCompra') ? document.getElementById('newDocCompra').value.trim() : '',
    numSerie: document.getElementById('newNumSerie') ? document.getElementById('newNumSerie').value.trim() : '',
    relacion: document.getElementById('newRelacion') ? document.getElementById('newRelacion').value : 'INSTALADO',
    instalacionBaza: document.getElementById('newInstalacionBaza') ? document.getElementById('newInstalacionBaza').value : '',
    observacionesAliquo: document.getElementById('newObservacionesAliquo') ? document.getElementById('newObservacionesAliquo').value : '',
    tipoIntervencion: document.getElementById('newTipoIntervencion').value,
    tipoServicio: document.getElementById('newTipoServicio') ? document.getElementById('newTipoServicio').value : 'SAT',
    prioridad: document.getElementById('newPrioridad').value,
    esFuego: Boolean(document.getElementById('newEsFuego') && document.getElementById('newEsFuego').checked),
    contratoMant: document.getElementById('newContratoMant').value === 'true',
    anota: document.getElementById('newAnota').value,
    operarioPreasignado: document.getElementById('newOperarioPreasignado').value,
    observaciones: document.getElementById('newObservaciones').value,
    precioComunicado: document.getElementById('newPrecioComunicado') && document.getElementById('newPrecioComunicado').value !== '' ? Number(document.getElementById('newPrecioComunicado').value) : null,
    estadoCobroPrevio: document.getElementById('newEstadoCobroPrevio') ? document.getElementById('newEstadoCobroPrevio').value : 'PENDIENTE',
    importeAbonadoPrevio: document.getElementById('newImporteAbonadoPrevio') ? Number(document.getElementById('newImporteAbonadoPrevio').value || 0) : 0,
    metodoPagoPrevio: document.getElementById('newMetodoPagoPrevio') ? document.getElementById('newMetodoPagoPrevio').value : '',
    fechaPagoPrevio: document.getElementById('newFechaPagoPrevio') ? document.getElementById('newFechaPagoPrevio').value : '',
    checklistAccesorios: {
      tRegistro: Boolean(document.getElementById('chkAccTRegistro')?.checked),
      sombrerete: Boolean(document.getElementById('chkAccSombrerete')?.checked),
      reduccionDiametro: Boolean(document.getElementById('chkAccReduccion')?.checked),
      tomaAirePlaca: Boolean(document.getElementById('chkAccTomaAire')?.checked),
      otrosAccesorios: document.getElementById('newOtrosAccesorios') ? document.getElementById('newOtrosAccesorios').value.trim() : ''
    },
    esContratoObra: Boolean(document.getElementById('newEsContratoObra') && document.getElementById('newEsContratoObra').checked),
    modalidadLogistica: document.getElementById('newModalidadLogistica') ? document.getElementById('newModalidadLogistica').value : 'INSTALACION',
    pago50Verificado: Boolean(document.getElementById('newPago50Verificado') && document.getElementById('newPago50Verificado').checked),
    pedidoProveedorEstado: document.getElementById('newPedidoProveedorEstado') ? document.getElementById('newPedidoProveedorEstado').value : 'NO_APLICA',
    rematePendiente: Boolean(document.getElementById('newRematePendiente') && document.getElementById('newRematePendiente').checked),
    crearClienteEnAliquo: !document.getElementById('newCodigoCliente').value || document.getElementById('newCodigoCliente').value === 'NO ES CLIENTE',
    estadoAviso: 'SIN PROCESAR'
  };

  const res = await apiFetch('/api/avisos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    closeModal('modalNuevoAviso');
    await loadBootstrap();
    await loadAvisosList();
    loadBuzonAlertas();
    selectAviso(data.aviso.idAviso);

    if (data.clienteCreado) {
      alert(`📦 PRE-ALTA LOCAL REGISTRADA EN SAT:\n\n• Código Provisional SAT: ${data.clienteCreado.Codigo}\n• Nombre: ${data.clienteCreado.Nombre}\n• Aviso SAT Asociado: #${data.aviso.numero}\n\nQueda en cola de pre-alta SAT para su revisión/alta contable en Aliquo.`);
    } else {
      alert(`✅ Aviso #${data.aviso.numero} registrado y vinculado al cliente [${data.aviso.codigoCliente}] ${data.aviso.nombreCliente}.`);
    }
  }
}

function openAgendarCitaModal(idAviso = null) {
  const av = state.avisos.find(a => a.idAviso === idAviso) || state.selectedAviso || state.avisos[0];
  if (!av) return;

  document.getElementById('citaIdAviso').value = av.idAviso;
  document.getElementById('citaAvisoNumero').value = av.numero;
  document.getElementById('citaTitulo').value = `${av.numero} - ${av.tipoIntervencion} (${av.nombreCliente} ${av.apellidosCliente})`;
  document.getElementById('citaDireccion').value = av.direccionCompleta;
  document.getElementById('citaDescripcion').value = `${av.tipoAparato} ${av.marca} ${av.modelo} — ${av.observaciones}`;

  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 2);
  const startIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const endIso = new Date(now.getTime() + 3600000 - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('citaInicio').value = startIso;
  document.getElementById('citaFin').value = endIso;

  document.getElementById('modalAgendarCita').classList.add('open');
}

async function submitAgendarCita(e) {
  e.preventDefault();
  const checks = Array.from(document.querySelectorAll('input[name="citaAsistenteChk"]:checked')).map(c => c.value);
  if (checks.length === 0) {
    alert('Selecciona al menos un técnico en ASISTENTES.');
    return;
  }

  const payload = {
    idAviso: document.getElementById('citaIdAviso').value,
    avisoNumero: Number(document.getElementById('citaAvisoNumero').value),
    titulo: document.getElementById('citaTitulo').value,
    inicio: document.getElementById('citaInicio').value.replace('T', ' '),
    fin: document.getElementById('citaFin').value.replace('T', ' '),
    direccion: document.getElementById('citaDireccion').value,
    asistentes: checks,
    descripcion: document.getElementById('citaDescripcion').value
  };

  const res = await apiFetch('/api/citas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.status === 409 && data.code === 'SENAL_50_NO_VERIFICADA') {
    window._pendingCitaPayload = payload;
    const msgEl = document.getElementById('bloqueoSenal50Msg');
    if (msgEl) msgEl.textContent = data.error || 'El pago del 50% de señal no está verificado para este contrato de instalación.';
    document.getElementById('modalBloqueoSenal50').classList.add('open');
    return;
  }
  if (data.ok) {
    closeModal('modalAgendarCita');
    await loadBootstrap();
    await loadAvisosList();
    await loadCitasList();
    loadBuzonAlertas();
  } else if (data.error) {
    alert('⚠️ ' + data.error);
  }
}

// MODAL CONFIRMACIÓN CITA POR WHATSAPP (BOTÓN EXPLÍCITO Q-004)
function openConfirmarWhatsappModal(idCita, telefono, cliente, inicio, direccion) {
  document.getElementById('waCitaId').value = idCita;
  document.getElementById('waTelefono').value = telefono || '';
  document.getElementById('waMensajeTexto').value =
    `Hola ${cliente}, le escribimos del Servicio Técnico Oficial de *Baza Mazano S.L.* (Valladolid).\n\n` +
    `Le confirmamos su cita técnica para el día *${inicio}* en *${direccion}*.\n\n` +
    `Por favor, responda *OK* a este mensaje para confirmar que habrá alguien en el domicilio. ¡Muchas gracias!`;
  document.getElementById('modalConfirmarWhatsapp').classList.add('open');
}

async function sendAndMarkWhatsappCita() {
  const idCita = document.getElementById('waCitaId').value;
  const tel = String(document.getElementById('waTelefono').value || '').replace(/\D/g, '');
  const mensaje = document.getElementById('waMensajeTexto').value;

  const cleanPhone = tel.startsWith('34') ? tel : (tel.length === 9 ? `34${tel}` : tel);
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`, '_blank');

  if (!confirm('Se ha abierto WhatsApp Web/App con el mensaje preparado.\n\n¿Ya lo has enviado al cliente y quieres marcar esta cita como "✅ Cliente Avisado"?')) {
    return;
  }

  await apiFetch(`/api/citas/${idCita}/confirmar-whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje })
  });

  closeModal('modalConfirmarWhatsapp');
  await loadCitasList();
}

function openWhatsappDirectClient(telefono, nombre, numero) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const cleanPhone = tel.startsWith('34') ? tel : (tel.length === 9 ? `34${tel}` : tel);
  const msg = `Hola ${nombre}, nos ponemos en contacto desde el Servicio Técnico de Baza Mazano S.L. respecto a su Aviso SAT #${numero}.`;
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// =========================================================================
// FIRMA DIGITAL HTML5 CANVAS
// =========================================================================
function initSignaturePad() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) {
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function stop() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', stop);
}

function clearSignaturePad() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// =========================================================================
// MODO CLARO / OSCURO (TEMA PERSISTENTE)
// =========================================================================
function initTheme() {
  const saved = localStorage.getItem('sat_baza_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    document.documentElement.classList.add('light-theme');
    if (btn) btn.innerHTML = '🌙 Modo Oscuro';
  } else {
    document.body.classList.remove('light-theme');
    document.documentElement.classList.remove('light-theme');
    if (btn) btn.innerHTML = '☀️ Modo Claro';
  }
  localStorage.setItem('sat_baza_theme', theme);
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-theme');
  applyTheme(isLight ? 'dark' : 'light');
}

// Exponer globalmente para onclick inline
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.initTheme = initTheme;
window.changeCalendarWeek = changeCalendarWeek;
window.setCalendarToday = setCalendarToday;
window.setCalendarDemoWeek = setCalendarDemoWeek;
window.setCalendarCrewFilter = setCalendarCrewFilter;
window.renderWeeklyCalendar = renderWeeklyCalendar;
window.toggleMobileCrewTeammate = toggleMobileCrewTeammate;
window.onMobileTechChanged = onMobileTechChanged;
window.getSelectedMobilePartnersString = getSelectedMobilePartnersString;

// =========================================================================
// DICCIONARIO DE ALERTAS POR PALABRA CLAVE (NOTA 10)
// =========================================================================
const KEYWORD_ALERTS = [
  {
    keywords: ['RCR70'],
    title: '⚠️ ALERTA PRODUCTO DELICADO: RCR70',
    msg: 'Verificar diámetro de salida de humos, accesorios especiales y confirmar compatibilidad antes de cerrar pedido.'
  },
  {
    keywords: ['HIDRO', 'TERMOESTUFA'],
    title: '💧 ALERTA EQUIPO HIDRO / TERMOESTUFA',
    msg: 'Requiere revisión de circuito hidráulico, vaso de expansión, válvula anticondensados y verificar Señal 50% antes de planning.'
  },
  {
    keywords: ['ECOFOREST'],
    title: '⚡ ALERTA PREVENTIVA ECOFOREST (Nota 2)',
    msg: 'Recordar al cliente desconectar la máquina de la corriente en verano por picos de tensión/tormentas (no cubierto por garantía).'
  }
];

function evaluateKeywordAlerts() {
  const banner = document.getElementById('keywordAlertBanner');
  if (!banner) return;
  const marca = (document.getElementById('newMarca')?.value || '').toUpperCase();
  const modelo = (document.getElementById('newModelo')?.value || '').toUpperCase();
  const obs = (document.getElementById('newObservaciones')?.value || '').toUpperCase();
  const combined = `${marca} ${modelo} ${obs}`;

  const matched = KEYWORD_ALERTS.filter(rule => rule.keywords.some(kw => combined.includes(kw)));
  if (matched.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.style.display = 'block';
  banner.innerHTML = matched.map(m => `<div style="margin-bottom:4px;"><strong>${escapeHtml(m.title)}:</strong> ${escapeHtml(m.msg)}</div>`).join('');
}

function initKeywordAlertListeners() {
  ['newMarca', 'newModelo', 'newObservaciones'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.kwBound) {
      el.dataset.kwBound = '1';
      el.addEventListener('input', evaluateKeywordAlerts);
    }
  });
}

// =========================================================================
// BUZÓN DE ALERTAS OPERATIVAS (3 SEMÁFOROS + REMATES 7 DÍAS)
// =========================================================================
let _buzonData = { counts: { sinPlanning: 0, pendienteSenal50: 0, pedidosProveedor: 0, rematesUrgentes: 0 }, sinPlanning: [], pendienteSenal50: [], pedidosProveedor: [], rematesUrgentes: [] };
let _buzonActiveTab = 'sinPlanning';

async function loadBuzonAlertas() {
  try {
    const res = await apiFetch('/api/sat/buzon-alertas');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    _buzonData = data;
    const c = data.counts || {};
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val || 0); };
    setTxt('buzonCountSinPlanning', c.sinPlanning);
    setTxt('buzonCountSenal50', c.pendienteSenal50);
    setTxt('buzonCountPedidos', c.pedidosProveedor);
    setTxt('buzonCountRemates', c.rematesUrgentes);
    setTxt('buzonTabCount_sinPlanning', c.sinPlanning);
    setTxt('buzonTabCount_pendienteSenal50', c.pendienteSenal50);
    setTxt('buzonTabCount_pedidosProveedor', c.pedidosProveedor);
    setTxt('buzonTabCount_rematesUrgentes', c.rematesUrgentes);

    const remBadge = document.getElementById('buzonBadgeRemates');
    if (remBadge) remBadge.style.display = (c.rematesUrgentes || 0) > 0 ? 'inline-flex' : 'none';

    if (document.getElementById('modalBuzonAlertas')?.classList.contains('open')) {
      renderBuzonTabList();
    }
  } catch (e) {}
}

function openBuzonAlertas(tab = 'sinPlanning') {
  _buzonActiveTab = tab || 'sinPlanning';
  document.getElementById('modalBuzonAlertas')?.classList.add('open');
  switchBuzonTab(_buzonActiveTab);
  loadBuzonAlertas();
}

function switchBuzonTab(tab) {
  _buzonActiveTab = tab;
  ['sinPlanning', 'pendienteSenal50', 'pedidosProveedor', 'rematesUrgentes'].forEach(t => {
    const btn = document.getElementById(`buzonTab_${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  renderBuzonTabList();
}

function renderBuzonTabList() {
  const container = document.getElementById('buzonAlertasList');
  if (!container) return;
  const items = Array.isArray(_buzonData[_buzonActiveTab]) ? _buzonData[_buzonActiveTab] : [];
  if (items.length === 0) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">✅ Cero alertas pendientes en esta categoría.</div>`;
    return;
  }

  container.innerHTML = items.map(it => {
    const diasTxt = _buzonActiveTab === 'rematesUrgentes' && it.diasRestantes !== null && it.diasRestantes !== undefined
      ? (it.diasRestantes < 0 ? `<span class="badge badge-red">Vencido hace ${Math.abs(it.diasRestantes)}d</span>` : `<span class="badge badge-orange">Quedan ${it.diasRestantes}d</span>`)
      : '';
    const extraBtns = [];
    if (_buzonActiveTab === 'pendienteSenal50') {
      extraBtns.push(`<button type="button" class="btn btn-green" style="font-size:11.5px;padding:5px 9px;" onclick="buzonQuickVerifySenal('${it.idAviso}')">✅ Verificar 50%</button>`);
    }
    if (_buzonActiveTab === 'pedidosProveedor') {
      extraBtns.push(`<button type="button" class="btn btn-blue" style="font-size:11.5px;padding:5px 9px;" onclick="buzonQuickMarkPedido('${it.idAviso}')">📤 Pedido Enviado</button>`);
    }
    return `
      <div class="buzon-item-card">
        <div>
          <div style="font-weight:800;font-size:13.5px;">#${escapeHtml(String(it.numero || ''))} — ${escapeHtml(it.nombreCliente)} ${escapeHtml(it.apellidosCliente)} ${diasTxt}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            📞 ${escapeHtml(it.telefono1 || 'Sin tel.')} · 📍 ${escapeHtml(it.poblacion || '')} · 🔥 ${escapeHtml(it.marca || '')} ${escapeHtml(it.modelo || '')} ${it.docCompra ? `· 📄 ${escapeHtml(it.docCompra)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${extraBtns.join('')}
          <button type="button" class="btn btn-primary" style="font-size:11.5px;padding:5px 10px;" onclick="buzonOpenAviso('${it.idAviso}')">🔎 Abrir Aviso</button>
        </div>
      </div>
    `;
  }).join('');
}

async function buzonQuickVerifySenal(idAviso) {
  const res = await apiFetch(`/api/avisos/${idAviso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago50Verificado: true })
  });
  if (res.ok) {
    await loadAvisosList();
    await loadBuzonAlertas();
  }
}

async function buzonQuickMarkPedido(idAviso) {
  const res = await apiFetch(`/api/avisos/${idAviso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pedidoProveedorEstado: 'PEDIDO_ENVIADO' })
  });
  if (res.ok) {
    await loadAvisosList();
    await loadBuzonAlertas();
  }
}

async function buzonOpenAviso(idAviso) {
  closeModal('modalBuzonAlertas');
  switchRole('mando');
  switchMandoTab('triaje');
  const existing = state.avisos.find(a => a.idAviso === idAviso);
  if (!existing) {
    const sel = document.getElementById('filterEstadoAviso');
    if (sel) sel.value = 'TODOS';
    await loadAvisosList();
  }
  selectAviso(idAviso);
}

// =========================================================================
// BLOQUEO SEÑAL 50% EN DESPACHADOR DE CITAS (NOTA 5)
// =========================================================================
async function resolverBloqueoVerificar50() {
  const payload = window._pendingCitaPayload;
  if (!payload || !payload.idAviso) return;
  const patchRes = await apiFetch(`/api/avisos/${payload.idAviso}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago50Verificado: true })
  });
  if (!patchRes.ok) return alert('No se pudo verificar el pago 50%.');

  const res = await apiFetch('/api/citas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    window._pendingCitaPayload = null;
    closeModal('modalBloqueoSenal50');
    closeModal('modalAgendarCita');
    await loadBootstrap();
    await loadAvisosList();
    await loadCitasList();
    loadBuzonAlertas();
  }
}

async function resolverBloqueoForzar() {
  const payload = window._pendingCitaPayload;
  if (!payload) return;
  const forcedPayload = Object.assign({}, payload, { forzarSinSenal: true });
  const res = await apiFetch('/api/citas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(forcedPayload)
  });
  const data = await res.json();
  if (data.ok) {
    window._pendingCitaPayload = null;
    closeModal('modalBloqueoSenal50');
    closeModal('modalAgendarCita');
    await loadBootstrap();
    await loadAvisosList();
    await loadCitasList();
    loadBuzonAlertas();
  }
}

// =========================================================================
// DESPERTADOR DE TAREAS Y ALERTAS (WEB AUDIO API + POLLING 15s)
// =========================================================================
let _despertadorTimer = null;
let _despertadorAlarms = [];
let _despertadorSeenIds = new Set();
let _despertadorSoundOn = localStorage.getItem('sat_despertador_sound') !== 'off';

function updateDespertadorSoundUi() {
  const btn = document.getElementById('btnDespertadorSound');
  if (btn) btn.textContent = _despertadorSoundOn ? '🔊' : '🔇';
}

function toggleDespertadorSound() {
  _despertadorSoundOn = !_despertadorSoundOn;
  localStorage.setItem('sat_despertador_sound', _despertadorSoundOn ? 'on' : 'off');
  updateDespertadorSoundUi();
  if (_despertadorSoundOn) playDespertadorBeep();
}

function playDespertadorBeep() {
  if (!_despertadorSoundOn) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [523.25, 659.25].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.08, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.15);
    });
  } catch (e) {}
}

function startDespertadorPolling() {
  if (_despertadorTimer) clearInterval(_despertadorTimer);
  pollDespertadorActivos();
  _despertadorTimer = setInterval(pollDespertadorActivos, 15000);
}

async function pollDespertadorActivos() {
  try {
    const res = await fetch('/api/despertador/activos');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    _despertadorAlarms = Array.isArray(data.alarms) ? data.alarms : [];
    const badge = document.getElementById('despertadorBadge');
    if (badge) {
      badge.textContent = String(_despertadorAlarms.length);
      badge.style.display = _despertadorAlarms.length > 0 ? 'inline-flex' : 'none';
    }
    const newAlarms = _despertadorAlarms.filter(a => !_despertadorSeenIds.has(a.id));
    if (newAlarms.length > 0) {
      newAlarms.forEach(a => _despertadorSeenIds.add(a.id));
      playDespertadorBeep();
      showDespertadorToast(newAlarms[0]);
    }
    if (document.getElementById('modalDespertadorAlarma')?.classList.contains('open')) {
      renderDespertadorModal();
    }
  } catch (e) {}
}

function showDespertadorToast(alarm) {
  let toast = document.getElementById('despertadorToastBox');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'despertadorToastBox';
  toast.className = 'despertador-toast';
  const isTask = !alarm.autoGenerated;
  toast.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong style="font-size:13px;color:#fb923c;">⏰ DESPERTADOR ${escapeHtml(alarm.sourceApp || 'SAT')}</strong>
      <button type="button" class="btn btn-ghost" style="padding:2px 6px;font-size:12px;" onclick="this.closest('#despertadorToastBox').remove()">✕</button>
    </div>
    <div style="font-weight:800;font-size:13.5px;margin-bottom:4px;">${escapeHtml(alarm.title)}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${escapeHtml(alarm.desc || '')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${isTask ? `
        <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${alarm.id}', { minutes: 15 })">⏱️ +15m</button>
        <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${alarm.id}', { minutes: 60 })">🕐 +1h</button>
        <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${alarm.id}', { tomorrow9am: true })">🌅 Mañana 09:00</button>
        <button type="button" class="btn btn-green" style="font-size:11px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${alarm.id}', { dismiss: true })">✅ Descartar</button>
      ` : ''}
      ${alarm.linkedAvisoId ? `<button type="button" class="btn btn-primary" style="font-size:11px;padding:4px 8px;" onclick="document.getElementById('despertadorToastBox')?.remove();buzonOpenAviso('${alarm.linkedAvisoId}')">🔎 Ir al Aviso</button>` : ''}
    </div>
  `;
  document.body.appendChild(toast);
}

function openDespertadorDrawer() {
  document.getElementById('modalDespertadorAlarma')?.classList.add('open');
  renderDespertadorModal();
}

function renderDespertadorModal() {
  const list = document.getElementById('despertadorAlarmsList');
  if (!list) return;
  if (_despertadorAlarms.length === 0) {
    list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">⏰ No hay alarmas activas en este momento.</div>`;
    return;
  }
  list.innerHTML = _despertadorAlarms.map(a => {
    const isTask = !a.autoGenerated;
    return `
      <div class="despertador-alarm-card">
        <div style="flex:1;min-width:220px;">
          <div style="font-weight:800;font-size:13.5px;">${escapeHtml(a.title)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escapeHtml(a.desc || '')}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${isTask ? `
            <button type="button" class="btn btn-ghost" style="font-size:11.5px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${a.id}', { minutes: 15 })">⏱️ +15m</button>
            <button type="button" class="btn btn-ghost" style="font-size:11.5px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${a.id}', { minutes: 60 })">🕐 +1h</button>
            <button type="button" class="btn btn-ghost" style="font-size:11.5px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${a.id}', { tomorrow9am: true })">🌅 Mañana 09:00</button>
            <button type="button" class="btn btn-green" style="font-size:11.5px;padding:4px 8px;" onclick="snoozeDespertadorAlarm('${a.id}', { dismiss: true })">✅ Descartar</button>
          ` : ''}
          ${a.linkedAvisoId ? `<button type="button" class="btn btn-primary" style="font-size:11.5px;padding:4px 8px;" onclick="closeModal('modalDespertadorAlarma');buzonOpenAviso('${a.linkedAvisoId}')">🔎 Ir al Aviso</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function snoozeDespertadorAlarm(id, opts) {
  try {
    const res = await fetch('/api/hub/tasks/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ id }, opts))
    });
    if (res.ok) {
      document.getElementById('despertadorToastBox')?.remove();
      await pollDespertadorActivos();
    }
  } catch (e) {}
}

function openCrearDespertadorModal(idAviso) {
  const av = state.avisos.find(a => a.idAviso === idAviso);
  if (!av) return;
  document.getElementById('despLinkedAvisoId').value = av.idAviso;
  document.getElementById('despTitle').value = `Aviso #${av.numero} — ${av.nombreCliente} ${av.apellidosCliente}`.trim();
  document.getElementById('despPreset').value = '1h';
  onDespPresetChange('1h');
  document.getElementById('modalCrearDespertador')?.classList.add('open');
}

function onDespPresetChange(val) {
  const wrap = document.getElementById('despCustomWrap');
  if (wrap) wrap.style.display = val === 'custom' ? 'block' : 'none';
}

function computeReminderIso(preset, customVal) {
  const d = new Date();
  if (preset === '1h') {
    return new Date(Date.now() + 3600000).toISOString();
  }
  if (preset === 'hoy17') {
    d.setHours(17, 0, 0, 0);
    return d.toISOString();
  }
  if (preset === 'manana9') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (preset === 'custom' && customVal) {
    const parsed = new Date(customVal);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(Date.now() + 3600000).toISOString();
}

async function submitCrearDespertadorAviso(e) {
  e.preventDefault();
  const idAviso = document.getElementById('despLinkedAvisoId').value;
  const title = document.getElementById('despTitle').value.trim();
  const preset = document.getElementById('despPreset').value;
  const customVal = document.getElementById('despCustomAt').value;
  const to = document.getElementById('despTo').value;
  const reminderAt = computeReminderIso(preset, customVal);

  const res = await fetch('/api/hub/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      desc: `Alarma programada desde SAT 2.0 para aviso vinculado.`,
      from: state.authUser?.nombre || 'SAT 2.0',
      to,
      cat: 'SAT 2.0',
      prio: 'alta',
      status: 'pending',
      reminderAt,
      linkedAvisoId: idAviso,
      sourceApp: 'SAT'
    })
  });
  const data = await res.json();
  if (data.ok) {
    closeModal('modalCrearDespertador');
    alert('⏰ Despertador programado correctamente.');
    pollDespertadorActivos();
  } else {
    alert('⚠️ ' + (data.error || 'No se pudo programar el despertador.'));
  }
}

window.openBuzonAlertas = openBuzonAlertas;
window.switchBuzonTab = switchBuzonTab;
window.buzonQuickVerifySenal = buzonQuickVerifySenal;
window.buzonQuickMarkPedido = buzonQuickMarkPedido;
window.buzonOpenAviso = buzonOpenAviso;
window.resolverBloqueoVerificar50 = resolverBloqueoVerificar50;
window.resolverBloqueoForzar = resolverBloqueoForzar;
window.openDespertadorDrawer = openDespertadorDrawer;
window.toggleDespertadorSound = toggleDespertadorSound;
window.snoozeDespertadorAlarm = snoozeDespertadorAlarm;
window.openCrearDespertadorModal = openCrearDespertadorModal;
window.onDespPresetChange = onDespPresetChange;
window.submitCrearDespertadorAviso = submitCrearDespertadorAviso;

// =========================================================================
// FASE 1.5B + SYNC CONVERSACIÓN: ECONÓMICO PREVIO, HISTÓRICO, EXCEL CONTABLE,
// PREVENTIVO ECOFOREST Y CHECKLIST ACCESORIOS (NOTA 7)
// =========================================================================
async function saveAvisoEconomico(idAviso) {
  const pEl = document.getElementById(`editPrecioComunicado_${idAviso}`);
  const stEl = document.getElementById(`editEstadoCobroPrevio_${idAviso}`);
  const impEl = document.getElementById(`editImporteAbonado_${idAviso}`);
  const metEl = document.getElementById(`editMetodoPagoPrevio_${idAviso}`);
  const fecEl = document.getElementById(`editFechaPagoPrevio_${idAviso}`);
  const payload = {
    precioComunicado: pEl && pEl.value !== '' ? Number(pEl.value) : null,
    estadoCobroPrevio: stEl ? stEl.value : 'PENDIENTE',
    importeAbonadoPrevio: impEl ? Number(impEl.value || 0) : 0,
    metodoPagoPrevio: metEl ? metEl.value : '',
    fechaPagoPrevio: fecEl ? fecEl.value : ''
  };
  await quickUpdateAviso(idAviso, payload);
  alert('💶 Datos económicos previos guardados correctamente.');
}

function getHistoricoFilterParams() {
  return new URLSearchParams({
    q: document.getElementById('histSearchInput')?.value || '',
    estado: document.getElementById('histEstadoFilter')?.value || 'TODOS',
    operario: document.getElementById('histOperarioFilter')?.value || 'TODOS',
    tipoServicio: document.getElementById('histTipoServicioFilter')?.value || 'TODOS',
    desde: document.getElementById('histDesdeInput')?.value || '',
    hasta: document.getElementById('histHastaInput')?.value || '',
    limit: '250'
  });
}

async function renderHistoricoAdminSection() {
  const el = document.getElementById('adminSectionHistorico');
  if (!el) return;
  const canExport = Boolean(state.authUser && state.authUser.canExportContable);

  if (!document.getElementById('histSearchInput')) {
    el.innerHTML = `
      <div class="panel">
        <div class="panel-header" style="flex-wrap:wrap;gap:10px;">
          <h2>📚 Histórico General SAT (Pendientes y Finalizados)</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="badge badge-blue" id="histCountBadge">0 registros</span>
            ${canExport ? `<button type="button" class="btn btn-green" style="padding:7px 14px;font-size:12px;" onclick="exportContableCsv()">📥 Exportar Excel Contable (.csv)</button>` : ''}
          </div>
        </div>
        <div class="panel-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
            <input type="search" id="histSearchInput" placeholder="🔍 Buscar nº aviso, cliente, teléfono, pueblo..." oninput="loadHistoricoSat()" style="flex:1;min-width:200px;" />
            <select id="histEstadoFilter" onchange="loadHistoricoSat()">
              <option value="TODOS">Todos los estados</option>
              <option value="PENDIENTES">Solo Pendientes</option>
              <option value="FINALIZADOS">Solo Finalizados</option>
              <option value="FINALIZADO, PASAR ALIQUO">FINALIZADO, PASAR ALIQUO</option>
            </select>
            <select id="histTipoServicioFilter" onchange="loadHistoricoSat()">
              <option value="TODOS">Todos los circuitos</option>
              <option value="SAT">🔧 SAT</option>
              <option value="MONTAJE_GOTERA">🏗️ Montajes / Goteras</option>
            </select>
            <select id="histOperarioFilter" onchange="loadHistoricoSat()">
              <option value="TODOS">Todos los operarios</option>
              <option value="JACOBO">JACOBO</option>
              <option value="ALEX">ALEX</option>
              <option value="DIONI">DIONI</option>
              <option value="ROBERTO">ROBERTO</option>
              <option value="ISMA">ISMA</option>
              <option value="DANY">DANY</option>
              <option value="JUAN">JUAN</option>
            </select>
            <input type="date" id="histDesdeInput" onchange="loadHistoricoSat()" title="Desde fecha entrada" />
            <input type="date" id="histHastaInput" onchange="loadHistoricoSat()" title="Hasta fecha entrada" />
          </div>
          <div id="histTableWrap" style="overflow-x:auto;"></div>
        </div>
      </div>
    `;
  }
  await loadHistoricoSat();
}

async function loadHistoricoSat() {
  const wrap = document.getElementById('histTableWrap');
  const badge = document.getElementById('histCountBadge');
  if (!wrap) return;
  const canCostes = Boolean(state.authUser && state.authUser.canSeeCostes);
  const params = getHistoricoFilterParams();
  const res = await apiFetch(`/api/sat/historico?${params}`);
  const data = await res.json();
  if (!data.ok) return;

  const rows = data.rows || [];
  if (badge) badge.textContent = `${data.total} registros`;
  if (rows.length === 0) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">No hay intervenciones que coincidan con estos filtros.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nº / Fecha</th>
          <th>Cliente / Máquina</th>
          <th>Intervención / Operario</th>
          <th>Notas & Repuestos</th>
          <th>Previo</th>
          <th style="text-align:right;">Total PVP</th>
          ${canCostes ? '<th style="text-align:right;">Neto / Margen</th>' : ''}
          <th>Cobro</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              <strong>#${r.numero}</strong> ${r.tipoServicio === 'MONTAJE_GOTERA' ? '<span class="badge badge-amber">🏗️</span>' : ''}<br>
              <small style="color:var(--text-muted);">${escapeHtml(formatDateES(r.fechaEntrada))}</small><br>
              ${r.fechaEjecucion ? `<small style="color:#34d399;">Ejec: ${escapeHtml(formatDateES(r.fechaEjecucion))}</small>` : ''}
            </td>
            <td>
              <strong>${escapeHtml(r.clienteNombre || '-')}</strong> (${escapeHtml(r.poblacion || '')})<br>
              <small style="color:var(--text-muted);">${escapeHtml(r.maquina || '-')}</small>
            </td>
            <td>
              <span class="badge badge-blue">${escapeHtml(r.tipoIntervencion)}</span><br>
              <small>👷 ${escapeHtml(r.operario)} · ${escapeHtml(r.estadoAviso)}</small>
            </td>
            <td style="max-width:260px;font-size:11px;">
              ${r.observaciones ? `<div><strong>Ofic:</strong> ${escapeHtml(r.observaciones.slice(0, 80))}</div>` : ''}
              ${r.notasTecnico ? `<div style="color:#93c5fd;"><strong>Téc:</strong> ${escapeHtml(r.notasTecnico.slice(0, 80))}</div>` : ''}
              ${r.repuestosTexto ? `<div style="color:#fcd34d;"><strong>Rep:</strong> ${escapeHtml(r.repuestosTexto.slice(0, 80))}</div>` : ''}
            </td>
            <td style="font-size:11px;">
              ${r.precioComunicado !== null ? `Acord: ${r.precioComunicado.toFixed(2)}€<br>` : ''}
              ${r.importeAbonadoPrevio > 0 ? `<span style="color:#34d399;">Abon: ${r.importeAbonadoPrevio.toFixed(2)}€ (${escapeHtml(r.metodoPagoPrevio)})</span>` : '-'}
            </td>
            <td style="text-align:right;"><strong style="color:#34d399;">${r.totalFacturado.toFixed(2)} €</strong></td>
            ${canCostes ? `<td style="text-align:right;font-size:11px;">Neto: ${(r.costeNetoRepuestos || 0).toFixed(2)}€<br><strong style="color:#fbbf24;">Mgn: ${(r.margenRepuestos || 0).toFixed(2)}€</strong></td>` : ''}
            <td style="font-size:11px;">${escapeHtml(r.estadoCobro || 'PENDIENTE')}<br><small>${escapeHtml(r.formaCobro || '')}</small></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function exportContableCsv() {
  const params = getHistoricoFilterParams();
  window.open(withAuthToken(`/api/admin/export-contable?${params}`), '_blank');
}

const WA_TEMPLATES_CATALOG = [
  {
    id: 'ecoforest_verano',
    label: '⚡ Aviso Preventivo Verano ECOFOREST',
    buildMessage: ({ nombre, equipo }) =>
      `Hola ${nombre || ''}, aviso preventivo de Baza Mazano S.L. para tu equipo ${equipo || 'ECOFOREST'}: durante el verano (cuando no vayas a utilizar la estufa/caldera) es muy importante desconectarla totalmente de la corriente eléctrica (desenchufar o bajar el térmico) para evitar quemar la placa electrónica por tormentas o picos de tensión.`
  }
];

function buildWhatsappTemplateUrl(telefono, templateId, ctx = {}) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const cleanPhone = tel.startsWith('34') ? tel : (tel.length === 9 ? `34${tel}` : tel);
  const tpl = WA_TEMPLATES_CATALOG.find(t => t.id === templateId) || WA_TEMPLATES_CATALOG[0];
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(tpl.buildMessage(ctx))}`;
}

async function openPreventivoEcoforestModal() {
  const modal = document.getElementById('modalPreventivoEcoforest');
  const listEl = document.getElementById('preventivoEcoforestList');
  if (!modal || !listEl) return;
  modal.classList.add('open');
  listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">Buscando clientes ECOFOREST...</div>`;
  try {
    const res = await apiFetch('/api/avisos?limit=500');
    const data = await res.json();
    const avisos = Array.isArray(data.avisos) ? data.avisos : (state.avisos || []);
    const eco = avisos.filter(a => `${a.marca || ''} ${a.modelo || ''}`.toUpperCase().includes('ECOFOREST'));
    if (eco.length === 0) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No se han encontrado avisos/clientes con marca o modelo ECOFOREST.</div>`;
      return;
    }
    listEl.innerHTML = eco.map(a => {
      const equipo = [a.marca, a.modelo].filter(Boolean).join(' ').trim();
      const telClean = String(a.telefono1 || '').replace(/\D/g, '');
      const waUrl = telClean ? buildWhatsappTemplateUrl(a.telefono1, 'ecoforest_verano', { nombre: a.nombreCliente || '', equipo }) : '';
      return `
        <div class="buzon-item-card">
          <div>
            <div style="font-weight:800;font-size:13.5px;">#${escapeHtml(String(a.numero || ''))} — ${escapeHtml(a.nombreCliente)} ${escapeHtml(a.apellidosCliente)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">🔥 <strong>${escapeHtml(equipo)}</strong> · 📞 ${escapeHtml(a.telefono1 || 'Sin tel.')} · 📍 ${escapeHtml(a.poblacion || '')}</div>
          </div>
          <div>
            ${waUrl ? `<a href="${waUrl}" target="_blank" class="btn btn-amber" style="font-size:11.5px;padding:6px 10px;text-decoration:none;">⚡ Enviar Aviso WA</a>` : `<span class="badge badge-red">Sin teléfono</span>`}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;">Error cargando clientes ECOFOREST.</div>`;
  }
}

function onChecklistAccesoriosChange() {
  const anyChecked =
    Boolean(document.getElementById('chkAccTRegistro')?.checked) ||
    Boolean(document.getElementById('chkAccSombrerete')?.checked) ||
    Boolean(document.getElementById('chkAccReduccion')?.checked) ||
    Boolean(document.getElementById('chkAccTomaAire')?.checked) ||
    Boolean(document.getElementById('newOtrosAccesorios')?.value.trim());
  const selPedido = document.getElementById('newPedidoProveedorEstado');
  if (anyChecked && selPedido && selPedido.value === 'NO_APLICA') {
    selPedido.value = 'PENDIENTE';
  }
}

window.saveAvisoEconomico = saveAvisoEconomico;
window.loadHistoricoSat = loadHistoricoSat;
window.exportContableCsv = exportContableCsv;
window.openPreventivoEcoforestModal = openPreventivoEcoforestModal;
window.onChecklistAccesoriosChange = onChecklistAccesoriosChange;
window.renderRepuestosCatalogTable = renderRepuestosCatalogTable;

// =========================================================================
// MÓDULO DE COSTES REALES Y RENTABILIDAD SAT (REEMPLAZO EXCEL SILVIA)
// =========================================================================
let rentFilters = {
  desde: '',
  hasta: '',
  operario: 'TODOS',
  fuga: 'TODAS',
  soloFinalizados: '1',
  q: ''
};

async function renderRentabilidadAdminSection() {
  const el = document.getElementById('adminSectionRentabilidad');
  if (!el) return;
  if (!state.authUser || !state.authUser.canSeeCostes) {
    el.innerHTML = `<div class="panel"><div class="panel-body" style="padding:24px;color:#f87171;">🔒 Acceso restringido a usuarios con permiso de costes reales.</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header" style="flex-wrap:wrap;gap:10px;">
        <h2>💰 Control de Costes Reales y Radar de Fugas SAT</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost" onclick="toggleRentConfigPanel()" style="font-size:12px;">⚙️ Tarifas Coste/h & Furgonetas</button>
          <button class="btn btn-amber" onclick="toggleRentGastoPanel()" style="font-size:12px;">➕ Registrar Gasto / Gasolina</button>
          <button class="btn btn-primary" onclick="loadRentabilidadData()" style="font-size:12px;">🔄 Actualizar</button>
        </div>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">
          <div class="field"><label>Desde</label><input type="date" id="rentDesde" value="${escapeHtml(rentFilters.desde)}" onchange="rentFilters.desde=this.value;loadRentabilidadData()" /></div>
          <div class="field"><label>Hasta</label><input type="date" id="rentHasta" value="${escapeHtml(rentFilters.hasta)}" onchange="rentFilters.hasta=this.value;loadRentabilidadData()" /></div>
          <div class="field"><label>Operario</label>
            <select id="rentOperario" onchange="rentFilters.operario=this.value;loadRentabilidadData()">
              <option value="TODOS">Todos</option>
              <option value="JACOBO">Jacobo (51 €/h)</option>
              <option value="ALEX">Alex (24,24 €/h)</option>
              <option value="ROBERTO">Roberto (25,54 €/h)</option>
              <option value="DIONI">Dioni (24 €/h)</option>
              <option value="ISMA">Isma (24,24 €/h)</option>
            </select>
          </div>
          <div class="field"><label>Tipo Fuga</label>
            <select id="rentFuga" onchange="rentFilters.fuga=this.value;loadRentabilidadData()">
              <option value="TODAS">Todas las órdenes</option>
              <option value="MARGEN_NEGATIVO">🔴 En pérdidas (&lt; 0€)</option>
              <option value="SEGUNDA_VISITA">🔁 Segundas visitas (&gt; 1)</option>
              <option value="GARANTIA_DEFICITARIA">🛡️ Garantías deficitarias</option>
              <option value="DESPLAZAMIENTO_CARO">🚐 Desplazamiento caro (&gt;40%)</option>
            </select>
          </div>
          <div class="field"><label>Estado</label>
            <select id="rentSoloFin" onchange="rentFilters.soloFinalizados=this.value;loadRentabilidadData()">
              <option value="1" ${rentFilters.soloFinalizados === '1' ? 'selected' : ''}>Solo Finalizados / Aliquo</option>
              <option value="0" ${rentFilters.soloFinalizados === '0' ? 'selected' : ''}>Todos (incl. en curso)</option>
            </select>
          </div>
          <div class="field"><label>Buscar</label><input type="text" id="rentQ" placeholder="Aviso, cliente, pueblo..." value="${escapeHtml(rentFilters.q)}" oninput="rentFilters.q=this.value;loadRentabilidadData()" /></div>
        </div>

        <div id="rentConfigPanel" style="display:none;background:rgba(15,23,42,0.55);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;"></div>
        <div id="rentGastoPanel" style="display:none;background:rgba(15,23,42,0.55);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;"></div>

        <div id="rentKpisContainer" style="margin-bottom:14px;">Cargando escandallo...</div>
        <div id="rentBreakdownContainer" style="margin-bottom:14px;"></div>
        <div id="rentTableContainer" style="overflow-x:auto;"></div>
      </div>
    </div>
  `;

  await loadRentabilidadData();
}

async function loadRentabilidadData() {
  const params = new URLSearchParams();
  if (rentFilters.desde) params.set('desde', rentFilters.desde);
  if (rentFilters.hasta) params.set('hasta', rentFilters.hasta);
  if (rentFilters.operario !== 'TODOS') params.set('operario', rentFilters.operario);
  if (rentFilters.fuga !== 'TODAS') params.set('fuga', rentFilters.fuga);
  if (rentFilters.soloFinalizados === '1') params.set('soloFinalizados', '1');
  if (rentFilters.q) params.set('q', rentFilters.q);

  const res = await apiFetch('/api/admin/rentabilidad?' + params.toString());
  const data = await res.json();
  if (!data.ok) {
    document.getElementById('rentKpisContainer').innerHTML = `<div style="color:#f87171;">${escapeHtml(data.error || 'Error cargando rentabilidad')}</div>`;
    return;
  }

  const k = data.kpis;
  const fmt = (n) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const benColor = k.totalBeneficio >= 0 ? '#34d399' : '#f87171';

  document.getElementById('rentKpisContainer').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin-bottom:12px;">
      <div class="kpi-card"><div class="kpi-label">Avisos Analizados</div><div class="kpi-value">${k.totalAvisos}</div><div class="kpi-sub">Bruto: ${fmt(k.totalIngresosBrutos)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Ingresos Netos (sin IVA)</div><div class="kpi-value" style="color:#60a5fa;">${fmt(k.totalIngresosNetos)}</div><div class="kpi-sub">Base real de cálculo</div></div>
      <div class="kpi-card"><div class="kpi-label">Coste Real Total</div><div class="kpi-value" style="color:#fbbf24;">${fmt(k.totalCosteReal)}</div><div class="kpi-sub">MO + Viaje + 20€ Adm + Piezas</div></div>
      <div class="kpi-card"><div class="kpi-label">Beneficio Neto Real</div><div class="kpi-value" style="color:${benColor};">${fmt(k.totalBeneficio)}</div><div class="kpi-sub">Margen real: <strong>${k.margenGlobalPct}%</strong></div></div>
      <div class="kpi-card"><div class="kpi-label">Dinero Fugado (Pérdidas)</div><div class="kpi-value" style="color:#f87171;">-${fmt(k.dineroFugadoPerdidas)}</div><div class="kpi-sub">Gastos extra flota/prov: ${fmt(k.totalGastosExtra)}</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost" style="font-size:12px;border-color:#ef4444;" onclick="setRentFugaFilter('MARGEN_NEGATIVO')">🔴 En pérdidas: <strong>${k.fugas.margenNegativo}</strong></button>
      <button class="btn btn-ghost" style="font-size:12px;border-color:#f59e0b;" onclick="setRentFugaFilter('SEGUNDA_VISITA')">🔁 Segundas visitas: <strong>${k.fugas.segundasVisitas}</strong></button>
      <button class="btn btn-ghost" style="font-size:12px;border-color:#a855f7;" onclick="setRentFugaFilter('GARANTIA_DEFICITARIA')">🛡️ Garantías en pérdidas: <strong>${k.fugas.garantiasDeficitarias}</strong></button>
      <button class="btn btn-ghost" style="font-size:12px;border-color:#3b82f6;" onclick="setRentFugaFilter('DESPLAZAMIENTO_CARO')">🚐 Viaje caro (&gt;40%): <strong>${k.fugas.desplazamientosCaros}</strong></button>
      <button class="btn btn-ghost" style="font-size:12px;" onclick="setRentFugaFilter('TODAS')">🧹 Ver todos</button>
    </div>
  `;

  const renderMiniTable = (title, rows) => `
    <div style="background:rgba(15,23,42,0.35);border:1px solid var(--border);border-radius:10px;padding:10px;overflow-x:auto;">
      <h4 style="margin:0 0 8px;font-size:13px;">${title}</h4>
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>Concepto</th><th>Avisos</th><th>Neto</th><th>Coste</th><th>Beneficio</th><th>Margen</th></tr></thead>
        <tbody>
          ${(rows || []).slice(0, 8).map(r => `
            <tr>
              <td><strong>${escapeHtml(r.key)}</strong></td>
              <td>${r.avisos}</td>
              <td>${fmt(r.ingresosNetos)}</td>
              <td>${fmt(r.costeReal)}</td>
              <td style="color:${r.beneficio >= 0 ? '#34d399' : '#f87171'};font-weight:800;">${fmt(r.beneficio)}</td>
              <td>${r.margenPct}%</td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="color:var(--text-muted);">Sin datos</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('rentBreakdownContainer').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">
      ${renderMiniTable('📊 Por Tipo de Intervención', data.porTipo)}
      ${renderMiniTable('👷 Por Técnico', data.porOperario)}
      ${renderMiniTable('📍 Pueblos con más Pérdidas', data.porPoblacion)}
    </div>
  `;

  document.getElementById('rentTableContainer').innerHTML = `
    <table class="data-table" style="font-size:12px;">
      <thead>
        <tr>
          <th>Aviso</th><th>Fecha</th><th>Cliente / Pueblo</th><th>Tipo</th><th>Estado</th><th>Técnico</th>
          <th>Visitas / Tiempo</th><th>Km</th><th>Neto s/IVA</th>
          <th>MO Trab.</th><th>MO Viaje</th><th>Vehículo</th><th>Oficina</th><th>Piezas</th>
          <th>Coste Real</th><th>Beneficio Real</th><th>Fugas</th>
        </tr>
      </thead>
      <tbody>
        ${(data.items || []).map(it => {
          const flagsHtml = (it.flagsFuga || []).map(f => `<span class="badge badge-red" style="font-size:10px;margin:1px;">${escapeHtml(f)}</span>`).join(' ');
          const estUp = String(it.estadoAviso || '').toUpperCase();
          const estBadge = estUp.includes('SIN ALIQUO')
            ? `<span class="badge badge-red" style="font-size:10px;">${escapeHtml(it.estadoAviso)}</span>`
            : `<span class="badge badge-blue" style="font-size:10px;">${escapeHtml(it.estadoAviso)}</span>`;
          return `
            <tr>
              <td><strong>#${escapeHtml(String(it.numero || ''))}</strong></td>
              <td>${escapeHtml(String(it.fecha || '').slice(0, 10))}</td>
              <td><div>${escapeHtml(it.clienteNombre || '')}</div><div style="color:var(--text-muted);font-size:11px;">${escapeHtml(it.poblacion || '')}</div></td>
              <td>${escapeHtml(it.tipoIntervencion)}</td>
              <td>${estBadge}</td>
              <td>${escapeHtml(it.operario)}</td>
              <td>${it.numVisitas}v · ${it.minutosIntervencion}m</td>
              <td>${it.kmTotales} km</td>
              <td><strong>${fmt(it.ingresosNetos)}</strong></td>
              <td>${fmt(it.costeMoIntervencion)}</td>
              <td>${fmt(it.costeMoDesplazamiento)}</td>
              <td>${fmt(it.costeVehiculoKm + it.costeVehiculoFijo)}</td>
              <td>${fmt(it.costeGestionOficina)}</td>
              <td>${fmt(it.costeNetoRepuestos)}</td>
              <td style="color:#fbbf24;">${fmt(it.costeTotalReal)}</td>
              <td style="color:${it.beneficioNetoReal >= 0 ? '#34d399' : '#f87171'};font-weight:900;">${fmt(it.beneficioNetoReal)} (${it.margenPct}%)</td>
              <td>${flagsHtml || '<span style="color:#34d399;">OK</span>'}</td>
            </tr>
          `;
        }).join('') || '<tr><td colspan="17" style="text-align:center;padding:20px;">No hay avisos que coincidan con los filtros.</td></tr>'}
      </tbody>
    </table>
  `;
}

function setRentFugaFilter(fuga) {
  rentFilters.fuga = fuga;
  const sel = document.getElementById('rentFuga');
  if (sel) sel.value = fuga;
  loadRentabilidadData();
}

async function toggleRentConfigPanel() {
  const panel = document.getElementById('rentConfigPanel');
  if (!panel) return;
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    return;
  }
  const res = await apiFetch('/api/admin/costes-config');
  const data = await res.json();
  const cfg = data.config || {};
  const ops = cfg.costeHoraOperarios || {};
  panel.style.display = 'block';
  panel.innerHTML = `
    <h4 style="margin:0 0 10px;">⚙️ Configuración de Costes Reales Empresa</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-bottom:10px;">
      <div class="field"><label>Jacobo (€/h)</label><input type="number" step="0.01" id="cfgOpJacobo" value="${ops.JACOBO ?? 51}" /></div>
      <div class="field"><label>Alex (€/h)</label><input type="number" step="0.01" id="cfgOpAlex" value="${ops.ALEX ?? 24.24}" /></div>
      <div class="field"><label>Roberto (€/h)</label><input type="number" step="0.01" id="cfgOpRoberto" value="${ops.ROBERTO ?? 25.54}" /></div>
      <div class="field"><label>Dioni (€/h)</label><input type="number" step="0.01" id="cfgOpDioni" value="${ops.DIONI ?? 24}" /></div>
      <div class="field"><label>Isma (€/h)</label><input type="number" step="0.01" id="cfgOpIsma" value="${ops.ISMAEL ?? 24.24}" /></div>
      <div class="field"><label>Gestión Oficina (€/aviso)</label><input type="number" step="0.5" id="cfgAdminAviso" value="${cfg.costeAdminPorAviso ?? 20}" /></div>
      <div class="field"><label>Coste Km defecto (€)</label><input type="number" step="0.01" id="cfgKmDef" value="${cfg.costeKmDefault ?? 0.25}" /></div>
      <div class="field"><label>Coste/h Vehículo def. (€)</label><input type="number" step="0.5" id="cfgHoraVehDef" value="${cfg.costeHoraVehiculoDefault ?? 5}" /></div>
    </div>
    <button class="btn btn-primary" onclick="saveCostesConfigForm()">💾 Guardar Parámetros y Recalcular</button>
  `;
}

async function saveCostesConfigForm() {
  const payload = {
    costeHoraOperarios: {
      JACOBO: Number(document.getElementById('cfgOpJacobo').value) || 51,
      ALEX: Number(document.getElementById('cfgOpAlex').value) || 24.24,
      ROBERTO: Number(document.getElementById('cfgOpRoberto').value) || 25.54,
      DIONI: Number(document.getElementById('cfgOpDioni').value) || 24,
      ISMAEL: Number(document.getElementById('cfgOpIsma').value) || 24.24,
      ISMA: Number(document.getElementById('cfgOpIsma').value) || 24.24
    },
    costeAdminPorAviso: Number(document.getElementById('cfgAdminAviso').value) || 0,
    costeKmDefault: Number(document.getElementById('cfgKmDef').value) || 0.25,
    costeHoraVehiculoDefault: Number(document.getElementById('cfgHoraVehDef').value) || 5
  };
  const res = await apiFetch('/api/admin/costes-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('rentConfigPanel').style.display = 'none';
    await loadRentabilidadData();
  }
}

async function toggleRentGastoPanel() {
  const panel = document.getElementById('rentGastoPanel');
  if (!panel) return;
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  panel.innerHTML = `
    <h4 style="margin:0 0 10px;">🧾 Registrar Gasto SAT / Repostaje / Proveedor</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">
      <div class="field"><label>Fecha</label><input type="date" id="gastoFecha" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Categoría</label>
        <select id="gastoCat">
          <option value="COMBUSTIBLE">⛽ Combustible / Vehículo</option>
          <option value="REPUESTOS">🔩 Factura Repuestos / Portes</option>
          <option value="MANTENIMIENTO_FLOTA">🚐 Taller / Seguro / ITV</option>
          <option value="OTROS">📦 Otros gastos SAT</option>
        </select>
      </div>
      <div class="field"><label>Proveedor / Concepto</label><input type="text" id="gastoConcepto" placeholder="Ej: Repsol / Dielle / Portes" /></div>
      <div class="field"><label>Nº Aviso (opcional)</label><input type="text" id="gastoAviso" placeholder="Ej: 26285" /></div>
      <div class="field"><label>Matrícula (opcional)</label><input type="text" id="gastoMat" placeholder="Ej: 9390HSV" /></div>
      <div class="field"><label>Importe Total c/IVA (€)</label><input type="number" step="0.01" id="gastoImporte" placeholder="0.00" /></div>
    </div>
    <button class="btn btn-amber" onclick="submitNuevoGastoSat()">💾 Guardar Gasto</button>
  `;
}

async function submitNuevoGastoSat() {
  const payload = {
    fecha: document.getElementById('gastoFecha').value,
    categoria: document.getElementById('gastoCat').value,
    concepto: document.getElementById('gastoConcepto').value,
    avisoNumero: document.getElementById('gastoAviso').value,
    matricula: document.getElementById('gastoMat').value,
    importe: Number(document.getElementById('gastoImporte').value) || 0
  };
  const res = await apiFetch('/api/admin/gastos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('rentGastoPanel').style.display = 'none';
    await loadRentabilidadData();
  }
}

window.loadRentabilidadData = loadRentabilidadData;
window.setRentFugaFilter = setRentFugaFilter;
window.toggleRentConfigPanel = toggleRentConfigPanel;
window.saveCostesConfigForm = saveCostesConfigForm;
window.toggleRentGastoPanel = toggleRentGastoPanel;
window.submitNuevoGastoSat = submitNuevoGastoSat;
