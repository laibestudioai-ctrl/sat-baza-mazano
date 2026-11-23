/**
 * SERVIDOR OFICIAL SAT BAZA MAZANO 2.0 (2026 / 2027)
 * LAIBE STUDIO AI — VALLADOLID
 *
 * Arquitectura Standalone de 3 Vistas:
 *  1) Consola de Mando SAT (Jacobo y Leandro): Alta express 15s con Autocompletado SQL Aliquo en vivo,
 *     Triaje SIN PROCESAR, Despachador Mapa + Calendario de Parejas (CITAS), Confirmación WhatsApp y Radar Avisos Perdidos.
 *  2) App Móvil Técnicos (Alex, Jacobo, Dioni, Roberto): Mis Citas Hoy, Pestaña "De Camino / Cerca de Mí" (Radar GPS),
 *     Códigos de Reset de Marcas embebidos, Asistente de Cierre en 3 Pasos (Voz, Foto WebP, Selector de Repuestos,
 *     Calculadora Automática de Tarifas 2026/2027 y Km desde C/ Annapurna 22, Firma Digital) y Geocerca > 1 km Anti-Olvidos.
 *  3) Panel Administración, Flota y Contratos (Silvia y Lidia — Cero Triaje): Cola Facturación Aliquo (FINALIZADO, PASAR ALIQUO),
 *     Activación 1-Clic Contratos Mantenimiento CM26/CM27 -> EJEC. CONT. MANT. CONTRATADO y Control de las 4 Furgonetas.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3090', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const SEED_DIR = process.env.SEED_DIR ? path.resolve(process.env.SEED_DIR) : path.join(__dirname, 'seed');
const CATALOG_DIR = process.env.CATALOG_DIR ? path.resolve(process.env.CATALOG_DIR) : path.join(__dirname, 'catalog');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DB_FILE = path.join(DATA_DIR, 'sat_db.json');

// Prioridad de caché Aliquo: 1) sync en vivo en DATA_DIR, 2) imagen actualizada en CATALOG_DIR, 3) DATA_DIR, 4) repositorio padre
const LIVE_ALIQUO_FILE = path.join(DATA_DIR, 'clientes_aliquo_cache_live.json');
const CATALOG_ALIQUO_FILE = path.join(CATALOG_DIR, 'clientes_aliquo_cache.json');
const LOCAL_ALIQUO_FILE = path.join(DATA_DIR, 'clientes_aliquo_cache.json');
const EXTERNAL_ALIQUO_FILE = path.resolve(__dirname, '../03_Datos_Tarifas_y_Stock/clientes_aliquo_cache.json');
const ALIQUO_CACHE_FILE = [LIVE_ALIQUO_FILE, CATALOG_ALIQUO_FILE, LOCAL_ALIQUO_FILE, EXTERNAL_ALIQUO_FILE].find(f => fs.existsSync(f)) || LOCAL_ALIQUO_FILE;

// Asegurar carpetas
[PUBLIC_DIR, DATA_DIR, MEDIA_DIR, path.join(MEDIA_DIR, 'fichajes')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helper fecha/hora local España (Europe/Madrid -> "YYYY-MM-DD HH:MM")
function nowMadridStr(ms = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(ms));
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hr = map.hour === '24' ? '00' : map.hour;
    return `${map.year}-${map.month}-${map.day} ${hr}:${map.minute}`;
  } catch (e) {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function addDaysMadridDate(days = 7, baseMs = Date.now()) {
  return nowMadridStr(baseMs + days * 86400000).slice(0, 10);
}

function isEstadoFinalizado(estado) {
  const s = String(estado || '').toUpperCase();
  return (
    s.includes('FINALIZADO') ||
    s.includes('CANCELAD') ||
    s.includes('CERRAD') ||
    s.includes('ANULAD') ||
    s.includes('PASAR ALIQUO') ||
    s.includes('FACTURAD')
  );
}

function diffDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const clean = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const todayStr = nowMadridStr().slice(0, 10);
  const t1 = Date.parse(todayStr + 'T00:00:00Z');
  const t2 = Date.parse(clean + 'T00:00:00Z');
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round((t2 - t1) / 86400000);
}

function summarizeAvisoAlerta(a, extra = {}) {
  return {
    idAviso: a.idAviso,
    numero: a.numero,
    fecha: a.fecha || '',
    nombreCliente: a.nombreCliente || '',
    apellidosCliente: a.apellidosCliente || '',
    telefono1: a.telefono1 || '',
    poblacion: a.poblacion || '',
    marca: a.marca || '',
    modelo: a.modelo || '',
    docCompra: a.docCompra || '',
    estadoAviso: a.estadoAviso || '',
    tipoIntervencion: a.tipoIntervencion || '',
    esContratoObra: Boolean(a.esContratoObra),
    modalidadLogistica: a.modalidadLogistica || 'INSTALACION',
    pago50Verificado: Boolean(a.pago50Verificado),
    pedidoProveedorEstado: a.pedidoProveedorEstado || 'NO_APLICA',
    rematePendiente: Boolean(a.rematePendiente),
    remateFechaLimite: a.remateFechaLimite || '',
    ...extra
  };
}

function buildHistoricoRows(searchParams, authUser, maxRows = 200) {
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const estado = (searchParams.get('estado') || 'TODOS').trim().toUpperCase();
  const operario = (searchParams.get('operario') || 'TODOS').trim().toUpperCase();
  const tipoServicio = (searchParams.get('tipoServicio') || 'TODOS').trim().toUpperCase();
  const desde = (searchParams.get('desde') || '').trim().slice(0, 10);
  const hasta = (searchParams.get('hasta') || '').trim().slice(0, 10);

  const repByCode = new Map();
  for (const r of (db.repuestos || [])) {
    if (r.codigo) repByCode.set(String(r.codigo).toUpperCase(), r);
    if (r.idArticulo) repByCode.set(String(r.idArticulo).toUpperCase(), r);
  }

  const fichajesByAviso = new Map();
  for (const f of (db.fichajes || [])) {
    if (!f.idAviso) continue;
    const arr = fichajesByAviso.get(f.idAviso) || [];
    arr.push(f);
    fichajesByAviso.set(f.idAviso, arr);
  }

  let list = Array.isArray(db.avisos) ? db.avisos : [];
  if (authUser && authUser.lockedTechEmail) {
    const techTag = String(authUser.lockedTechEmail).split('@')[0].split('.')[0].toUpperCase();
    list = list.filter(a => String(a.operarioPreasignado || '').toUpperCase().includes(techTag));
  }

  const rows = [];
  for (const a of list) {
    const tServ = String(a.tipoServicio || 'SAT').toUpperCase() === 'MONTAJE_GOTERA' ? 'MONTAJE_GOTERA' : 'SAT';
    if (tipoServicio !== 'TODOS' && tServ !== tipoServicio) continue;

    const stUpper = String(a.estadoAviso || 'SIN PROCESAR').toUpperCase();
    if (estado === 'PENDIENTES' && isEstadoFinalizado(stUpper)) continue;
    else if (estado === 'FINALIZADOS' && !isEstadoFinalizado(stUpper)) continue;
    else if (estado !== 'TODOS' && estado !== 'PENDIENTES' && estado !== 'FINALIZADOS' && stUpper !== estado) continue;

    const fechaIn = String(a.fecha || '').slice(0, 10);
    if (desde && fechaIn && fechaIn < desde) continue;
    if (hasta && fechaIn && fechaIn > hasta) continue;

    const fList = fichajesByAviso.get(a.idAviso) || [];
    const lastF = fList[0] || null;
    const opStr = (lastF && lastF.operario ? String(lastF.operario).split('@')[0] : (a.operarioPreasignado || 'JACOBO')).toUpperCase();
    if (operario !== 'TODOS' && !opStr.includes(operario) && !String(a.operarioPreasignado || '').toUpperCase().includes(operario)) continue;

    if (q) {
      const hay = [
        a.numero, a.codigoCliente, a.nombreCliente, a.apellidosCliente,
        a.telefono1, a.poblacion, a.marca, a.modelo, a.observaciones, a.notasFichajes
      ].map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) continue;
    }

    let costeNetoRepuestos = 0;
    let pvpRepuestos = 0;
    const repParts = [];
    for (const f of fList) {
      for (const r of (Array.isArray(f.repuestosUsados) ? f.repuestosUsados : [])) {
        const qty = Number(r.cantidad || 1) || 1;
        const pvpUnit = Number(r.pvp ?? r.precio ?? 0) || 0;
        const cat = repByCode.get(String(r.codigo || '').toUpperCase()) || repByCode.get(String(r.idArticulo || '').toUpperCase());
        const netoUnit = Number(r.precioNeto ?? (cat ? cat.precioNeto : 0)) || 0;
        pvpRepuestos += pvpUnit * qty;
        costeNetoRepuestos += netoUnit * qty;
        repParts.push(`${qty}x ${r.descripcion || r.codigo || 'Repuesto'} (${pvpUnit.toFixed(2)}€)`);
      }
    }

    const totalFacturado = Number(a.sumaImportes || fList.reduce((s, f) => s + (Number(f.totalCobrado || f.importeTotal || 0)), 0)) || 0;
    const canCostes = Boolean(authUser && authUser.canSeeCostes);

    rows.push({
      idAviso: a.idAviso,
      numero: a.numero,
      fechaEntrada: a.fecha || '',
      fechaEjecucion: lastF ? (lastF.fin || lastF.inicio || '') : '',
      tipoServicio: tServ,
      estadoAviso: a.estadoAviso || 'SIN PROCESAR',
      codigoCliente: a.codigoCliente || '',
      clienteNombre: `${a.nombreCliente || ''} ${a.apellidosCliente || ''}`.trim(),
      poblacion: a.poblacion || '',
      maquina: `${a.tipoAparato || ''} ${a.marca || ''} ${a.modelo || ''}`.trim(),
      tipoIntervencion: a.tipoIntervencion || 'SAT NORMAL',
      operario: opStr,
      precioComunicado: a.precioComunicado !== undefined && a.precioComunicado !== null ? Number(a.precioComunicado) : null,
      importeAbonadoPrevio: Number(a.importeAbonadoPrevio || 0),
      estadoCobroPrevio: a.estadoCobroPrevio || 'PENDIENTE',
      metodoPagoPrevio: a.metodoPagoPrevio || '',
      fechaPagoPrevio: a.fechaPagoPrevio || '',
      totalFacturado: Number(totalFacturado.toFixed(2)),
      pvpRepuestos: Number(pvpRepuestos.toFixed(2)),
      costeNetoRepuestos: canCostes ? Number(costeNetoRepuestos.toFixed(2)) : null,
      margenRepuestos: canCostes ? Number((pvpRepuestos - costeNetoRepuestos).toFixed(2)) : null,
      formaCobro: lastF ? (lastF.formaCobro || '') : '',
      estadoCobro: lastF ? (lastF.estadoCobro || (lastF.cobrado ? 'COBRADO' : 'PENDIENTE')) : (a.estadoCobroPrevio || 'PENDIENTE'),
      repuestosTexto: repParts.join(' | '),
      observaciones: a.observaciones || '',
      notasTecnico: fList.map(f => f.trabajosRealizados || '').filter(Boolean).join(' / ') || a.notasFichajes || ''
    });
  }

  return {
    total: rows.length,
    rows: rows.slice(0, maxRows)
  };
}

function computeBuzonAlertas() {
  const avisos = Array.isArray(db.avisos) ? db.avisos : [];
  const citas = Array.isArray(db.citas) ? db.citas : [];

  const avisosConCita = new Set();
  for (const c of citas) {
    if (c.enCalendario === false) continue;
    if (c.idAviso) avisosConCita.add(String(c.idAviso));
    if (c.avisoNumero) avisosConCita.add(String(c.avisoNumero));
  }

  const sinPlanningAll = [];
  const pendienteSenal50All = [];
  const pedidosProveedorAll = [];
  const rematesUrgentesAll = [];

  for (const a of avisos) {
    const st = String(a.estadoAviso || '').toUpperCase().trim();
    const finalizado = isEstadoFinalizado(st);
    const tipoInt = String(a.tipoIntervencion || '').toUpperCase();
    const esContrato = Boolean(a.esContratoObra);
    const modalidad = String(a.modalidadLogistica || 'INSTALACION').toUpperCase();
    const tieneCita = avisosConCita.has(String(a.idAviso)) || avisosConCita.has(String(a.numero));

    if (!finalizado && (esContrato || tipoInt.includes('INSTALACI') || tipoInt.includes('MONTAJE')) && modalidad !== 'ENVIO_ALMACEN' && !tieneCita) {
      sinPlanningAll.push(summarizeAvisoAlerta(a));
    }

    if (!finalizado && esContrato && !a.pago50Verificado) {
      pendienteSenal50All.push(summarizeAvisoAlerta(a));
    }

    if (a.pedidoProveedorEstado === 'PENDIENTE' || st === 'PENDIENTE PEDIR MATERIAL/REPUESTO' || st === 'PEDIR MATERIAL') {
      pedidosProveedorAll.push(summarizeAvisoAlerta(a));
    }

    if (!finalizado && (a.rematePendiente === true || st === 'NUEVA CITA')) {
      const diasRestantes = diffDaysFromToday(a.remateFechaLimite);
      rematesUrgentesAll.push(summarizeAvisoAlerta(a, { diasRestantes }));
    }
  }

  rematesUrgentesAll.sort((x, y) => {
    const dx = x.diasRestantes === null ? 999 : x.diasRestantes;
    const dy = y.diasRestantes === null ? 999 : y.diasRestantes;
    return dx - dy;
  });

  return {
    counts: {
      sinPlanning: sinPlanningAll.length,
      pendienteSenal50: pendienteSenal50All.length,
      pedidosProveedor: pedidosProveedorAll.length,
      rematesUrgentes: rematesUrgentesAll.length
    },
    sinPlanning: sinPlanningAll.slice(0, 50),
    pendienteSenal50: pendienteSenal50All.slice(0, 50),
    pedidosProveedor: pedidosProveedorAll.slice(0, 50),
    rematesUrgentes: rematesUrgentesAll.slice(0, 50)
  };
}

function escapeHtmlServer(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function persistMediaDataUrl(dataUrl, subdir, filenameBase) {
  const val = String(dataUrl || '');
  const m = val.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!m) return val;
  try {
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const safeBase = String(filenameBase || 'asset').replace(/[^a-zA-Z0-9_-]/g, '');
    const relDir = path.join(MEDIA_DIR, subdir);
    if (!fs.existsSync(relDir)) fs.mkdirSync(relDir, { recursive: true });
    const fileName = `${safeBase}.${ext}`;
    fs.writeFileSync(path.join(relDir, fileName), Buffer.from(m[2], 'base64'));
    return `/media/${subdir}/${fileName}`;
  } catch (e) {
    console.warn('⚠️ Error persistiendo media en disco:', e.message);
    return val;
  }
}

function getNextAvisoNumero() {
  const maxNumero = (db.avisos || []).reduce(
    (max, a) => (a.numero > max && a.numero < 90000 ? a.numero : max),
    2710
  );
  return maxNumero + 1;
}

// =========================================================================
// AUTENTICACIÓN POR PIN Y PERMISOS POR ROL (FASES 1)
// =========================================================================
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.SAT_AUTH_SECRET || crypto.createHash('sha256').update('SAT_BAZA_2026_LAIBE_HMAC_KEY').digest('hex');

const PIN_USERS = [
  { id: 'juanpablo', nombre: 'Juan Pablo (Admin)', pin: process.env.PIN_ADMIN || '445215', roles: ['mando', 'tecnico', 'admin'], defaultRole: 'mando', canSeeAdmin: true, canSeeNotasAdmin: true, canSeeCostes: true, canEditTarifas: true, canExportContable: true, canCreateAviso: true, lockedTechEmail: null },
  { id: 'leandro', nombre: 'Leandro (Dirección)', pin: process.env.PIN_LEANDRO || '1347', roles: ['mando', 'tecnico', 'admin'], defaultRole: 'mando', canSeeAdmin: true, canSeeNotasAdmin: true, canSeeCostes: true, canEditTarifas: true, canExportContable: true, canCreateAviso: true, lockedTechEmail: null },
  { id: 'silvia', nombre: 'Silvia (Administración)', pin: process.env.PIN_SILVIA || '1010', roles: ['mando', 'tecnico', 'admin'], defaultRole: 'admin', canSeeAdmin: true, canSeeNotasAdmin: true, canSeeCostes: true, canEditTarifas: true, canExportContable: true, canCreateAviso: true, lockedTechEmail: null },
  { id: 'chus', nombre: 'Chus (Cuentas y Admin)', pin: process.env.PIN_CHUS || '2866', roles: ['mando', 'tecnico', 'admin'], defaultRole: 'admin', canSeeAdmin: true, canSeeNotasAdmin: true, canSeeCostes: true, canEditTarifas: true, canExportContable: true, canCreateAviso: true, lockedTechEmail: null },
  { id: 'jacobo', nombre: 'Jacobo (Jefe SAT)', pin: process.env.PIN_JACOBO || '9553', roles: ['mando', 'tecnico'], defaultRole: 'mando', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: true, lockedTechEmail: null },
  { id: 'rosa', nombre: 'Rosa (Atención/Comercial)', pin: process.env.PIN_ROSA || '1601', roles: ['mando'], defaultRole: 'mando', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: true, lockedTechEmail: null },
  { id: 'lidia', nombre: 'Lydia (SAT y Repuestos)', pin: process.env.PIN_LIDIA || '6272', roles: ['mando'], defaultRole: 'mando', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: true, lockedTechEmail: null },
  { id: 'alex', nombre: 'Alex (Técnico SAT)', pin: process.env.PIN_ALEX || '3102', roles: ['tecnico'], defaultRole: 'tecnico', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: true, lockedTechEmail: 'alejandro.bazamazano@gmail.com' },
  { id: 'dioni', nombre: 'Dioni (Técnico SAT)', pin: process.env.PIN_DIONI || '3204', roles: ['tecnico'], defaultRole: 'tecnico', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: false, lockedTechEmail: 'dioni.bazamazano@gmail.com' },
  { id: 'roberto', nombre: 'Roberto (Técnico SAT)', pin: process.env.PIN_ROBERTO || '3305', roles: ['tecnico'], defaultRole: 'tecnico', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: false, lockedTechEmail: 'rober.bazamazano@gmail.com' },
  { id: 'ismael', nombre: 'Isma (Técnico SAT)', pin: process.env.PIN_ISMAEL || '3406', roles: ['tecnico'], defaultRole: 'tecnico', canSeeAdmin: false, canSeeNotasAdmin: false, canSeeCostes: false, canEditTarifas: false, canExportContable: false, canCreateAviso: false, lockedTechEmail: 'isma.bazamazano@gmail.com' }
];

const VEHICULOS_OFICIALES = [
  '7206GDH - OPEL VIVARO COM6',
  '0986FVB - MERCEDES SPRINTER 300 EXTRALARGA',
  '9390HSV - DACIA DOKKER 1.5DCI',
  '6572KPN - MERCEDES SPRINTER FURGON 311CDI',
  '6772LPF - HONDA FORZA 750 (MOTO)',
  '5823NBT - RENAULT RAFALE 1.2 E-TECH PHEV',
  '4037NJX - RENAULT TRAFIC L1H1 BLUEDCI 130',
  '9851MFL - RENAULT KANGOO E-TECH EV45'
];

function signAuthToken(user) {
  const payload = {
    id: user.id,
    nombre: user.nombre,
    roles: user.roles,
    defaultRole: user.defaultRole,
    canSeeAdmin: Boolean(user.canSeeAdmin),
    canSeeNotasAdmin: Boolean(user.canSeeNotasAdmin),
    canSeeCostes: Boolean(user.canSeeCostes),
    canEditTarifas: Boolean(user.canEditTarifas),
    canExportContable: Boolean(user.canExportContable),
    canCreateAviso: Boolean(user.canCreateAviso),
    lockedTechEmail: user.lockedTechEmail,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 días de sesión en furgoneta/nave
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(b64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!payload || (payload.exp && payload.exp < Date.now())) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function extractRequestUser(req, parsedUrl) {
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = parsedUrl && parsedUrl.searchParams ? (parsedUrl.searchParams.get('token') || '') : '';
  return verifyAuthToken(bearer || queryToken);
}

// Coordenadas Base Baza Mazano (C/ Annapurna 22, Pinar de Jalón, 47013 Valladolid)
const HQ_COORDS = { lat: 41.6191565, lng: -4.7209136 };

// Catálogo maestro de municipios de la provincia (con códigos postales, coordenadas y km ida/vuelta desde C/ Annapurna 22)
// IMPORTANTE: Los pueblos de fuera se comprueban SIEMPRE primero para no colapsar en "Valladolid" capital.
const OUTSIDE_TOWNS = [
  { name: 'CIGALES', cps: ['47270'], lat: 41.7581, lng: -4.6997, km: 34 },
  { name: 'ALDEAMAYOR DE SAN MARTIN', alias: ['ALDEAMAYOR', 'ALDEAMAYOR GOLF'], cps: ['47162'], lat: 41.5125, lng: -4.6394, km: 32 },
  { name: 'SIMANCAS', alias: ['ENTREPINOS', 'PAGO LA BARCA', 'PANORAMA', 'EL PICHON', 'LAS ACENAS'], cps: ['47130'], lat: 41.5906, lng: -4.8269, km: 28 },
  { name: 'TUDELA DE DUERO', alias: ['TUDELA'], cps: ['47320'], lat: 41.5844, lng: -4.5806, km: 30 },
  { name: 'ARROYO DE LA ENCOMIENDA', alias: ['ARROYO', 'LA FLECHA', 'SOTOVERDE', 'LAS LOMAS'], cps: ['47195'], lat: 41.6096, lng: -4.7959, km: 20 },
  { name: 'RENEDO DE ESGUEVA', alias: ['RENEDO', 'CASASOLA'], cps: ['47170'], lat: 41.6536, lng: -4.6278, km: 20 },
  { name: 'LAGUNA DE DUERO', alias: ['LAGUNA', 'TORRELAGO'], cps: ['47140', '47153'], lat: 41.5831, lng: -4.7233, km: 12 },
  { name: 'BOECILLO', alias: ['PAGO DEL NOGAL', 'PARQUE TECNOLOGICO'], cps: ['47151'], lat: 41.5408, lng: -4.6997, km: 22 },
  { name: 'VIANA DE CEGA', alias: ['VIANA'], cps: ['47150'], lat: 41.5331, lng: -4.7511, km: 26 },
  { name: 'VILLABAÑEZ', alias: ['VILLABANEZ', 'SANTIBAÑEZ', 'SANTIBANEZ'], cps: ['47329'], lat: 41.5701, lng: -4.4511, km: 46 },
  { name: 'TRASPINEDO', cps: ['47330'], lat: 41.5756, lng: -4.4739, km: 44 },
  { name: 'ZARATAN', alias: ['ZARATÁN'], cps: ['47610'], lat: 41.6603, lng: -4.7836, km: 22 },
  { name: 'CABEZON DE PISUERGA', alias: ['CABEZON'], cps: ['47260'], lat: 41.7339, lng: -4.6464, km: 30 },
  { name: 'LA CISTERNIGA', alias: ['CISTERNIGA'], cps: ['47193'], lat: 41.6021, lng: -4.6852, km: 8 },
  { name: 'PINAR DE ANTEQUERA', cps: ['47153'], lat: 41.5889, lng: -4.7561, km: 12 },
  { name: 'PUENTE DUERO', cps: ['47200'], lat: 41.5567, lng: -4.7892, km: 22 },
  { name: 'VILLANUEVA DE DUERO', alias: ['VILLANUEVA'], cps: ['47239'], lat: 41.5178, lng: -4.7733, km: 32 },
  { name: 'FUENSALDAÑA', alias: ['FUENSALDANA'], cps: ['47194'], lat: 41.7078, lng: -4.7653, km: 26 },
  { name: 'MUCENTES', cps: ['47196'], lat: 41.7439, lng: -4.7622, km: 34 },
  { name: 'LA PEDRAJA DE PORTILLO', alias: ['LA PEDRAJA'], cps: ['47196'], lat: 41.4722, lng: -4.6739, km: 40 },
  { name: 'PORTILLO', alias: ['ARRABAL DE PORTILLO'], cps: ['47160', '47161'], lat: 41.4783, lng: -4.5881, km: 46 },
  { name: 'MOJADOS', cps: ['47250', '47219'], lat: 41.4314, lng: -4.6647, km: 48 },
  { name: 'TORDESILLAS', cps: ['47100'], lat: 41.5008, lng: -5.0003, km: 62 },
  { name: 'SANTOVENIA DE PISUERGA', alias: ['SANTOVENIA'], cps: ['47250', '47155'], lat: 41.6961, lng: -4.6889, km: 18 },
  { name: 'CASTRONUEVO DE ESGUEVA', alias: ['CASTRONUEVO'], cps: ['47171'], lat: 41.6811, lng: -4.5908, km: 28 },
  { name: 'MONTEMAYOR DE PILILLA', alias: ['MONTEMAYOR'], cps: ['47320'], lat: 41.5089, lng: -4.4578, km: 60 },
  { name: 'ISCAR', alias: ['ISCAR'], cps: ['47420'], lat: 41.3617, lng: -4.5339, km: 80 },
  { name: 'PEDRAJAS DE SAN ESTEBAN', alias: ['PEDRAJAS'], cps: ['47430'], lat: 41.3419, lng: -4.5808, km: 82 },
  { name: 'MEDINA DEL CAMPO', alias: ['MEDINA'], cps: ['47400'], lat: 41.3086, lng: -4.9150, km: 92 },
  { name: 'OLMEDO', cps: ['47410'], lat: 41.2872, lng: -4.6867, km: 84 },
  { name: 'PEÑAFIEL', alias: ['PENAFIEL'], cps: ['47300'], lat: 41.5969, lng: -4.1189, km: 112 },
  { name: 'MEDINA DE RIOSECO', alias: ['RIOSECO'], cps: ['47800'], lat: 41.8831, lng: -5.0431, km: 86 },
  { name: 'VILLANUBLA', cps: ['47620'], lat: 41.7011, lng: -4.8447, km: 30 },
  { name: 'GERIA', cps: ['47131'], lat: 41.5789, lng: -4.8769, km: 34 },
  { name: 'VALDESTILLAS', cps: ['47240'], lat: 41.4767, lng: -4.7706, km: 40 },
  { name: 'MATAPOZUELOS', cps: ['47230'], lat: 41.4122, lng: -4.7906, km: 54 },
  { name: 'SERRADA', cps: ['47231'], lat: 41.4592, lng: -4.8350, km: 46 },
  { name: 'SARDON DE DUERO', alias: ['SARDON'], cps: ['47340'], lat: 41.6083, lng: -4.4333, km: 50 },
  { name: 'QUINTANILLA DE ONESIMO', alias: ['QUINTANILLA'], cps: ['47350'], lat: 41.6258, lng: -4.3644, km: 66 },
  { name: 'WAMBA', cps: ['47190'], lat: 41.6767, lng: -4.9181, km: 42 },
  { name: 'PALENCIA', cps: ['34001','34002','34003','34004','34005'], lat: 42.0096, lng: -4.5288, km: 96 },
  { name: 'DUEÑAS', alias: ['DUENAS'], cps: ['34210'], lat: 41.8769, lng: -4.5469, km: 64 },
  { name: 'CUELLAR', alias: ['CUELLAR'], cps: ['40200'], lat: 41.4011, lng: -4.3161, km: 100 }
];

const VALLADOLID_CAPITAL = { name: 'VALLADOLID', lat: 41.6523, lng: -4.7245, km: 12 };

function inferGeo(address, seedIndex = 1) {
  const norm = String(address || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  let matched = null;

  for (const t of OUTSIDE_TOWNS) {
    if (t.cps && t.cps.some(cp => norm.includes(cp))) {
      matched = t;
      break;
    }
    const allNames = [t.name, ...(t.alias || [])];
    for (const n of allNames) {
      const nNorm = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const regex = new RegExp('\\b' + nNorm + '\\b');
      if (regex.test(norm)) {
        matched = t;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    matched = VALLADOLID_CAPITAL;
  }

  const seed = Number(seedIndex) || 1;
  const dLat = ((seed * 9301 + 49297) % 233280) / 233280 * 0.012 - 0.006;
  const dLng = ((seed * 49297 + 9301) % 233280) / 233280 * 0.016 - 0.008;

  return {
    lat: Number((matched.lat + dLat).toFixed(5)),
    lng: Number((matched.lng + dLng).toFixed(5)),
    kmIdaVuelta: matched.km,
    poblacionDetectada: matched.name
  };
}

// Configuración por defecto de costes reales SAT (basada en CONTABILIDAD SAT BAZA.xlsx)
const DEFAULT_COSTES_CONFIG = {
  costeHoraOperarios: {
    JACOBO: 51.00,
    ALEX: 24.24,
    ROBERTO: 25.54,
    DIONI: 24.00,
    ISMAEL: 24.24,
    ISMA: 24.24
  },
  costeAdminPorAviso: 20.00,
  ivaDefecto: 0.21,
  velocidadMediaKmH: 55,
  costeKmDefault: 0.25,
  costeHoraVehiculoDefault: 5.00,
  vehiculosCoste: {
    '7206GDH': { alias: 'Opel Vivaro (Jacobo)', costeKm: 0.25, costeHora: 5.00 },
    '0986FVB': { alias: 'Mercedes Sprinter (Montaje)', costeKm: 0.25, costeHora: 5.00 },
    '9390HSV': { alias: 'Dacia Dokker (Dioni/Rober)', costeKm: 0.11, costeHora: 2.00 },
    '6572KPN': { alias: 'Mercedes Sprinter 311', costeKm: 0.25, costeHora: 5.00 },
    '6772LPF': { alias: 'Honda Forza 750', costeKm: 0.10, costeHora: 2.00 },
    '5823NBT': { alias: 'Renault Rafale', costeKm: 0.15, costeHora: 3.00 },
    '4037NJX': { alias: 'Renault Trafic', costeKm: 0.14, costeHora: 3.00 },
    '9851MFL': { alias: 'Renault Kangoo EV', costeKm: 0.05, costeHora: 2.00 }
  }
};

function getCostesConfig() {
  const cfg = db.costesConfig || {};
  return {
    costeHoraOperarios: { ...DEFAULT_COSTES_CONFIG.costeHoraOperarios, ...(cfg.costeHoraOperarios || {}) },
    costeAdminPorAviso: cfg.costeAdminPorAviso !== undefined ? Number(cfg.costeAdminPorAviso) : DEFAULT_COSTES_CONFIG.costeAdminPorAviso,
    ivaDefecto: cfg.ivaDefecto !== undefined ? Number(cfg.ivaDefecto) : DEFAULT_COSTES_CONFIG.ivaDefecto,
    velocidadMediaKmH: cfg.velocidadMediaKmH !== undefined ? Number(cfg.velocidadMediaKmH) : DEFAULT_COSTES_CONFIG.velocidadMediaKmH,
    costeKmDefault: cfg.costeKmDefault !== undefined ? Number(cfg.costeKmDefault) : DEFAULT_COSTES_CONFIG.costeKmDefault,
    costeHoraVehiculoDefault: cfg.costeHoraVehiculoDefault !== undefined ? Number(cfg.costeHoraVehiculoDefault) : DEFAULT_COSTES_CONFIG.costeHoraVehiculoDefault,
    vehiculosCoste: { ...DEFAULT_COSTES_CONFIG.vehiculosCoste, ...(cfg.vehiculosCoste || {}) }
  };
}

function resolveOperarioCosteHora(opString, costeHoraOperarios) {
  const s = String(opString || '').toUpperCase().trim();
  if (!s) return costeHoraOperarios.JACOBO || 51.00;
  for (const [k, v] of Object.entries(costeHoraOperarios)) {
    if (s.includes(k)) return Number(v) || 24.24;
  }
  return 24.24;
}

function isAvisoAnulado(estado) {
  const s = String(estado || '').toUpperCase();
  return s.includes('ANULAD') || s.includes('CANCELAD');
}

function calcularRentabilidadAviso(aviso, fichajesAviso, costesConfig, repByCode) {
  const fList = Array.isArray(fichajesAviso) ? fichajesAviso : [];
  const estadoUpper = String(aviso.estadoAviso || '').toUpperCase();
  const anulado = isAvisoAnulado(estadoUpper);

  // Ingreso bruto: suma de fichajes terminados o sumaImportes o precioComunicado si ya finalizado
  const sumaFichajes = fList.reduce((s, f) => s + (Number(f.importe ?? f.totalCobrado ?? 0) || 0), 0);
  const ingresosBrutos = Number(aviso.sumaImportes || sumaFichajes || 0);
  const iva = Number(costesConfig.ivaDefecto ?? 0.21);
  const ingresosNetos = Number((ingresosBrutos / (1 + iva)).toFixed(2));

  let minutosIntervencion = 0;
  let costeMoIntervencion = 0;
  let minutosDesplazamiento = 0;
  let costeMoDesplazamiento = 0;
  let costeVehiculoKm = 0;
  let costeVehiculoFijo = 0;
  let costeNetoRepuestos = 0;
  let kmTotales = 0;

  const velKmH = Math.max(20, Number(costesConfig.velocidadMediaKmH) || 55);

  if (fList.length > 0) {
    for (const f of fList) {
      const mins = Math.max(0, Number(f.minutosTrabajados) || 0);
      minutosIntervencion += mins;

      const op1Rate = resolveOperarioCosteHora(f.operario || aviso.operarioPreasignado, costesConfig.costeHoraOperarios);
      const op2Rate = f.companeroApoyo ? resolveOperarioCosteHora(f.companeroApoyo, costesConfig.costeHoraOperarios) : 0;
      const rateTotal = op1Rate + op2Rate;

      costeMoIntervencion += (mins / 60) * rateTotal;

      const km = Math.max(0, Number(f.kmCalculados ?? aviso.kmIdaVuelta ?? 0) || 0);
      kmTotales += km;
      const minsViaje = f.minutosDesplazamiento !== undefined
        ? Math.max(0, Number(f.minutosDesplazamiento) || 0)
        : (km > 0 ? Math.round((km / velKmH) * 60) : 0);
      minutosDesplazamiento += minsViaje;
      costeMoDesplazamiento += (minsViaje / 60) * rateTotal;

      const mat = String(f.matricula || aviso.matricula || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
      const vCfg = costesConfig.vehiculosCoste[mat] || null;
      const cKm = vCfg ? Number(vCfg.costeKm) : Number(costesConfig.costeKmDefault || 0.25);
      const cHoraV = vCfg ? Number(vCfg.costeHora) : Number(costesConfig.costeHoraVehiculoDefault || 5.00);

      costeVehiculoKm += km * cKm;
      costeVehiculoFijo += ((mins + minsViaje) / 60) * cHoraV;

      for (const r of (Array.isArray(f.repuestosUsados) ? f.repuestosUsados : [])) {
        const qty = Number(r.cantidad || 1) || 1;
        const cat = repByCode.get(String(r.codigo || '').toUpperCase()) || repByCode.get(String(r.idArticulo || '').toUpperCase());
        const netoUnit = Number(r.precioNeto ?? (cat ? cat.precioNeto : 0)) || 0;
        costeNetoRepuestos += netoUnit * qty;
      }
    }
  } else {
    // Aviso sin fichajes aún: estimar desplazamiento si tiene kmIdaVuelta y no está anulado
    kmTotales = !anulado ? Math.max(0, Number(aviso.kmIdaVuelta) || 0) : 0;
  }

  // Coste de oficina (20€): se aplica a TODO salvo avisos ANULADOS/CANCELADOS
  const costeGestionOficina = anulado ? 0 : Number(costesConfig.costeAdminPorAviso ?? 20.00);

  const costeTotalReal = Number((
    costeMoIntervencion +
    costeMoDesplazamiento +
    costeVehiculoKm +
    costeVehiculoFijo +
    costeGestionOficina +
    costeNetoRepuestos
  ).toFixed(2));

  const beneficioNetoReal = Number((ingresosNetos - costeTotalReal).toFixed(2));
  const margenPct = ingresosNetos > 0 ? Number(((beneficioNetoReal / ingresosNetos) * 100).toFixed(1)) : (costeTotalReal > 0 ? -100 : 0);

  const flagsFuga = [];
  if (fList.length > 1) flagsFuga.push('SEGUNDA_VISITA');
  if (!anulado && (ingresosBrutos > 0 || fList.length > 0) && beneficioNetoReal < 0) flagsFuga.push('MARGEN_NEGATIVO');
  const tipoIntUpper = String(aviso.tipoIntervencion || '').toUpperCase();
  if (tipoIntUpper.includes('GARANT') && beneficioNetoReal < 0) flagsFuga.push('GARANTIA_DEFICITARIA');
  const costeViajeTotal = costeMoDesplazamiento + costeVehiculoKm + costeVehiculoFijo;
  if (!anulado && costeViajeTotal > 0 && (ingresosNetos > 0 ? (costeViajeTotal / ingresosNetos) > 0.40 : costeViajeTotal > 30)) {
    flagsFuga.push('DESPLAZAMIENTO_CARO');
  }

  return {
    idAviso: aviso.idAviso,
    numero: aviso.numero,
    fecha: aviso.fecha || '',
    clienteNombre: `${aviso.nombreCliente || ''} ${aviso.apellidosCliente || ''}`.trim(),
    poblacion: aviso.poblacion || '',
    maquina: `${aviso.marca || ''} ${aviso.modelo || ''}`.trim() || aviso.tipoAparato || '',
    tipoIntervencion: aviso.tipoIntervencion || 'SAT NORMAL',
    estadoAviso: aviso.estadoAviso || 'SIN PROCESAR',
    operario: fList[0]?.operario ? String(fList[0].operario).split('@')[0].toUpperCase() : String(aviso.operarioPreasignado || 'SIN ASIGNAR').toUpperCase(),
    numVisitas: fList.length,
    minutosIntervencion,
    minutosDesplazamiento,
    kmTotales: Number(kmTotales.toFixed(1)),
    ingresosBrutos: Number(ingresosBrutos.toFixed(2)),
    ingresosNetos,
    costeMoIntervencion: Number(costeMoIntervencion.toFixed(2)),
    costeMoDesplazamiento: Number(costeMoDesplazamiento.toFixed(2)),
    costeVehiculoKm: Number(costeVehiculoKm.toFixed(2)),
    costeVehiculoFijo: Number(costeVehiculoFijo.toFixed(2)),
    costeGestionOficina: Number(costeGestionOficina.toFixed(2)),
    costeNetoRepuestos: Number(costeNetoRepuestos.toFixed(2)),
    costeTotalReal,
    beneficioNetoReal,
    margenPct,
    flagsFuga
  };
}

// Cargar base de datos principal SAT
let db = {
  meta: {},
  tarifas: {},
  costesConfig: null,
  operarios: [],
  marcas: [],
  repuestos: [],
  gastosVehiculos: [],
  gastosSat: [],
  contratosCm: [],
  citas: [],
  fichajes: [],
  avisos: []
};

function loadDb() {
  try {
    const seedDbFile = path.join(SEED_DIR, 'sat_db.json');
    if (!fs.existsSync(DB_FILE) && fs.existsSync(seedDbFile)) {
      fs.copyFileSync(seedDbFile, DB_FILE);
      console.log('🌱 Primer arranque en volumen vacío: sat_db.json copiado desde /app/seed.');
    }
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log(`✅ Base de datos SAT Baza Mazano 2.0 cargada: ${db.avisos.length} avisos, ${db.citas.length} citas, ${db.fichajes.length} fichajes, ${db.contratosCm.length} contratos CM.`);
    } else {
      console.warn('⚠️ No se encontró sat_db.json, ejecuta scripts/seed_from_excel.mjs primero.');
    }
  } catch (e) {
    console.error('❌ Error leyendo sat_db.json:', e.message);
  }
}
loadDb();

// Cargar caché local de clientes Aliquo como respaldo instantáneo
let aliquoLocalCache = [];
try {
  if (fs.existsSync(ALIQUO_CACHE_FILE)) {
    aliquoLocalCache = JSON.parse(fs.readFileSync(ALIQUO_CACHE_FILE, 'utf8'));
    console.log(`📦 Caché local de clientes Aliquo cargada: ${aliquoLocalCache.length} clientes (fuente: ${path.basename(path.dirname(ALIQUO_CACHE_FILE))}/${path.basename(ALIQUO_CACHE_FILE)}).`);
  }
} catch (e) {
  console.warn('⚠️ No se pudo cargar clientes_aliquo_cache.json:', e.message);
}

let saveTimeout = null;
function writeDbAtomicSync() {
  try {
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    db.meta.counts = {
      avisos: (db.avisos || []).length,
      contratosCm: (db.contratosCm || []).length,
      citas: (db.citas || []).length,
      fichajes: (db.fichajes || []).length,
      operarios: (db.operarios || []).length,
      gastosVehiculos: (db.gastosVehiculos || []).length,
      repuestos: (db.repuestos || []).length,
      marcas: (db.marcas || []).length
    };
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (e) {
    console.error('❌ Error guardando sat_db.json:', e.message);
  }
}

function saveDb(immediate = false) {
  if (saveTimeout) clearTimeout(saveTimeout);
  if (immediate) {
    saveTimeout = null;
    writeDbAtomicSync();
    return;
  }
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    writeDbAtomicSync();
  }, 150);
}

// =========================================================================
// CONEXIÓN EN VIVO A ALIQUO SQL SERVER WEBAPI (Lectura en Fase 1)
// =========================================================================
const ALIQUO_KEYS = [
  process.env.ALIQUO_API_KEY_1 || 'GFRHR9pjtuJyNTW7XSZ3Ol5WiFK78UHI',
  process.env.ALIQUO_API_KEY_2 || 'CKqkRyKYdoZyNTW7XSZ3OlKtAx5tZlRQ'
].filter(Boolean);

function queryAliquoLive(sql, apiKeyIndex = 0) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.aliquo.software',
      path: '/GetQuery',
      method: 'POST',
      timeout: 4500,
      headers: {
        'X-ApiKey': ALIQUO_KEYS[apiKeyIndex] || ALIQUO_KEYS[0],
        'X-ApiVersion': '1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : (parsed.data || []));
          } catch (e) {
            resolve([]);
          }
        } else if (apiKeyIndex === 0 && ALIQUO_KEYS.length > 1) {
          queryAliquoLive(sql, 1).then(resolve).catch(reject);
        } else {
          reject(new Error(`Aliquo HTTP ${res.statusCode}: ${data.slice(0, 180)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Aliquo SQL timeout'));
    });
    req.on('error', err => {
      if (apiKeyIndex === 0 && ALIQUO_KEYS.length > 1) {
        queryAliquoLive(sql, 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    req.write(postData);
    req.end();
  });
}

function callAliquoApi(method, apiPath, bodyObj = null, apiKeyIndex = 0) {
  return new Promise((resolve, reject) => {
    const postData = bodyObj !== null ? JSON.stringify(bodyObj) : '';
    const headers = {
      'X-ApiKey': ALIQUO_KEYS[apiKeyIndex] || ALIQUO_KEYS[0],
      'X-ApiVersion': '1.0',
      'Accept': 'application/json'
    };
    if (bodyObj !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request({
      hostname: 'api.aliquo.software',
      path: apiPath,
      method,
      timeout: 12000,
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, statusCode: res.statusCode, data: parsed });
        } else if (apiKeyIndex === 0 && ALIQUO_KEYS.length > 1 && (res.statusCode === 401 || res.statusCode === 403)) {
          callAliquoApi(method, apiPath, bodyObj, 1).then(resolve).catch(reject);
        } else {
          const msg = (parsed && (parsed.Message || parsed.message || parsed.title)) || String(data).slice(0, 260);
          reject(new Error(`Aliquo HTTP ${res.statusCode}: ${msg}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Aliquo API timeout (12s)')));
    req.on('error', err => {
      if (apiKeyIndex === 0 && ALIQUO_KEYS.length > 1) {
        callAliquoApi(method, apiPath, bodyObj, 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    if (bodyObj !== null) req.write(postData);
    req.end();
  });
}

function getDefaultAliquoSerial() {
  if (process.env.ALIQUO_SERIAL_CODE) return String(process.env.ALIQUO_SERIAL_CODE).trim().toUpperCase();
  const yr = String(new Date().getFullYear()).slice(-2);
  return `S${yr}`;
}

function resolveAliquoServiceCode(tipoIntervencion) {
  const t = String(tipoIntervencion || '').toUpperCase();
  if (t.includes('PUESTA EN MARCHA')) return 'MARCHA';
  if (t.includes('DESHOLLIN') && t.includes('MANT')) return 'DESMANLIMEN';
  if (t.includes('DESHOLLIN')) {
    const m = new Date().getMonth() + 1;
    return (m >= 5 && m <= 9) ? 'LIMDESMASEP' : 'DESOCA';
  }
  return 'MOBRA';
}

function formatDateEsShort(isoStr) {
  const s = String(isoStr || nowMadridStr()).slice(0, 10);
  const parts = s.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s;
}

async function buildAliquoVolcadoPreview(aviso, fichaje, opts = {}) {
  const serialCode = String(opts.serialCode || getDefaultAliquoSerial()).trim().toUpperCase();
  const desglose = (fichaje && fichaje.desgloseTarifa) || {};
  const repuestos = Array.isArray(fichaje && fichaje.repuestosUsados) ? fichaje.repuestosUsados : [];
  const rawCodFull = String(aviso.codigoCliente || '').trim().toUpperCase();
  const rawCod = rawCodFull.split(/\s*[-|]\s*/)[0].trim();
  const hasRealCode = Boolean(rawCod) && rawCod !== 'NO ES CLIENTE' && rawCod !== 'CLIENTE' && !rawCodFull.startsWith('NO ES CLIENTE');

  // Consultar en vivo si el cliente existe en Aliquo y leer sus Observaciones ("Varios") actuales
  let clienteExisteEnAliquo = false;
  let aliquoObservacionesPrevias = '';
  let clienteAliquoLive = null;
  if (hasRealCode) {
    try {
      const safeCod = rawCod.replace(/'/g, "''");
      const rows = await queryAliquoLive(`SELECT TOP 1 Codigo, Nombre, Observaciones FROM Clientes WHERE Codigo = '${safeCod}'`);
      if (Array.isArray(rows) && rows.length > 0) {
        clienteExisteEnAliquo = true;
        clienteAliquoLive = rows[0];
        aliquoObservacionesPrevias = String(rows[0].Observaciones || '').trim();
      }
    } catch (e) {
      // Si falla la lectura puntual, no bloqueamos el preview
    }
  }

  // Construir líneas oficiales para POST /Note (SalesDeliveryNote, pricesIncludedVAT: true, storeCode: 'Alm')
  const lines = [];
  let order = 1;
  const pushLine = (code, name, quantity, retailPrice) => {
    const qty = Number(quantity) || 1;
    const pvp = Number(Number(retailPrice || 0).toFixed(2));
    lines.push({
      type: 'Product',
      order: order++,
      code: String(code || 'MOBRA').trim().toUpperCase(),
      name: String(name || 'SERVICIO TÉCNICO SAT').slice(0, 100),
      quantity: qty,
      retailPrice: pvp,
      codeVAT: 'IVA21',
      percentVAT: 21,
      storeCode: 'Alm',
      printable: true
    });
  };

  if (Number(desglose.costeTarifaFija || 0) > 0) {
    pushLine(
      resolveAliquoServiceCode(aviso.tipoIntervencion),
      `${aviso.tipoIntervencion || 'SERVICIO SAT'} - ${aviso.marca || ''} ${aviso.modelo || ''}`.trim(),
      1,
      desglose.costeTarifaFija
    );
  }
  if (Number(desglose.costeSalida || 0) > 0) {
    pushLine('SALIDA', 'SALIDA TÉCNICA SAT (incluye hasta 30 km I/V)', 1, desglose.costeSalida);
  }
  if (Number(desglose.costeManoObra || 0) > 0) {
    const horas = Number(((fichaje.minutosTrabajados || 60) / 60).toFixed(2));
    const pvpHora = horas > 0 ? Number((desglose.costeManoObra / horas).toFixed(2)) : desglose.costeManoObra;
    pushLine('MOBRA', `MANO DE OBRA SAT (${fichaje.minutosTrabajados || 60} min) - ${fichaje.operario || aviso.operarioPreasignado || ''}`.trim(), horas, pvpHora);
  }
  if (Number(desglose.costeKmExtra || 0) > 0) {
    pushLine('DESPLAZA', `DESPLAZAMIENTO KM EXTRA (${desglose.kmExtra || 0} km extra I/V)`, 1, desglose.costeKmExtra);
  }
  for (const r of repuestos) {
    const qty = Number(r.cantidad || 1) || 1;
    const pvpUnit = Number(r.pvp ?? r.precio ?? 0) || 0;
    pushLine(r.codigo || 'MOBRA', r.descripcion || r.nombre || 'REPUESTO SAT', qty, pvpUnit);
  }
  if (lines.length === 0) {
    const totalFallback = Number(fichaje.totalCobrado || fichaje.importe || aviso.sumaImportes || 0);
    pushLine(
      resolveAliquoServiceCode(aviso.tipoIntervencion),
      `INTERVENCIÓN SAT #${aviso.numero} (${aviso.tipoIntervencion || 'SAT NORMAL'})`,
      1,
      totalFallback
    );
  }

  const totalImporte = Number(lines.reduce((s, l) => s + (l.quantity * l.retailPrice), 0).toFixed(2));
  const fechaEs = formatDateEsShort(fichaje.fin || aviso.fecha);
  const opNombre = String(fichaje.operario || aviso.operarioPreasignado || 'TÉCNICO').split('@')[0].split('.')[0].toUpperCase();
  const notaOficina = String(aviso.observaciones || '').trim();
  const notaTecnico = String(fichaje.trabajosRealizados || fichaje.notas || aviso.notasFichajes || '').trim();

  const bloques = [];
  if (notaOficina) bloques.push(`[OFICINA ${fechaEs} | SAT #${aviso.numero}]: ${notaOficina}`);
  if (notaTecnico) bloques.push(`[TÉCNICO ${fechaEs} - ${opNombre} | SAT #${aviso.numero}]: ${notaTecnico}`);
  if (bloques.length === 0) bloques.push(`[SAT #${aviso.numero} - ${fechaEs}]: Intervención finalizada (${aviso.tipoIntervencion || 'SAT NORMAL'})`);
  const bloqueAnexarVarios = bloques.join('\n');
  const observacionesVariosFinal = aliquoObservacionesPrevias
    ? `${aliquoObservacionesPrevias}\n\n${bloqueAnexarVarios}`
    : bloqueAnexarVarios;

  const notePayload = {
    type: 'SalesDeliveryNote',
    serialCode,
    date: `${nowMadridStr().slice(0, 10)}T00:00:00`,
    propertyCode: hasRealCode ? rawCod : generarCodigoClienteAliquo(),
    storeCode: 'Alm',
    pricesIncludedVAT: true,
    reference: `SAT #${aviso.numero}`,
    description: `${aviso.tipoIntervencion || 'SAT'} · ${aviso.marca || ''} ${aviso.modelo || ''}`.trim().slice(0, 100),
    observations: bloqueAnexarVarios,
    lines
  };

  return {
    idAviso: aviso.idAviso,
    numero: aviso.numero,
    yaVolcadoReal: Boolean(aviso.aliquoRealSynced),
    aliquoDocPrevio: aviso.aliquoDoc || null,
    aliquoIdNotaPrevio: aviso.aliquoIdNota || null,
    serialCode,
    clienteCodigo: notePayload.propertyCode,
    clienteNombre: `${aviso.nombreCliente || ''} ${aviso.apellidosCliente || ''}`.trim(),
    clienteExisteEnAliquo,
    clienteAliquoLive,
    totalImporte,
    aliquoObservacionesPrevias,
    bloqueAnexarVarios,
    observacionesVariosFinal,
    notePayload
  };
}

// =========================================================================
// PASO 1: GENERACIÓN Y VOLCADO AUTOMÁTICO DE ALBARÁN A ALIQUO ERP
// =========================================================================
function sincronizarAlbaranConAliquo(aviso, fichaje) {
  const desglose = fichaje.desgloseTarifa || {};
  const repuestos = Array.isArray(fichaje.repuestosUsados) ? fichaje.repuestosUsados : [];
  const numeroAlbaran = `ALB-SAT-${aviso.numero}`;

  const lineas = [];

  // 1. Línea Mano de Obra
  if (desglose.costeManoObra > 0) {
    lineas.push({
      articulo: 'SAT_MO',
      descripcion: `Mano de Obra SAT (${fichaje.minutosTrabajados || 45} min) - ${fichaje.operario}`,
      unidades: Number(((fichaje.minutosTrabajados || 45) / 60).toFixed(2)),
      pvp: 60.00,
      total: Number(desglose.costeManoObra.toFixed(2))
    });
  }

  // 2. Línea Salida y Desplazamiento
  const salida = Number(desglose.costeSalida || 0);
  const kmExtra = Number(desglose.costeKmExtra || 0);
  if (salida > 0 || kmExtra > 0) {
    lineas.push({
      articulo: 'SAT_DESP',
      descripcion: `Salida SAT (incluye 30 km I/V desde Annapurna 22) + ${desglose.kmExtra || 0} km extra`,
      unidades: 1,
      pvp: Number((salida + kmExtra).toFixed(2)),
      total: Number((salida + kmExtra).toFixed(2))
    });
  }

  // 3. Líneas de Repuestos Oficiales Consumidos
  for (const r of repuestos) {
    const cant = Math.max(1, Number(r.cantidad) || 1);
    const pvp = Number(r.pvp || 0);
    lineas.push({
      articulo: r.codigo || 'REP_SAT',
      descripcion: r.descripcion || 'Repuesto Oficial SAT',
      unidades: cant,
      pvp: pvp,
      total: Number((cant * pvp).toFixed(2))
    });
  }

  // Si fue contrato de mantenimiento o revisión de cortesía
  if (lineas.length === 0) {
    lineas.push({
      articulo: 'SAT_REVISION_CM',
      descripcion: `Revisión Técnica y Deshollinado Anual (${aviso.tipoIntervencion || 'EJEC. CONT. MANT.'})`,
      unidades: 1,
      pvp: 0.00,
      total: 0.00
    });
  }

  if (!db.albaranesAliquo) db.albaranesAliquo = [];
  const registro = {
    idAlbaran: numeroAlbaran,
    numeroDocAliquo: numeroAlbaran,
    idAviso: aviso.idAviso,
    numeroAviso: aviso.numero,
    codigoCliente: aviso.codigoCliente || 'CLIENTE',
    clienteNombre: `${aviso.nombreCliente || ''} ${aviso.apellidosCliente || ''}`.trim(),
    direccion: aviso.direccionCompleta || aviso.poblacion || 'Valladolid',
    poblacion: aviso.poblacion || 'VALLADOLID',
    aparato: `${aviso.marca || ''} ${aviso.modelo || ''}`.trim(),
    fechaGenerado: new Date().toISOString(),
    fechaParte: fichaje.fin || nowMadridStr(),
    operario: fichaje.operario || 'JACOBO',
    metodoPago: fichaje.metodoPago || 'EFECTIVO',
    totalImporte: Number(fichaje.importe || aviso.sumaImportes || 0),
    notasTrabajo: fichaje.notas || '',
    tieneFirmaCliente: Boolean(fichaje.firma),
    tieneFotoAdjunta: Boolean(fichaje.fotoAdjuntar),
    estadoSincro: 'COLA_PENDIENTE_ALIQUO',
    lineas
  };

  const idx = db.albaranesAliquo.findIndex(a => a.idAviso === aviso.idAviso || a.idAlbaran === numeroAlbaran);
  if (idx >= 0) {
    db.albaranesAliquo[idx] = registro;
  } else {
    db.albaranesAliquo.unshift(registro);
  }

  return registro;
}

// =========================================================================
// PASO 2: ALTA DIRECTA DE CLIENTES DESDE SAT 2.0 HACIA ALIQUO ERP
// =========================================================================
function generarCodigoClienteAliquo() {
  let maxNum = 5000;
  if (Array.isArray(aliquoLocalCache)) {
    for (const c of aliquoLocalCache) {
      const m = String(c.Codigo || '').match(/^C0*(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum && n < 99999) maxNum = n;
      }
    }
  }
  if (Array.isArray(db.avisos)) {
    for (const a of db.avisos) {
      const m = String(a.codigoCliente || '').match(/^C0*(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum && n < 99999) maxNum = n;
      }
    }
  }
  return 'C' + String(maxNum + 1).padStart(5, '0');
}

// Extractor inteligente de datos de contrato y máquina desde el Varios (Observaciones) de Aliquo para SAT 2.0
const KNOWN_STOVE_BRANDS = [
  'EDILKAMIN', 'ECOFOREST', 'RAVELLI', 'BRONPI', 'ROCAL', 'DOVRE', 'BODART',
  'HERGOM', 'LACUNZA', 'MCZ', 'EOSS', 'DIELLE', 'STUV', 'CARBEL', 'RIKA',
  'CLAM', 'FERLUX', 'PALAZZETTI', 'LA NORDICA', 'NORDICA', 'EXTRAFLAME',
  'THERMOROSSI', 'METLOR', 'SOLZAIMA', 'JOLLY MEC', 'JOLLY-MEC', 'PIAZZETTA',
  'INVICTA', 'PANADERO', 'LOTUS', 'CHAZELLES', 'KRATKI', 'KALOR', 'MORETTI',
  'CADEL', 'FREEPOINT', 'EVA CALOR', 'ARTEL', 'SUPERIOR', 'MONTEGRAPPA',
  'ITALIANA CAMINI', 'LASIAN', 'DOMUSA', 'FERROLI', 'VAILLANT', 'SAUNIER DUVAL',
  'BAXI', 'JUNKERS', 'VIESSMANN', 'BOSCH', 'ARISTON', 'COINTRA', 'FAGOR',
  'ROCA', 'CHOPERA', 'SALGUEDA', 'LLOCAL', 'TRAFORART', 'BARBAS', 'BELLFIRES',
  'DRU', 'FABER', 'GAZCO', 'STOVAX', 'WANDERS', 'SPARTHERM', 'SCHMID',
  'AUSTROFLAMM', 'HAAS+SOHN', 'ORANIER', 'JUSTUS', 'ADURO', 'HWAM', 'WIKING',
  'MORSO', 'JOTUL', 'SCAN', 'CONTURA', 'NORDPEIS', 'RAIS', 'ATTIKA',
  'HETA', 'TERMATECH', 'RED', 'AMG', 'FM', 'LINCAR', 'COLA', 'ANSELMO COLA',
  'DAL ZOTTO', 'MAROCCHI', 'UNICAL', 'TATANO', 'BIOCALORA', 'ECOBIOEBRO',
  'BIOSOLIS', 'THERMOFLUX', 'CENTROMETAL', 'DEFRO', 'ATMOS', 'ATTACK', 'FROLING', 'OKOFEN'
];

function parseSat20FromObservaciones(obsRaw, clientCode = '') {
  const obs = String(obsRaw || '').trim();
  if (!obs || clientCode === '00000') {
    return {
      fechaContrato: '',
      numContrato: '',
      marcaModelo: '',
      marca: '',
      modelo: '',
      tipoAparato: '',
      numSerie: '',
      instalacionBaza: '',
      relacion: 'INSTALADO'
    };
  }

  function normDate(dStr) {
    if (!dStr) return '';
    const p = String(dStr).trim().split(/[\/\-]/);
    if (p.length !== 3) return dStr;
    const d = p[0].padStart(2, '0');
    const m = p[1].padStart(2, '0');
    let y = p[2];
    if (y.length === 2) {
      const yi = parseInt(y, 10);
      y = yi >= 85 ? `19${y}` : `20${y}`;
    }
    return `${d}/${m}/${y}`;
  }

  const lines = obs.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstBlock = lines.slice(0, 4).join('\n');

  const notOursRe = /(NO\s+ES\s+NUESTR[OA]|NO\s+ES\s+CLIENTE|NO\s+(?:SE\s+)?(?:LA\s+|LO\s+)?(?:HEMOS\s+)?INSTALAD[OA]\s+POR\s+NOSOTROS|NO\s+(?:SE\s+)?(?:LA\s+|LO\s+)?INSTALAMOS\s+NOSOTROS|M[ÁA]QUINA\s+NO\s+NUESTRA|ESTUFA\s+NO\s+NUESTRA|CHIMENEA\s+QUE\s+NO\s+HEMOS\s+INSTALADO|NO\s+COMPRAD[OA]\s+AQU[ÍI]|APARATO\s+NO\s+NUESTRO|NO\s+INSTALAD[OA]\s+POR\s+BAZA)/i;
  const selfInstallRe = /\b(SIN\s+INSTALAR|RECOGE\s+EN\s+ALMAC[EÉ]N|RETIRAD[OA]\s+EN\s+ALMAC[EÉ]N|SOLO\s+SUMINISTRO|SERVID[OA]|PORTES\s+DEBIDOS|--\s*ALMAC[EÉ]N)\b/i;
  const machineKwRe = /\b(ESTUFA|HIDROESTUFA|TERMOESTUFA|CALDERA|CHIMENEA|HOGAR|TERMOHOGAR|TERMOGAR|INSERT|INSERTABLE|CASET|CASSETTE|CASETE|HORNO|BARBACOA|QUEMADOR|BIOCHIMENEA|MODULO|MÓDULO|APARATO|PELKAMIN|PELLKAMIN|BLADE|LISA|LINDA|SUEZ|VICTORIA|LETICIA|ZINGARA|OSTRO|IDRO|ARGO|HABIT|ARC|G\s*-?\s*\d{2,3}|RCR\s*\d+|T\s*[56]\b|BP\s*\d+|RV\s*-?\s*\d+|R\s*-?\s*70|F\s*-?\s*\d{3}|BODART|DOVRE|ROCAL|BRONPI|EDILKAMIN|RAVELLI|HERGOM|LACUNZA|STUV|CARBEL|ECOFOREST|DIELLE|RIKA|CLAM|JOTUL|FABER|KALFIRE|LAVEL|KRATKI|TRAFORA[RT]T?|METLOR|SOLZAIMA|CHAZELLES|PHILIPPE|PHILIPEE|GODIN|INVICTA|SUPRA|PIASTRI|PIAZZETTA|NORDICA|EXTRAFLAME|PANADERO|SALGUEDA|INSFIRE|PIROX|MAJESTIC|DIMPLEX)\b/i;

  const notOursInHeader = notOursRe.test(firstBlock);
  const notOursAnywhere = notOursRe.test(obs);
  const isSelfInstall = selfInstallRe.test(firstBlock);

  // 1. Nº Contrato (VA-xxxx, TB-xxxx, TU-xxxx, CF-xxxx)
  const contracts = [];
  const cMatches = obs.matchAll(/\b(VA|TB|TU|CF)\s*[-:]?\s*(\d{2,6}(?:\/\d+)?)\b/gi);
  for (const m of cMatches) {
    const code = `${m[1].toUpperCase()}-${m[2]}`;
    if (!contracts.includes(code)) contracts.push(code);
  }
  if (contracts.length === 0 && /^(VA|TB|TU)\d+/i.test(clientCode)) {
    const mc = clientCode.match(/^(VA|TB|TU)(\d+.*)$/i);
    if (mc) contracts.push(`${mc[1].toUpperCase()}-${mc[2]}`);
  }
  const numContrato = contracts.slice(0, 2).join(' / ');

  // 2. Nº Serie
  let numSerie = '';
  const mSn = obs.match(/(?:N[º°ÚU]\s*(?:DE\s+)?(?:SERIE|GARANT[ÍI]A|CONTROL)|SERIE|S\/N)\s*[:\.\-]?\s*([A-Z0-9][A-Z0-9\/\-\.\s]{3,25}?)(?=\s*(?:\n|$|COMPRA|INSTALAD|FECHA|PUESTA|PRECIO|IMPORTE|[\(\)]))/i);
  if (mSn) numSerie = mSn[1].trim().replace(/[-.,;:]+$/, '');

  // 3. Fecha Contrato y Marca/Modelo (justo delante de la marca/modelo comprado)
  let fechaContrato = '';
  let marcaModelo = '';
  let hasInitialBazaPurchase = false;

  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const line = lines[i];
    const mFc = line.match(/(?:FECH?A\s+(?:DE\s+)?(?:CONTRAT?O|COMPRA)[^:\d]*[:\s]*|(?:\b(?:VA|TB|TU)\s*[-:]?\s*\d+(?:\/\d+)?\s*[:\-]\s*))(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (mFc && !fechaContrato) {
      fechaContrato = normDate(mFc[1]);
      let afterDate = line.slice(mFc.index + mFc[0].length).replace(/^[ .\-:]+|[ .\-:]+$/g, '');
      afterDate = afterDate.replace(/N[º°]?\s*CONTRATO\s*:\s*[A-Z0-9\-\/]+/gi, '').replace(/^[ .\-:]+|[ .\-:]+$/g, '');
      const mComp = afterDate.match(/\bCOMPRA?R?\s*[:\-]?\s*(.+)/i);
      if (mComp) {
        marcaModelo = mComp[1].trim();
        hasInitialBazaPurchase = true;
        break;
      } else if (afterDate && machineKwRe.test(afterDate) && !/^(VIENE DEL|ANTIGUA|VER CONTRATO)/i.test(afterDate)) {
        marcaModelo = afterDate;
        hasInitialBazaPurchase = true;
        break;
      }
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nxt = lines[j];
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(nxt)) break;
        const mc2 = nxt.match(/^(?:COMPRA?R?\s*[:\-]?\s*)(.+)/i);
        if (mc2) {
          marcaModelo = mc2[1].trim();
          hasInitialBazaPurchase = true;
          break;
        } else if (!marcaModelo && !/^(CLIENTE|VIENE DEL|MUJER |MARIDO |VER CONTRATO)/i.test(nxt)) {
          marcaModelo = nxt.trim();
          hasInitialBazaPurchase = true;
          break;
        }
      }
      if (marcaModelo) break;
    }
  }

  if (!marcaModelo) {
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      const mD = line.match(/^[-*•]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b\s*[-:]*\s*(.*)/);
      if (mD) {
        const candDate = normDate(mD[1]);
        const rest = mD[2].trim();
        const isSatLog = /^\d{1,2}:\d{2}(?::\d{2})?\s*-\s*[A-ZÁÉÍÓÚÑ]+\s*[-:]/i.test(rest) ||
                         /^(?:JUAN|DIONI|ALEX|JACOBO|ROBERTO|RICKY|RICARDO|NACHO|SALVA|LYDIA|ROSA|ISMAEL)\b\s*[-:]/i.test(rest);
        let restNoVa = rest.replace(/^(?:VA|TB|TU)\s*[-:]?\s*\d+(?:\/\d+)?\s*[-:]*\s*/i, '').trim();
        if (!restNoVa && i + 1 < lines.length && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(lines[i + 1])) {
          restNoVa = lines[i + 1].trim();
        }
        if (!isSatLog && restNoVa && (/\bCOMPRA?R?\b/i.test(restNoVa) || machineKwRe.test(restNoVa))) {
          if (!fechaContrato) fechaContrato = candDate;
          if (!notOursRe.test(restNoVa)) hasInitialBazaPurchase = true;
          const mComp = restNoVa.match(/\bCOMPRA?R?\s*[:\-]?\s*(.+)/i);
          marcaModelo = mComp ? mComp[1].trim() : restNoVa;
          break;
        }
      }
    }
  }

  if (!marcaModelo) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      if (!/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(line) && (machineKwRe.test(line) || /\bCOMPRA?R?\s*:/i.test(line))) {
        const cl = line.replace(/^(?:VA|TB|TU)\s*[-:]?\s*\d+(?:\/\d+)?\s*[-:]*\s*/i, '').replace(/^COMPRA?R?\s*[:\-]?\s*/i, '').trim();
        if (cl) {
          marcaModelo = cl;
          const mDt = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
          if (mDt && !fechaContrato) fechaContrato = normDate(mDt[1]);
          break;
        }
      }
    }
  }

  if (!marcaModelo) {
    for (const line of lines) {
      if (machineKwRe.test(line) && !/^-?\s*DURACI[ÓO]N/i.test(line)) {
        const cand = line.replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*(?:-\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*[-:]*\s*(?:[A-ZÁÉÍÓÚÑ]+\s*[-:]\s*)?/i, '').trim();
        if (cand) {
          marcaModelo = cand;
          break;
        }
      }
    }
  }

  if (marcaModelo) {
    marcaModelo = marcaModelo.replace(/\s+/g, ' ').replace(/^[ .,\-:]+|[ .,\-:]+$/g, '');
    if (marcaModelo.length > 180) marcaModelo = marcaModelo.slice(0, 180).trim() + '...';
  }

  let marca = '';
  let modelo = '';
  const searchPool = (marcaModelo || obs).toUpperCase();
  for (const b of KNOWN_STOVE_BRANDS) {
    const re = new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(searchPool)) {
      marca = b;
      if (marcaModelo) {
        modelo = marcaModelo
          .replace(re, ' ')
          .replace(/\b(ESTUFA|CALDERA|INSERTABLE|INSERT|CASSETTE|CASETE|CHIMENEA|HOGAR|TERMOESTUFA|HIDROESTUFA|DE\s+PELLETS?|PELLETS?|DE\s+LEÑA|LEÑA|DE\s+GAS|GAS)\b/gi, ' ')
          .replace(/^[\s\-\.,:/\+]+|[\s\-\.,:/\+]+$/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }
      break;
    }
  }
  if (!marca && marcaModelo) {
    if (/\bT\s*-?\s*[56]\b/i.test(marcaModelo)) marca = 'EOSS';
    else if (/\b(R\s*-?\s*70|RV\s*-?\s*\d+)\b/i.test(marcaModelo)) marca = 'RAVELLI';
    else if (/\b(BLADE|LISA|LINDA|CHERY|CHERIE|MYA|NARA|TALLY|LOGO|PELLKAMIN|PELKAMIN)\b/i.test(marcaModelo)) marca = 'EDILKAMIN';
  }
  if (!modelo && marcaModelo) {
    modelo = marcaModelo;
  }

  // Tipo de aparato
  let tipoAparato = '';
  if (/(HIDRO|HYDRO|TERMOESTUFA|CALDERA|RADIADORES|ACUMULADOR|AGUA)/i.test(searchPool)) {
    tipoAparato = /LEÑA/i.test(searchPool) && !/PELLET/i.test(searchPool) ? 'LEÑA AGUA' : 'PELLET AGUA';
  } else if (/(MIXTA|POLICARBURANTE|POLICOMBUSTIBLE|DIELLE)/i.test(searchPool) && /LEÑA/i.test(searchPool) && /PELLET/i.test(searchPool)) {
    tipoAparato = 'MIXTA PELLET-LEÑA';
  } else if (/\b(GAS|PROPANO|BUTANO)\b/i.test(searchPool)) {
    tipoAparato = 'GAS';
  } else if (/(LEÑA|CASETE|CASSETTE|HOGAR|DOVRE|ROCAL|BODART|HERGOM|LACUNZA|STUV|CARBEL|CHIMENEA)/i.test(searchPool) && !/PELLET/i.test(searchPool)) {
    tipoAparato = 'LEÑA AIRE';
  } else if (marca || marcaModelo) {
    tipoAparato = 'PELLET AIRE';
  }

  // Relación / Instalación (Baza vs Externa vs Suministro)
  let instalacionBaza = '';
  let relacion = 'INSTALADO';
  if (notOursInHeader || (notOursAnywhere && !hasInitialBazaPurchase)) {
    instalacionBaza = 'NO ES DE BAZA (NO INSTALADA POR NOSOTROS)';
    relacion = 'NO ES NUESTRA';
  } else if (notOursAnywhere && hasInitialBazaPurchase) {
    instalacionBaza = 'CLIENTE BAZA + SEGUNDA MÁQUINA EXTERNA (NO NUESTRA)';
    relacion = 'INSTALADO';
  } else if (isSelfInstall) {
    instalacionBaza = 'SUMINISTRO BAZA (SIN INSTALAR / RECOGE ALMACÉN)';
    relacion = 'SUMINISTRADO';
  } else if (hasInitialBazaPurchase || fechaContrato || /\b(COMPRA|INSTALAD[OA]|MONTAD[OA]|CONTRATO)\b/i.test(firstBlock)) {
    instalacionBaza = 'INSTALADA POR BAZA MAZANO';
    relacion = 'INSTALADO';
  } else if (marcaModelo) {
    instalacionBaza = 'SOLO SAT (MÁQUINA IDENTIFICADA)';
    relacion = 'INSTALADO';
  } else {
    instalacionBaza = 'SOLO HISTORIAL SAT / VARIOS';
    relacion = 'INSTALADO';
  }

  return {
    fechaContrato,
    numContrato,
    marcaModelo,
    marca,
    modelo,
    tipoAparato,
    numSerie,
    instalacionBaza,
    relacion
  };
}

// Búsqueda híbrida (Live SQL Aliquo + Enriquecimiento con historial de aparatos SAT + Caché Local)
async function searchClientsAliquoAndSat(q) {
  const term = String(q || '').trim();
  if (term.length < 2) return { source: 'none', clientes: [] };

  const cleanTerm = term.replace(/'/g, '').trim();
  const cleanDigits = term.replace(/\D/g, '');
  let liveRows = [];
  let source = 'ALIQUO_SQL_LIVE';

  const whereClauses = [
    `Nombre LIKE '%${cleanTerm}%'`,
    `SobreNombre LIKE '%${cleanTerm}%'`,
    `Codigo LIKE '%${cleanTerm}%'`,
    `Direccion LIKE '%${cleanTerm}%'`,
    `Poblacion LIKE '%${cleanTerm}%'`,
    `Observaciones LIKE '%${cleanTerm}%'`
  ];
  if (cleanDigits.length >= 3) {
    whereClauses.push(`Codigo LIKE '%${cleanDigits}%'`);
    whereClauses.push(`Telefono LIKE '%${cleanDigits}%'`);
    whereClauses.push(`Telefono2 LIKE '%${cleanDigits}%'`);
    whereClauses.push(`Observaciones LIKE '%VA%${cleanDigits}%'`);
  }

  const sql = `
    SELECT TOP 20 Id, Codigo, Nombre, SobreNombre, Direccion, CodigoPostal, Poblacion, Provincia, Telefono, Telefono2, Email, Observaciones
    FROM Clientes
    WHERE ${whereClauses.join(' OR ')}
    ORDER BY Id DESC
  `;

  try {
    liveRows = await queryAliquoLive(sql);
  } catch (err) {
    source = 'CACHE_LOCAL_Y_HISTORICO_SAT';
    liveRows = [];
  }

  const mapByKey = new Map();

  // 1. Procesar filas de Aliquo Live + Extraer los 5 campos SAT 2.0 desde Observaciones
  const asStr = v => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));
  for (const c of liveRows) {
    const cod = asStr(c.Codigo);
    const obs = asStr(c.Observaciones);
    let va = cod.toUpperCase().startsWith('VA') ? cod.toUpperCase() : '';
    if (!va) {
      const m = obs.match(/\b(VA-?[0-9]{3,6})\b/i);
      if (m) va = m[1].toUpperCase();
    }
    const parsedSat = parseSat20FromObservaciones(obs, cod);
    // Buscar también en aliquoLocalCache por si tiene campos pre-extraídos
    const cachedCli = aliquoLocalCache.find(x => asStr(x.Codigo).toUpperCase() === cod.toUpperCase());

    const fullName = asStr(c.Nombre) || asStr(c.SobreNombre);
    const parts = fullName.split(/\s+/).filter(Boolean);
    const nombre = parts[0] || '';
    const apellidos = parts.slice(1).join(' ');
    const dir = [asStr(c.Direccion), asStr(c.CodigoPostal), asStr(c.Poblacion), asStr(c.Provincia)].filter(Boolean).join(', ');
    const key = cod || fullName.toUpperCase();
    mapByKey.set(key, {
      codigoCliente: va || cod || 'CLIENTE',
      codigoAliquo: cod,
      nombreCompleto: fullName,
      nombreCliente: nombre,
      apellidosCliente: apellidos,
      direccionCompleta: dir,
      poblacion: asStr(c.Poblacion) || 'VALLADOLID',
      telefono1: asStr(c.Telefono),
      telefono2: asStr(c.Telefono2),
      email: asStr(c.Email),
      tipoAparato: parsedSat.tipoAparato || (cachedCli && cachedCli.tipoAparato) || 'PELLET AIRE',
      marca: parsedSat.marca || (cachedCli && cachedCli.marca) || '',
      modelo: parsedSat.modelo || (cachedCli && cachedCli.modelo) || '',
      marcaModelo: parsedSat.marcaModelo || (cachedCli && cachedCli.marcaModelo) || '',
      fechaContrato: parsedSat.fechaContrato || (cachedCli && cachedCli.fechaContrato) || '',
      numContrato: parsedSat.numContrato || (cachedCli && cachedCli.numContrato) || '',
      numSerie: parsedSat.numSerie || (cachedCli && cachedCli.numSerie) || '',
      instalacionBaza: parsedSat.instalacionBaza || (cachedCli && cachedCli.instalacionBaza) || '',
      observacionesAliquo: obs || (cachedCli && cachedCli.Observaciones) || '',
      contratoMant: false,
      relacion: parsedSat.relacion || (cachedCli && cachedCli.relacion) || 'INSTALADO',
      tratoCliente: 'BUENO',
      origen: 'ALIQUO SQL LIVE'
    });
  }

  // 2. Enriquecer y buscar también en el histórico de AVISOS y CONTRATOS CM
  const lower = cleanTerm.toLowerCase();
  for (const a of db.avisos) {
    const match =
      (a.codigoCliente && a.codigoCliente.toLowerCase().includes(lower)) ||
      (a.nombreCliente && a.nombreCliente.toLowerCase().includes(lower)) ||
      (a.apellidosCliente && a.apellidosCliente.toLowerCase().includes(lower)) ||
      (`${a.nombreCliente} ${a.apellidosCliente}`.toLowerCase().includes(lower)) ||
      (a.telefono1 && a.telefono1.includes(cleanTerm)) ||
      (a.telefono2 && a.telefono2.includes(cleanTerm)) ||
      (a.direccionCompleta && a.direccionCompleta.toLowerCase().includes(lower));

    if (match) {
      const key = a.codigoCliente && a.codigoCliente !== 'NO ES CLIENTE'
        ? a.codigoCliente.toUpperCase()
        : `${a.nombreCliente} ${a.apellidosCliente}`.trim().toUpperCase();
      const existing = mapByKey.get(key);
      if (existing) {
        if (!existing.tipoAparato && a.tipoAparato) existing.tipoAparato = a.tipoAparato;
        if (!existing.marca && a.marca) existing.marca = a.marca;
        if (!existing.modelo && a.modelo) existing.modelo = a.modelo;
        if (!existing.fechaContrato && a.fechaInstalacion) existing.fechaContrato = a.fechaInstalacion;
        if (!existing.numContrato && a.docCompra) existing.numContrato = a.docCompra;
        if (!existing.numSerie && a.numSerie) existing.numSerie = a.numSerie;
        if (!existing.observacionesAliquo && a.observacionesAliquo) existing.observacionesAliquo = a.observacionesAliquo;
        if (a.contratoMant) existing.contratoMant = true;
        if (a.tratoCliente) existing.tratoCliente = a.tratoCliente;
      } else if (mapByKey.size < 25) {
        mapByKey.set(key, {
          codigoCliente: a.codigoCliente || 'NO ES CLIENTE',
          codigoAliquo: a.codigoCliente || '',
          nombreCompleto: `${a.nombreCliente} ${a.apellidosCliente}`.trim(),
          nombreCliente: a.nombreCliente,
          apellidosCliente: a.apellidosCliente,
          direccionCompleta: a.direccionCompleta,
          poblacion: a.poblacion || 'VALLADOLID',
          telefono1: a.telefono1,
          telefono2: a.telefono2,
          email: '',
          tipoAparato: a.tipoAparato || 'PELLET AIRE',
          marca: a.marca || '',
          modelo: a.modelo || '',
          marcaModelo: `${a.marca || ''} ${a.modelo || ''}`.trim(),
          fechaContrato: a.fechaInstalacion || '',
          numContrato: a.docCompra || '',
          numSerie: a.numSerie || '',
          instalacionBaza: a.instalacionBaza || '',
          observacionesAliquo: a.observacionesAliquo || '',
          contratoMant: Boolean(a.contratoMant),
          relacion: a.relacion || 'INSTALADO',
          tratoCliente: a.tratoCliente || 'BUENO',
          ultimoAvisoNumero: a.numero,
          origen: 'HISTÓRICO SAT + ALIQUO'
        });
      }
    }
  }

  // 3. Buscar también en clientes_aliquo_cache.json si aún hay pocos resultados
  if (mapByKey.size < 10 && aliquoLocalCache.length > 0) {
    for (const c of aliquoLocalCache) {
      const cod = String(c.Codigo || '').trim();
      const nom = String(c.Nombre || '').trim();
      const dir = String(c.Direccion || '').trim();
      const pob = String(c.Poblacion || '').trim();
      const tel = String(c.Telefono || '').trim();
      const obs = String(c.Observaciones || '').trim();
      if (
        cod.toLowerCase().includes(lower) ||
        nom.toLowerCase().includes(lower) ||
        dir.toLowerCase().includes(lower) ||
        obs.toLowerCase().includes(lower) ||
        (cleanDigits.length >= 3 && tel.includes(cleanDigits))
      ) {
        const key = cod || nom.toUpperCase();
        if (!mapByKey.has(key)) {
          const parts = nom.split(/\s+/);
          const parsedSat = c.marcaModelo !== undefined ? c : parseSat20FromObservaciones(obs);
          mapByKey.set(key, {
            codigoCliente: cod || 'CLIENTE',
            codigoAliquo: cod,
            nombreCompleto: nom,
            nombreCliente: parts[0] || nom,
            apellidosCliente: parts.slice(1).join(' '),
            direccionCompleta: [dir, c.CodigoPostal, pob, c.Provincia].filter(Boolean).join(', '),
            poblacion: pob || 'VALLADOLID',
            telefono1: tel,
            telefono2: String(c.Telefono2 || '').trim(),
            email: String(c.Email || '').trim(),
            tipoAparato: c.tipoAparato || parsedSat.tipoAparato || 'PELLET AIRE',
            marca: c.marca || parsedSat.marca || '',
            modelo: c.modelo || parsedSat.modelo || '',
            marcaModelo: c.marcaModelo || parsedSat.marcaModelo || '',
            fechaContrato: c.fechaContrato || parsedSat.fechaContrato || '',
            numContrato: c.numContrato || parsedSat.numContrato || '',
            numSerie: c.numSerie || parsedSat.numSerie || '',
            instalacionBaza: c.instalacionBaza || parsedSat.instalacionBaza || '',
            observacionesAliquo: obs,
            contratoMant: false,
            relacion: c.relacion || parsedSat.relacion || 'INSTALADO',
            tratoCliente: 'BUENO',
            origen: 'CACHE ALIQUO SQL'
          });
        }
      }
      if (mapByKey.size >= 25) break;
    }
  }

  // Verificar si tiene contrato activo en CM26
  const results = Array.from(mapByKey.values()).slice(0, 15).map(item => {
    const cmMatch = db.contratosCm.find(cm =>
      (cm.codigoCliente && item.codigoCliente && cm.codigoCliente.toUpperCase() === item.codigoCliente.toUpperCase()) ||
      (cm.telefono1 && item.telefono1 && cm.telefono1.replace(/\D/g, '') === item.telefono1.replace(/\D/g, '') && item.telefono1.length >= 6)
    );
    if (cmMatch) {
      item.contratoMant = true;
      item.alcanceCm = cmMatch.alcance || '1L+1D';
      if (!item.marca && cmMatch.marca) item.marca = cmMatch.marca;
      if (!item.modelo && cmMatch.modelo) item.modelo = cmMatch.modelo;
      if (!item.tipoAparato && cmMatch.tipoAparato) item.tipoAparato = cmMatch.tipoAparato;
    }
    return item;
  });

  return { source, clientes: results };
}

// =========================================================================
// CÁLCULO AUTOMÁTICO DE TARIFAS OFICIALES (2026 & 2027) Y KILOMETRAJE
// =========================================================================
function calcularImporteIntervencion({
  temporada = '2026',
  tipoIntervencion = 'SAT NORMAL',
  tipoAparato = 'PELLET AIRE',
  esCliente = true,
  tieneContratoMant = false,
  minutosTrabajados = 45,
  kmIdaVuelta = 14,
  repuestosSeleccionados = []
}) {
  const tabla = (db.tarifas && db.tarifas.tablas && db.tarifas.tablas[temporada]) ||
                (db.tarifas && db.tarifas.tablas && db.tarifas.tablas['2026']) || {
    salidaBase: 35,
    precioKmExtra: 1.2,
    horaManoObraCliente: 60,
    horaManoObraNoCliente: 70,
    minimoMediaHoraCliente: 62.5,
    minimoMediaHoraNoCliente: 67.5,
    servicios: {}
  };

  const franquiciaKm = (db.tarifas && db.tarifas.franquiciaKmIdaVuelta) || 30;
  const dtoCmPct = tieneContratoMant ? ((db.tarifas && db.tarifas.descuentoContratoMantPct) || 20) : 0;
  const factorDto = 1 - (dtoCmPct / 100);

  const kmExtra = Math.max(0, (Number(kmIdaVuelta) || 0) - franquiciaKm);
  const costeKmExtra = Number((kmExtra * (tabla.precioKmExtra || 1.2)).toFixed(2));

  const esAgua = String(tipoAparato || '').toUpperCase().includes('AGUA');
  const intervUpper = String(tipoIntervencion || 'SAT NORMAL').toUpperCase();

  let conceptoServicio = intervUpper;
  let costeSalida = 0;
  let costeManoObra = 0;
  let costeTarifaFija = 0;
  let notaRegla = '';

  // 1. Ejecución de Contrato de Mantenimiento previamente contratado o Garantía -> 0 €
  if (
    intervUpper.includes('EJEC. CONT. MANT') ||
    intervUpper.includes('EJECUCIÓN CONT. MANT') ||
    intervUpper.includes('GARANTÍA') ||
    intervUpper.includes('RECLAMACIÓN GARANTÍA')
  ) {
    costeSalida = 0;
    costeManoObra = 0;
    costeTarifaFija = 0;
    notaRegla = intervUpper.includes('GARANT')
      ? 'Intervención en Garantía: 0,00 € (sin cargo de salida ni mano de obra).'
      : 'Ejecución de Contrato de Mantenimiento Anual abonado previamente: 0,00 € visita.';
  }
  // 2. Servicio de tarifa cerrada (Limpieza, Deshollinado, Limpieza+Deshollinado, Puesta en Marcha, Visita Técnica, Contrato Mantenimiento)
  else if (tabla.servicios && tabla.servicios[intervUpper]) {
    const srv = tabla.servicios[intervUpper];
    if (esAgua) {
      costeTarifaFija = esCliente ? srv.aguaCliente : srv.aguaNoCliente;
    } else {
      costeTarifaFija = esCliente ? srv.aireCliente : srv.aireNoCliente;
    }
    if (tieneContratoMant && !intervUpper.includes('CONTRATO MANTENIMIENTO')) {
      costeTarifaFija = Number((costeTarifaFija * factorDto).toFixed(2));
    }
    notaRegla = `Tarifa oficial ${temporada} (${esAgua ? 'AGUA' : 'AIRE'} · ${esCliente ? 'CLIENTE' : 'NO CLIENTE'}) con salida hasta 30 km incluida.`;
  }
  // 3. SAT NORMAL por horas + Salida (con mínimo 30 min = 62,50 € Cliente / 67,50 € No Cliente)
  else {
    const salidaBruta = Number(tabla.salidaBase || 35);
    costeSalida = Number((salidaBruta * factorDto).toFixed(2));

    const precioHora = esCliente ? Number(tabla.horaManoObraCliente || 60) : Number(tabla.horaManoObraNoCliente || 70);
    const minFacturable = Math.max(30, Number(minutosTrabajados) || 30);

    let moBruta = 0;
    if (minFacturable <= 30) {
      // Regla oficial Baza Mazano: Mínimo SAT 30 min = 35€ salida + 27,50€ (Cliente) o 32,50€ (No Cliente) = 62,50€ / 67,50€
      const minTotal = esCliente ? Number(tabla.minimoMediaHoraCliente || 62.5) : Number(tabla.minimoMediaHoraNoCliente || 67.5);
      moBruta = Math.max(0, minTotal - salidaBruta);
    } else {
      moBruta = Number(((minFacturable / 60) * precioHora).toFixed(2));
    }
    costeManoObra = Number((moBruta * factorDto).toFixed(2));
    notaRegla = `SAT Normal (${minFacturable} min): Salida 35€ (incl. 30 km) + Mano de Obra (${precioHora}€/h)${tieneContratoMant ? ' con -20% Dto. Contrato Mantenimiento en Salida y M.O.' : ''}.`;
  }

  // 4. Suma de repuestos seleccionados
  let costeRepuestos = 0;
  const repuestosDetalle = (Array.isArray(repuestosSeleccionados) ? repuestosSeleccionados : []).map(r => {
    const cant = Math.max(1, Number(r.cantidad) || 1);
    const pvpUnit = Number(r.pvp) || 0;
    const subtotal = Number((cant * pvpUnit).toFixed(2));
    costeRepuestos += subtotal;
    return {
      codigo: r.codigo || 'REP',
      descripcion: r.descripcion || '',
      cantidad: cant,
      pvpUnitario: pvpUnit,
      subtotal
    };
  });
  costeRepuestos = Number(costeRepuestos.toFixed(2));

  // Si es Ejecución CM contratado sin exceso de km, no cobra km extra dentro de franquicia
  const kmCargoFinal = (intervUpper.includes('GARANT')) ? 0 : costeKmExtra;
  const total = Number((costeTarifaFija + costeSalida + costeManoObra + kmCargoFinal + costeRepuestos).toFixed(2));

  return {
    temporada,
    conceptoServicio,
    esCliente,
    tieneContratoMant,
    descuentoAplicadoPct: dtoCmPct,
    minutosTrabajados: Math.max(1, Number(minutosTrabajados) || 30),
    kmIdaVuelta: Number(kmIdaVuelta) || 0,
    franquiciaKm,
    kmExtra,
    costeTarifaFija,
    costeSalida,
    costeManoObra,
    costeKmExtra: kmCargoFinal,
    costeRepuestos,
    repuestosDetalle,
    total,
    notaRegla
  };
}

// Utilidad para leer JSON Body
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Payload demasiado grande (>25MB)'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// =========================================================================
// SERVIDOR HTTP PRINCIPAL Y ENDPOINTS REST
// =========================================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURI(parsedUrl.pathname);

  try {
    // 0. HEALTHCHECK DOCKER / EASYPANEL (Público)
    if (pathname === '/api/health' && req.method === 'GET') {
      const healthy = Array.isArray(db.avisos) && fs.existsSync(DB_FILE);
      return sendJson(res, healthy ? 200 : 503, {
        ok: healthy,
        status: healthy ? 'healthy' : 'degraded',
        timestamp: nowMadridStr(),
        aliquoCacheCount: Array.isArray(aliquoLocalCache) ? aliquoLocalCache.length : 0,
        counts: {
          avisos: (db.avisos || []).length,
          citas: (db.citas || []).length,
          fichajes: (db.fichajes || []).length,
          contratosCm: (db.contratosCm || []).length
        }
      });
    }

    // 0.1 AUTENTICACIÓN POR PIN (Público)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const pin = String(body.pin || '').trim();
      const user = PIN_USERS.find(u => u.pin === pin);
      if (!user) {
        return sendJson(res, 401, { ok: false, error: 'PIN incorrecto. Verifica tus 4-6 dígitos.' });
      }
      const token = signAuthToken(user);
      const safeUser = {
        id: user.id,
        nombre: user.nombre,
        roles: user.roles,
        defaultRole: user.defaultRole,
        canSeeAdmin: Boolean(user.canSeeAdmin),
        canSeeNotasAdmin: Boolean(user.canSeeNotasAdmin),
        canSeeCostes: Boolean(user.canSeeCostes),
        canEditTarifas: Boolean(user.canEditTarifas),
        canExportContable: Boolean(user.canExportContable),
        canCreateAviso: Boolean(user.canCreateAviso),
        lockedTechEmail: user.lockedTechEmail
      };
      return sendJson(res, 200, { ok: true, token, user: safeUser });
    }

    const authUser = extractRequestUser(req, parsedUrl);

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!authUser) return sendJson(res, 401, { ok: false, error: 'Sesión no iniciada o caducada.' });
      return sendJson(res, 200, { ok: true, user: authUser });
    }

    // Servir archivos multimedia guardados en /app/data/media/ (protegidos con token o sesión)
    if (pathname.startsWith('/media/') && req.method === 'GET') {
      if (!authUser) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Acceso restringido: inicia sesión con PIN.');
      }
      const relMedia = pathname.replace(/^\/media\//, '');
      const mediaPath = path.resolve(MEDIA_DIR, relMedia);
      if (!mediaPath.startsWith(path.resolve(MEDIA_DIR)) || !fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Archivo multimedia no encontrado');
      }
      const ext = path.extname(mediaPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400'
      });
      return fs.createReadStream(mediaPath).pipe(res);
    }

    // Guardián de sesión para toda la API (/api/*)
    if (pathname.startsWith('/api/')) {
      if (!authUser) {
        return sendJson(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: 'Introduce tu PIN personal para acceder.' });
      }
      const isAdminRoute =
        pathname.startsWith('/api/admin/') ||
        pathname.startsWith('/api/contratos-cm/') ||
        pathname === '/api/contratos-cm' ||
        pathname === '/api/tarifas' ||
        pathname === '/api/repuestos' ||
        pathname === '/api/marcas' ||
        pathname === '/api/vehiculos' ||
        pathname === '/api/aliquo/preview-volcado' ||
        pathname === '/api/aliquo/volcar-albaran';
      if (isAdminRoute && !authUser.canSeeAdmin) {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_ADMIN', error: 'Acceso restringido a Dirección / Administración (Silvia, Chus, Leandro).' });
      }
      if ((pathname === '/api/tarifas' || pathname === '/api/repuestos' || pathname === '/api/marcas') && !authUser.canEditTarifas) {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_TARIFAS', error: 'Tu usuario no tiene permiso para modificar tarifas, marcas o repuestos.' });
      }
      if (pathname === '/api/admin/export-contable' && !authUser.canExportContable) {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_CONTABLE', error: 'Exportación contable restringida a usuarios autorizados (Silvia, Chus, Leandro, Juan Pablo).' });
      }
      if ((pathname === '/api/admin/rentabilidad' || pathname === '/api/admin/costes-config' || pathname === '/api/admin/gastos') && !authUser.canSeeCostes) {
        return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_COSTES', error: 'Acceso a costes reales y márgenes restringido a usuarios autorizados (Silvia, Chus, Leandro, Juan Pablo).' });
      }
    }

    // Exportación Contable Oficial (CSV UTF-8 con BOM ';' para Excel España — Fase 1.5B)
    if (pathname === '/api/admin/export-contable' && req.method === 'GET') {
      const { rows } = buildHistoricoRows(parsedUrl.searchParams, authUser, 5000);
      const csvEsc = (v) => {
        const s = String(v === null || v === undefined ? '' : v).replace(/\r?\n/g, ' ');
        return `"${s.replace(/"/g, '""')}"`;
      };
      const numEs = (n) => Number(n || 0).toFixed(2).replace('.', ',');
      const header = [
        'Nº Aviso', 'Fecha Entrada', 'Fecha Ejecución', 'Tipo Servicio', 'Estado Aviso',
        'Código Cliente', 'Cliente', 'Población', 'Máquina', 'Tipo Intervención', 'Operario',
        'Precio Acordado (€)', 'Abono Previo (€)', 'Estado Cobro Previo', 'Método Pago Previo', 'Fecha Pago Previo',
        'Total Parte PVP (€)', 'Coste Neto Repuestos (€)', 'PVP Repuestos (€)', 'Margen Repuestos (€)',
        'Forma Cobro Parte', 'Estado Cobro', 'Repuestos Detalle', 'Notas Oficina', 'Notas Técnico'
      ].map(csvEsc).join(';');
      const lines = rows.map(r => [
        `#${r.numero}`, r.fechaEntrada, r.fechaEjecucion || '', r.tipoServicio, r.estadoAviso,
        r.codigoCliente || '', r.clienteNombre, r.poblacion || '', r.maquina, r.tipoIntervencion, r.operario,
        r.precioComunicado !== null && r.precioComunicado !== undefined ? numEs(r.precioComunicado) : '',
        numEs(r.importeAbonadoPrevio), r.estadoCobroPrevio || 'PENDIENTE', r.metodoPagoPrevio || '', r.fechaPagoPrevio || '',
        numEs(r.totalFacturado), numEs(r.costeNetoRepuestos), numEs(r.pvpRepuestos), numEs(r.margenRepuestos),
        r.formaCobro || '', r.estadoCobro || '', r.repuestosTexto || '', r.observaciones || '', r.notasTecnico || ''
      ].map(csvEsc).join(';'));
      const csvBody = '\uFEFF' + [header, ...lines].join('\r\n');
      const stamp = nowMadridStr().slice(0, 10);
      const buf = Buffer.from(csvBody, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="baza_mazano_contable_${stamp}.csv"`,
        'Content-Length': buf.length
      });
      return res.end(buf);
    }

    // Backup completo de base de datos bajo demanda (Admin)
    if (pathname === '/api/admin/backup' && req.method === 'GET') {
      saveDb(true);
      const stamp = nowMadridStr().slice(0, 10);
      const payload = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE) : Buffer.from(JSON.stringify(db, null, 2));
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="sat_db_backup_${stamp}.json"`,
        'Content-Length': payload.length
      });
      return res.end(payload);
    }

    // Módulo de Costes Reales y Rentabilidad SAT (Reemplazo automático del Excel de Silvia)
    if (pathname === '/api/admin/rentabilidad' && req.method === 'GET') {
      const desde = (parsedUrl.searchParams.get('desde') || '').trim().slice(0, 10);
      const hasta = (parsedUrl.searchParams.get('hasta') || '').trim().slice(0, 10);
      const operarioFiltro = (parsedUrl.searchParams.get('operario') || 'TODOS').trim().toUpperCase();
      const fugaFiltro = (parsedUrl.searchParams.get('fuga') || 'TODAS').trim().toUpperCase();
      const tipoFiltro = (parsedUrl.searchParams.get('tipoIntervencion') || 'TODOS').trim().toUpperCase();
      const soloFinalizados = parsedUrl.searchParams.get('soloFinalizados') === '1';
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();

      const costesConfig = getCostesConfig();
      const repByCode = new Map();
      for (const r of (db.repuestos || [])) {
        if (r.codigo) repByCode.set(String(r.codigo).toUpperCase(), r);
        if (r.idArticulo) repByCode.set(String(r.idArticulo).toUpperCase(), r);
      }

      const fichajesByAviso = new Map();
      for (const f of (db.fichajes || [])) {
        if (!f.idAviso) continue;
        if (f.estadoFichaje && f.estadoFichaje !== 'TERMINADO') continue;
        const arr = fichajesByAviso.get(f.idAviso) || [];
        arr.push(f);
        fichajesByAviso.set(f.idAviso, arr);
      }

      const allItems = [];
      for (const a of (db.avisos || [])) {
        const fIn = String(a.fecha || '').slice(0, 10);
        if (desde && fIn && fIn < desde) continue;
        if (hasta && fIn && fIn > hasta) continue;
        if (soloFinalizados && !isEstadoFinalizado(a.estadoAviso)) continue;

        const fList = fichajesByAviso.get(a.idAviso) || [];
        const calc = calcularRentabilidadAviso(a, fList, costesConfig, repByCode);

        if (operarioFiltro !== 'TODOS' && !calc.operario.includes(operarioFiltro)) continue;
        if (tipoFiltro !== 'TODOS' && !calc.tipoIntervencion.toUpperCase().includes(tipoFiltro)) continue;
        if (fugaFiltro !== 'TODAS' && !calc.flagsFuga.includes(fugaFiltro)) continue;
        if (q) {
          const hay = [calc.numero, calc.clienteNombre, calc.poblacion, calc.maquina, calc.tipoIntervencion, calc.operario]
            .map(v => String(v || '').toLowerCase()).join(' ');
          if (!hay.includes(q)) continue;
        }
        allItems.push(calc);
      }

      // Agregados globales y desgloses por fuga/tipo/técnico
      let totalIngresosBrutos = 0;
      let totalIngresosNetos = 0;
      let totalCosteReal = 0;
      let totalBeneficio = 0;
      let dineroFugadoPerdidas = 0;
      let countSegundasVisitas = 0;
      let countMargenNegativo = 0;
      let countGarantiasDeficitarias = 0;
      let countDesplazamientosCaros = 0;

      const byTipo = new Map();
      const byOperario = new Map();
      const byPoblacion = new Map();

      const addAgg = (map, key, item) => {
        const cur = map.get(key) || { key, avisos: 0, ingresosNetos: 0, costeReal: 0, beneficio: 0, perdidas: 0 };
        cur.avisos += 1;
        cur.ingresosNetos += item.ingresosNetos;
        cur.costeReal += item.costeTotalReal;
        cur.beneficio += item.beneficioNetoReal;
        if (item.beneficioNetoReal < 0) cur.perdidas += Math.abs(item.beneficioNetoReal);
        map.set(key, cur);
      };

      for (const it of allItems) {
        totalIngresosBrutos += it.ingresosBrutos;
        totalIngresosNetos += it.ingresosNetos;
        totalCosteReal += it.costeTotalReal;
        totalBeneficio += it.beneficioNetoReal;
        if (it.beneficioNetoReal < 0) dineroFugadoPerdidas += Math.abs(it.beneficioNetoReal);
        if (it.flagsFuga.includes('SEGUNDA_VISITA')) countSegundasVisitas++;
        if (it.flagsFuga.includes('MARGEN_NEGATIVO')) countMargenNegativo++;
        if (it.flagsFuga.includes('GARANTIA_DEFICITARIA')) countGarantiasDeficitarias++;
        if (it.flagsFuga.includes('DESPLAZAMIENTO_CARO')) countDesplazamientosCaros++;

        addAgg(byTipo, it.tipoIntervencion || 'SAT NORMAL', it);
        addAgg(byOperario, it.operario || 'SIN ASIGNAR', it);
        if (it.poblacion) addAgg(byPoblacion, it.poblacion.toUpperCase(), it);
      }

      const formatAgg = (map, sortBy = 'beneficio') =>
        Array.from(map.values())
          .map(x => ({
            ...x,
            ingresosNetos: Number(x.ingresosNetos.toFixed(2)),
            costeReal: Number(x.costeReal.toFixed(2)),
            beneficio: Number(x.beneficio.toFixed(2)),
            perdidas: Number(x.perdidas.toFixed(2)),
            margenPct: x.ingresosNetos > 0 ? Number(((x.beneficio / x.ingresosNetos) * 100).toFixed(1)) : 0
          }))
          .sort((a, b) => sortBy === 'perdidas' ? b.perdidas - a.perdidas : b.avisos - a.avisos);

      // Gastos extra registrados (gasolina, proveedores, portes)
      const gastosList = (db.gastosSat || []).filter(g => {
        const gf = String(g.fecha || '').slice(0, 10);
        if (desde && gf && gf < desde) return false;
        if (hasta && gf && gf > hasta) return false;
        return true;
      });
      const totalGastosExtra = gastosList.reduce((s, g) => s + (Number(g.totalNeto ?? g.importe ?? 0) || 0), 0);

      const margenGlobalPct = totalIngresosNetos > 0 ? Number(((totalBeneficio / totalIngresosNetos) * 100).toFixed(1)) : 0;

      return sendJson(res, 200, {
        ok: true,
        kpis: {
          totalAvisos: allItems.length,
          totalIngresosBrutos: Number(totalIngresosBrutos.toFixed(2)),
          totalIngresosNetos: Number(totalIngresosNetos.toFixed(2)),
          totalCosteReal: Number(totalCosteReal.toFixed(2)),
          totalBeneficio: Number(totalBeneficio.toFixed(2)),
          margenGlobalPct,
          dineroFugadoPerdidas: Number(dineroFugadoPerdidas.toFixed(2)),
          totalGastosExtra: Number(totalGastosExtra.toFixed(2)),
          fugas: {
            segundasVisitas: countSegundasVisitas,
            margenNegativo: countMargenNegativo,
            garantiasDeficitarias: countGarantiasDeficitarias,
            desplazamientosCaros: countDesplazamientosCaros
          }
        },
        porTipo: formatAgg(byTipo),
        porOperario: formatAgg(byOperario),
        porPoblacion: formatAgg(byPoblacion, 'perdidas').slice(0, 20),
        items: allItems.slice(0, 300),
        totalItems: allItems.length
      });
    }

    if (pathname === '/api/admin/costes-config' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, config: getCostesConfig() });
    }

    if (pathname === '/api/admin/costes-config' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const current = getCostesConfig();
      const updated = {
        ...current,
        costeAdminPorAviso: body.costeAdminPorAviso !== undefined ? Number(body.costeAdminPorAviso) : current.costeAdminPorAviso,
        ivaDefecto: body.ivaDefecto !== undefined ? Number(body.ivaDefecto) : current.ivaDefecto,
        velocidadMediaKmH: body.velocidadMediaKmH !== undefined ? Number(body.velocidadMediaKmH) : current.velocidadMediaKmH,
        costeKmDefault: body.costeKmDefault !== undefined ? Number(body.costeKmDefault) : current.costeKmDefault,
        costeHoraVehiculoDefault: body.costeHoraVehiculoDefault !== undefined ? Number(body.costeHoraVehiculoDefault) : current.costeHoraVehiculoDefault,
        costeHoraOperarios: body.costeHoraOperarios && typeof body.costeHoraOperarios === 'object'
          ? { ...current.costeHoraOperarios, ...body.costeHoraOperarios }
          : current.costeHoraOperarios,
        vehiculosCoste: body.vehiculosCoste && typeof body.vehiculosCoste === 'object'
          ? { ...current.vehiculosCoste, ...body.vehiculosCoste }
          : current.vehiculosCoste
      };
      db.costesConfig = updated;
      saveDb();
      return sendJson(res, 200, { ok: true, config: updated });
    }

    if (pathname === '/api/admin/gastos' && req.method === 'GET') {
      const gastos = Array.isArray(db.gastosSat) ? db.gastosSat : [];
      return sendJson(res, 200, { ok: true, total: gastos.length, gastos: gastos.slice(0, 200) });
    }

    if (pathname === '/api/admin/gastos' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!Array.isArray(db.gastosSat)) db.gastosSat = [];
      const importe = Number(body.importe || 0) || 0;
      const ivaPct = body.ivaPct !== undefined ? Number(body.ivaPct) : 21;
      const totalNeto = body.totalNeto !== undefined ? Number(body.totalNeto) : Number((importe / (1 + ivaPct / 100)).toFixed(2));
      const nuevo = {
        idGasto: crypto.randomBytes(4).toString('hex'),
        fecha: String(body.fecha || nowMadridStr().slice(0, 10)).slice(0, 10),
        categoria: String(body.categoria || 'REPUESTOS').trim(),
        proveedor: String(body.proveedor || '').trim(),
        concepto: String(body.concepto || '').trim(),
        avisoNumero: body.avisoNumero ? String(body.avisoNumero).trim() : '',
        matricula: body.matricula ? String(body.matricula).toUpperCase().trim() : '',
        operario: body.operario ? String(body.operario).trim() : '',
        metodoPago: String(body.metodoPago || 'TARJETA').trim(),
        importe: Number(importe.toFixed(2)),
        ivaPct,
        totalNeto: Number(totalNeto.toFixed(2)),
        registradoPor: authUser.nombre
      };
      db.gastosSat.unshift(nuevo);
      saveDb();
      return sendJson(res, 201, { ok: true, gasto: nuevo });
    }

    // 1. BOOTSTRAP GENERAL (KPIs, Operarios, Marcas, Repuestos, Tarifas, Vehículos)
    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      const countsByState = {};
      for (const a of db.avisos) {
        const st = a.estadoAviso || 'SIN PROCESAR';
        countsByState[st] = (countsByState[st] || 0) + 1;
      }

      // Calcular "AVISOS PERDIDOS": Avisos AGENDADO o con cita pasada sin fichaje TERMINADO
      const avisosConFichaje = new Set(db.fichajes.map(f => f.idAviso));
      const avisosPerdidos = db.avisos
        .filter(a => (a.estadoAviso === 'AGENDADO' || a.estadoAviso === 'ASIGNADO') && !avisosConFichaje.has(a.idAviso))
        .slice(0, 60);

      // Fichajes actualmente ABIERTOS (sin hora de fin o estado EN CURSO)
      const fichajesAbiertos = db.fichajes.filter(f => f.estadoFichaje === 'EN CURSO' || !f.fin);

      return sendJson(res, 200, {
        ok: true,
        meta: db.meta,
        countsByState,
        kpis: {
          totalAvisos: db.avisos.length,
          sinProcesar: countsByState['SIN PROCESAR'] || 0,
          realizables: countsByState['REALIZABLE'] || 0,
          agendados: countsByState['AGENDADO'] || 0,
          pasarAliquo: countsByState['FINALIZADO, PASAR ALIQUO'] || 0,
          esperandoMaterial:
            (countsByState['PENDIENTE PEDIR MATERIAL/REPUESTO'] || 0) +
            (countsByState['PENDIENTE LLEGAR MATERIAL/REPUESTO'] || 0) +
            (countsByState['PENDIENTE PRESUPUESTO JACOBO'] || 0) +
            (countsByState['PEDIR MATERIAL'] || 0) +
            (countsByState['MATERIAL PEDIDO'] || 0) +
            (countsByState['PDTE. RECIBIR MATERIAL'] || 0),
          avisosPerdidosCount: avisosPerdidos.length,
          contratosCmTotal: db.contratosCm.length,
          contratosCmPendientes: db.contratosCm.filter(c => !c.pasadoAAvisos).length,
          fichajesAbiertosCount: fichajesAbiertos.length
        },
        tarifas: db.tarifas,
        operarios: db.operarios,
        marcas: db.marcas,
        repuestos: authUser.canSeeCostes
          ? db.repuestos
          : (db.repuestos || []).map(r => ({ ...r, precioNeto: undefined, portes: undefined })),
        vehiculos: VEHICULOS_OFICIALES,
        googleReviewUrl: process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/CeTJ0YmzOC_AEAE/review',
        gastosVehiculos: db.gastosVehiculos,
        fichajesAbiertos
      });
    }

    // 2. BÚSQUEDA EN VIVO DE CLIENTES EN ALIQUO SQL + HISTÓRICO SAT
    if ((pathname === '/api/sat/buscar-cliente' || pathname === '/api/aliquo/buscar-cliente') && req.method === 'GET') {
      const q = parsedUrl.searchParams.get('q') || '';
      const result = await searchClientsAliquoAndSat(q);
      return sendJson(res, 200, { ok: true, query: q, ...result });
    }

    // 2.0 VISTA PREVIA SEGURA DE VOLCADO A ALIQUO (Solo lectura — Fase 2)
    if (pathname === '/api/aliquo/preview-volcado' && req.method === 'GET') {
      const idAviso = parsedUrl.searchParams.get('idAviso') || '';
      const serialCode = parsedUrl.searchParams.get('serialCode') || '';
      const av = db.avisos.find(a => a.idAviso === idAviso || String(a.numero) === String(idAviso));
      if (!av) return sendJson(res, 404, { ok: false, error: 'Aviso no encontrado' });

      const fichajesAviso = db.fichajes.filter(f => f.idAviso === av.idAviso && f.estadoFichaje === 'TERMINADO');
      const fichaje = fichajesAviso[0] || {
        idFichaje: 'fich-' + av.numero,
        idAviso: av.idAviso,
        avisoNumero: av.numero,
        operario: av.operarioPreasignado || 'JACOBO',
        fin: nowMadridStr(),
        minutosTrabajados: 45,
        importe: av.sumaImportes || 0,
        metodoPago: 'EFECTIVO',
        notas: av.notasFichajes || av.observaciones || 'Intervención SAT finalizada',
        repuestosUsados: [],
        desgloseTarifa: null
      };

      const preview = await buildAliquoVolcadoPreview(av, fichaje, { serialCode });
      return sendJson(res, 200, { ok: true, preview });
    }

    // 2.1 VOLCADO DE ALBARÁN A ALIQUO (Modo Local o REAL contra api.aliquo.software — Fase 2)
    if (pathname === '/api/aliquo/volcar-albaran' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const av = db.avisos.find(a => a.idAviso === body.idAviso || String(a.numero) === String(body.numero));
      if (!av) return sendJson(res, 404, { ok: false, error: 'Aviso no encontrado' });

      const fichajesAviso = db.fichajes.filter(f => f.idAviso === av.idAviso && f.estadoFichaje === 'TERMINADO');
      const fichaje = fichajesAviso[0] || {
        idFichaje: 'fich-' + av.numero,
        idAviso: av.idAviso,
        avisoNumero: av.numero,
        operario: av.operarioPreasignado || 'JACOBO',
        fin: new Date().toISOString().slice(0, 16).replace('T', ' '),
        minutosTrabajados: 45,
        importe: av.sumaImportes || 0,
        metodoPago: 'EFECTIVO',
        notas: av.notasFichajes || av.descripcionAveria || 'Intervención SAT finalizada',
        repuestosUsados: [],
        desgloseTarifa: null
      };

      // MODO REAL CONTRA API OFICIAL DE ALIQUO (POST /Note + opcional POST/PUT /Data)
      if (body.modoReal === true) {
        if (av.aliquoRealSynced && !body.force) {
          return sendJson(res, 409, {
            ok: false,
            error: `Este aviso ya fue volcado a Aliquo (${av.aliquoDoc || av.aliquoIdNota}). Bloqueado para evitar duplicados.`
          });
        }
        const preview = await buildAliquoVolcadoPreview(av, fichaje, { serialCode: body.serialCode });
        const customObs = typeof body.bloqueAnexarVarios === 'string' && body.bloqueAnexarVarios.trim()
          ? body.bloqueAnexarVarios.trim()
          : preview.bloqueAnexarVarios;
        preview.notePayload.observations = customObs;

        let clienteCreadoReal = false;
        if (!preview.clienteExisteEnAliquo && body.crearClienteSiNoExiste !== false) {
          await callAliquoApi('POST', '/Data', [{
            table: 'Clientes',
            fields: [
              { field: 'Codigo', value: preview.clienteCodigo, isKey: true },
              { field: 'Nombre', value: preview.clienteNombre || 'CLIENTE SAT', isKey: false },
              { field: 'Direccion', value: av.direccionCompleta || '', isKey: false },
              { field: 'Poblacion', value: av.poblacion || 'VALLADOLID', isKey: false },
              { field: 'Provincia', value: 'VALLADOLID', isKey: false },
              { field: 'Telefono', value: av.telefono1 || '', isKey: false },
              { field: 'Email', value: av.email || '', isKey: false },
              { field: 'Observaciones', value: customObs, isKey: false }
            ]
          }]);
          clienteCreadoReal = true;
          av.codigoCliente = preview.clienteCodigo;
        }

        const noteRes = await callAliquoApi('POST', '/Note', preview.notePayload);
        const createdNote = noteRes.data || {};
        const aliquoIdNota = createdNote.id || createdNote.Id || null;
        const aliquoNum = createdNote.number || createdNote.Number || av.numero;
        const aliquoDoc = `${preview.serialCode}-${aliquoNum}`;

        let variosActualizado = false;
        let variosError = null;
        if (body.actualizarVarios !== false && !clienteCreadoReal) {
          const finalVarios = preview.aliquoObservacionesPrevias
            ? `${preview.aliquoObservacionesPrevias}\n\n${customObs}`
            : customObs;
          try {
            await callAliquoApi('PUT', '/Data', [{
              table: 'Clientes',
              fields: [
                { field: 'Codigo', value: preview.clienteCodigo, isKey: true },
                { field: 'Observaciones', value: finalVarios, isKey: false }
              ]
            }]);
            variosActualizado = true;
          } catch (vErr) {
            variosError = vErr.message;
          }
        } else if (clienteCreadoReal) {
          variosActualizado = true;
        }

        const alb = sincronizarAlbaranConAliquo(av, fichaje);
        alb.idAlbaran = aliquoDoc;
        alb.aliquoIdNota = aliquoIdNota;
        alb.modoReal = true;
        alb.serialCode = preview.serialCode;

        av.estadoAviso = 'PASADO ALIQUO';
        av.aliquoRealSynced = true;
        av.aliquoIdNota = aliquoIdNota;
        av.aliquoDoc = aliquoDoc;
        av.aliquoFecha = nowMadridStr();
        saveDb();

        return sendJson(res, 200, {
          ok: true,
          modoReal: true,
          albaran: alb,
          aviso: av,
          aliquoIdNota,
          aliquoDoc,
          clienteCreadoReal,
          variosActualizado,
          variosError
        });
      }

      const alb = sincronizarAlbaranConAliquo(av, fichaje);
      av.estadoAviso = 'PASADO ALIQUO';
      av.aliquoDoc = alb.idAlbaran;
      av.aliquoFecha = alb.fechaGenerado;
      saveDb();

      return sendJson(res, 200, { ok: true, modoReal: false, albaran: alb, aviso: av });
    }

    // 2.2 LISTAR ALBARANES SINCRONIZADOS CON ALIQUO
    if (pathname === '/api/aliquo/albaranes' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        total: (db.albaranesAliquo || []).length,
        albaranes: (db.albaranesAliquo || []).slice(0, 100)
      });
    }

    // 3. LISTAR / FILTRAR AVISOS
    if (pathname === '/api/avisos' && req.method === 'GET') {
      const estado = parsedUrl.searchParams.get('estado') || '';
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
      const operario = (parsedUrl.searchParams.get('operario') || '').trim().toUpperCase();
      const prioridad = (parsedUrl.searchParams.get('prioridad') || '').trim().toUpperCase();
      const tipoServicio = (parsedUrl.searchParams.get('tipoServicio') || 'TODOS').trim().toUpperCase();
      const sort = (parsedUrl.searchParams.get('sort') || 'newest').trim().toLowerCase();
      const limit = Math.min(500, parseInt(parsedUrl.searchParams.get('limit') || '150', 10));

      let list = db.avisos;
      if (tipoServicio && tipoServicio !== 'TODOS') {
        if (tipoServicio === 'MONTAJE_GOTERA') {
          list = list.filter(a => String(a.tipoServicio || 'SAT').toUpperCase() === 'MONTAJE_GOTERA');
        } else {
          list = list.filter(a => String(a.tipoServicio || 'SAT').toUpperCase() !== 'MONTAJE_GOTERA');
        }
      }
      if (estado && estado !== 'TODOS') {
        if (estado === 'PERDIDOS') {
          const conFichaje = new Set(db.fichajes.map(f => f.idAviso));
          list = list.filter(a => (a.estadoAviso === 'AGENDADO' || a.estadoAviso === 'ASIGNADO') && !conFichaje.has(a.idAviso));
        } else if (estado === 'MATERIALES') {
          list = list.filter(a =>
            String(a.estadoAviso || '').includes('MATERIAL') ||
            String(a.estadoAviso || '').includes('PRESUP')
          );
        } else {
          list = list.filter(a => a.estadoAviso === estado);
        }
      }
      if (operario && operario !== 'TODOS') {
        list = list.filter(a => String(a.operarioPreasignado || '').toUpperCase().includes(operario));
      }
      if (prioridad && prioridad !== 'TODAS') {
        if (prioridad === 'FUEGO') {
          list = list.filter(a => Boolean(a.esFuego) || Number(a.llamadasTienda || 0) > 0);
        } else {
          list = list.filter(a => String(a.prioridad || 'MEDIA').toUpperCase() === prioridad);
        }
      }
      if (q) {
        list = list.filter(a =>
          String(a.numero).includes(q) ||
          (a.codigoCliente || '').toLowerCase().includes(q) ||
          (a.nombreCliente || '').toLowerCase().includes(q) ||
          (a.apellidosCliente || '').toLowerCase().includes(q) ||
          (a.direccionCompleta || '').toLowerCase().includes(q) ||
          (a.poblacion || '').toLowerCase().includes(q) ||
          (a.telefono1 || '').toLowerCase().includes(q) ||
          (a.marca || '').toLowerCase().includes(q) ||
          (a.modelo || '').toLowerCase().includes(q) ||
          (a.observaciones || '').toLowerCase().includes(q)
        );
      }

      if (sort === 'oldest' || sort === 'newest' || sort === 'priority') {
        const toTime = (s) => {
          if (!s) return 0;
          const norm = String(s).includes('T') ? String(s) : String(s).replace(' ', 'T');
          const t = Date.parse(norm);
          return Number.isNaN(t) ? 0 : t;
        };
        const prioWeight = (a) => {
          const fuego = (a.esFuego || Number(a.llamadasTienda || 0) > 0) ? 10 : 0;
          const p = String(a.prioridad || 'MEDIA').toUpperCase();
          return fuego + (p === 'ALTA' ? 3 : p === 'MEDIA' ? 2 : 1);
        };
        list = [...list].sort((a, b) => {
          if (sort === 'oldest') return toTime(a.fecha) - toTime(b.fecha) || (a.numero - b.numero);
          if (sort === 'priority') return (prioWeight(b) - prioWeight(a)) || (toTime(a.fecha) - toTime(b.fecha));
          return toTime(b.fecha) - toTime(a.fecha) || (b.numero - a.numero);
        });
      }

      return sendJson(res, 200, {
        ok: true,
        total: list.length,
        avisos: list.slice(0, limit)
      });
    }

    // 4. CREAR NUEVO AVISO (Alta Express 15s con numerador atómico MAX + 1)
    if (pathname === '/api/avisos' && req.method === 'POST') {
      if (!authUser.canCreateAviso) {
        return sendJson(res, 403, { ok: false, error: 'Tu usuario no tiene permiso para crear nuevos avisos.' });
      }
      const body = await readJsonBody(req);
      const nuevoNumero = getNextAvisoNumero();
      const idAviso = crypto.randomBytes(4).toString('hex');
      const dir = String(body.direccionCompleta || '').trim();
      const geo = inferGeo(dir, nuevoNumero);

      // PRE-ALTA LOCAL SOLO SI EL CLIENTE NO EXISTE EN ALIQUO (Nunca sobrescribir códigos existentes)
      let codCli = String(body.codigoCliente || '').trim();
      const esClienteNuevo = !codCli || codCli.toUpperCase() === 'NO ES CLIENTE';
      let clienteCreadoAliquo = null;
      const debeCrearEnAliquo = esClienteNuevo && body.crearClienteEnAliquo !== false;

      if (debeCrearEnAliquo && body.nombreCliente) {
        const nuevoCodigo = generarCodigoClienteAliquo();
        clienteCreadoAliquo = {
          Codigo: nuevoCodigo,
          Nombre: `${String(body.nombreCliente || '').trim().toUpperCase()} ${String(body.apellidosCliente || '').trim().toUpperCase()}`.trim(),
          NIF: String(body.dni || '').trim().toUpperCase(),
          Direccion: dir,
          Poblacion: body.poblacion || geo.poblacionDetectada || 'VALLADOLID',
          Provincia: 'Valladolid',
          CodigoPostal: '47000',
          Telefono: String(body.telefono1 || '').trim(),
          Email: String(body.email || '').trim().toLowerCase(),
          FechaAlta: new Date().toISOString(),
          Origen: 'PRE-ALTA SAT BAZA 2.0 (PDTE SYNC ALIQUO)'
        };

        codCli = nuevoCodigo;
        aliquoLocalCache.unshift(clienteCreadoAliquo);
        if (!db.clientesCreadosAliquo) db.clientesCreadosAliquo = [];
        db.clientesCreadosAliquo.unshift(clienteCreadoAliquo);
      }

      const nuevoAviso = {
        idAviso,
        numero: nuevoNumero,
        fecha: nowMadridStr(),
        anota: String(body.anota || 'JACOBO').toUpperCase(),
        clienteExistente: !esClienteNuevo,
        codigoCliente: codCli || 'CLIENTE',
        dni: String(body.dni || '').trim().toUpperCase(),
        email: String(body.email || '').trim().toLowerCase(),
        nombreCliente: String(body.nombreCliente || '').trim().toUpperCase(),
        apellidosCliente: String(body.apellidosCliente || '').trim().toUpperCase(),
        direccionCompleta: dir,
        poblacion: body.poblacion || geo.poblacionDetectada,
        lat: Number(body.lat) || geo.lat,
        lng: Number(body.lng) || geo.lng,
        kmIdaVuelta: Number(body.kmIdaVuelta) || geo.kmIdaVuelta,
        telefono1: String(body.telefono1 || '').trim(),
        telefono2: String(body.telefono2 || '').trim(),
        tipoAparato: String(body.tipoAparato || 'PELLET AIRE').trim(),
        marca: String(body.marca || '').trim().toUpperCase(),
        modelo: String(body.modelo || '').trim().toUpperCase(),
        fechaInstalacion: String(body.fechaInstalacion || body.fechaContrato || '').trim(),
        docCompra: String(body.docCompra || body.numContrato || '').trim(),
        numSerie: String(body.numSerie || '').trim(),
        instalacionBaza: String(body.instalacionBaza || '').trim(),
        observacionesAliquo: String(body.observacionesAliquo || '').trim(),
        relacion: String(body.relacion || 'INSTALADO').trim(),
        contratoMant: Boolean(body.contratoMant),
        observaciones: String(body.observaciones || '').trim(),
        tratoCliente: String(body.tratoCliente || 'BUENO').trim(),
        horariosDisponibles: String(body.horariosDisponibles || 'MAÑANAS O TARDES').trim(),
        prioridad: String(body.prioridad || 'MEDIA').trim(),
        esFuego: Boolean(body.esFuego),
        llamadasTienda: Number(body.llamadasTienda) || (body.esFuego ? 1 : 0),
        tipoIntervencion: String(body.tipoIntervencion || 'SAT NORMAL').trim(),
        tipoServicio: body.tipoServicio === 'MONTAJE_GOTERA' ? 'MONTAJE_GOTERA' : 'SAT',
        estadoAviso: authUser.lockedTechEmail ? 'SIN PROCESAR' : String(body.estadoAviso || 'SIN PROCESAR').trim(),
        operarioPreasignado: String(body.operarioPreasignado || (body.tipoServicio === 'MONTAJE_GOTERA' ? 'DANY' : 'JACOBO')).trim(),
        notasFichajes: '',
        sumaImportes: 0,
        // Información Económica Previa (Fase 1.5B)
        precioComunicado: body.precioComunicado !== undefined && body.precioComunicado !== '' && body.precioComunicado !== null ? Number(body.precioComunicado) : null,
        estadoCobroPrevio: ['PENDIENTE', 'SENAL_PARCIAL', 'ABONADO_TOTAL'].includes(String(body.estadoCobroPrevio || '').toUpperCase())
          ? String(body.estadoCobroPrevio).toUpperCase()
          : (body.pago50Verificado ? 'SENAL_PARCIAL' : 'PENDIENTE'),
        importeAbonadoPrevio: Number(body.importeAbonadoPrevio) || 0,
        metodoPagoPrevio: String(body.metodoPagoPrevio || '').trim().toUpperCase(),
        fechaPagoPrevio: String(body.fechaPagoPrevio || '').trim(),
        checklistAccesorios: body.checklistAccesorios && typeof body.checklistAccesorios === 'object' ? body.checklistAccesorios : null,
        // Campos operativos Reunión 12-Nov (Buzón de Alertas)
        esContratoObra: Boolean(body.esContratoObra),
        modalidadLogistica: body.modalidadLogistica === 'ENVIO_ALMACEN' ? 'ENVIO_ALMACEN' : 'INSTALACION',
        pago50Verificado: Boolean(body.pago50Verificado),
        pago50Fecha: String(body.pago50Fecha || (body.pago50Verificado ? nowMadridStr().slice(0, 10) : '')).trim(),
        pago50VerificadoPor: String(body.pago50VerificadoPor || '').trim(),
        pedidoProveedorEstado: ['NO_APLICA', 'PENDIENTE', 'PEDIDO_ENVIADO', 'RECIBIDO'].includes(body.pedidoProveedorEstado)
          ? body.pedidoProveedorEstado
          : (body.esContratoObra ? 'PENDIENTE' : 'NO_APLICA'),
        pedidoProveedorFecha: String(body.pedidoProveedorFecha || '').trim(),
        pedidoProveedorRef: String(body.pedidoProveedorRef || '').trim(),
        rematePendiente: Boolean(body.rematePendiente),
        remateFechaLimite: String(body.remateFechaLimite || '').trim()
      };

      if ((nuevoAviso.rematePendiente || nuevoAviso.estadoAviso === 'NUEVA CITA') && !nuevoAviso.remateFechaLimite) {
        nuevoAviso.remateFechaLimite = addDaysMadridDate(7);
      }

      db.avisos.unshift(nuevoAviso);
      saveDb();
      return sendJson(res, 201, { ok: true, aviso: nuevoAviso, clienteCreado: clienteCreadoAliquo });
    }

    // 5. ACTUALIZACIÓN RÁPIDA DE UN AVISO (Quick-Edit Estado, Prioridad, Operario, Trato, Observaciones...)
    if (pathname.startsWith('/api/avisos/') && (req.method === 'PATCH' || req.method === 'PUT')) {
      const idAviso = pathname.split('/')[3];
      const body = await readJsonBody(req);
      const aviso = db.avisos.find(a => a.idAviso === idAviso || String(a.numero) === idAviso);
      if (!aviso) return sendJson(res, 404, { ok: false, error: 'Aviso no encontrado' });

      const allowed = [
        'estadoAviso', 'prioridad', 'esFuego', 'llamadasTienda', 'tratoCliente', 'operarioPreasignado',
        'tipoIntervencion', 'tipoServicio', 'observaciones', 'horariosDisponibles', 'marca',
        'modelo', 'tipoAparato', 'contratoMant', 'codigoCliente', 'telefono1',
        'direccionCompleta', 'sumaImportes', 'notasFichajes', 'kmIdaVuelta',
        'fechaInstalacion', 'docCompra', 'numSerie', 'relacion', 'instalacionBaza', 'observacionesAliquo',
        'precioComunicado', 'estadoCobroPrevio', 'importeAbonadoPrevio', 'metodoPagoPrevio', 'fechaPagoPrevio',
        'checklistAccesorios',
        'esContratoObra', 'modalidadLogistica', 'pago50Verificado', 'pago50Fecha', 'pago50VerificadoPor',
        'pedidoProveedorEstado', 'pedidoProveedorFecha', 'pedidoProveedorRef',
        'rematePendiente', 'remateFechaLimite'
      ];
      for (const k of allowed) {
        if (body[k] !== undefined) aviso[k] = body[k];
      }
      if (body.pago50Verificado === true && !aviso.pago50Fecha) {
        aviso.pago50Fecha = nowMadridStr().slice(0, 10);
      }
      if (body.pedidoProveedorEstado === 'PEDIDO_ENVIADO' && !aviso.pedidoProveedorFecha) {
        aviso.pedidoProveedorFecha = nowMadridStr().slice(0, 10);
      }
      if ((aviso.rematePendiente === true || aviso.estadoAviso === 'NUEVA CITA') && !aviso.remateFechaLimite) {
        aviso.remateFechaLimite = addDaysMadridDate(7);
      }
      saveDb();
      return sendJson(res, 200, { ok: true, aviso });
    }

    // 5.1 BUZÓN DE ALERTAS OPERATIVAS (3 SEMÁFOROS + REMATES 7 DÍAS)
    if (pathname === '/api/sat/buzon-alertas' && req.method === 'GET') {
      const buzon = computeBuzonAlertas();
      return sendJson(res, 200, { ok: true, ...buzon });
    }

    // 5.2 HISTÓRICO GENERAL SAT BUSCABLE (Fase 1.5B)
    if (pathname === '/api/sat/historico' && req.method === 'GET') {
      const limit = Math.min(500, parseInt(parsedUrl.searchParams.get('limit') || '200', 10));
      const result = buildHistoricoRows(parsedUrl.searchParams, authUser, limit);
      return sendJson(res, 200, { ok: true, ...result });
    }

    // 6. RADAR GPS "DE CAMINO / CERCA DE MÍ" PARA TÉCNICOS
    if (pathname === '/api/radar-cercanos' && req.method === 'GET') {
      const lat = parseFloat(parsedUrl.searchParams.get('lat') || String(HQ_COORDS.lat));
      const lng = parseFloat(parsedUrl.searchParams.get('lng') || String(HQ_COORDS.lng));
      const operarioEmail = (parsedUrl.searchParams.get('email') || '').toLowerCase();

      // Fórmula Haversine aproximada en km por carretera (* 1.28)
      function distKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Number((R * c * 1.28).toFixed(1));
      }

      const candidatos = db.avisos
        .filter(a => ['REALIZABLE', 'SIN PROCESAR', 'NUEVA CITA', 'ASIGNADO'].includes(a.estadoAviso))
        .map(a => ({
          ...a,
          distanciaDesdeTecnicoKm: distKm(lat, lng, a.lat || HQ_COORDS.lat, a.lng || HQ_COORDS.lng)
        }))
        .sort((a, b) => a.distanciaDesdeTecnicoKm - b.distanciaDesdeTecnicoKm)
        .slice(0, 25);

      return sendJson(res, 200, {
        ok: true,
        origen: { lat, lng, operarioEmail },
        cercanos: candidatos
      });
    }

    // 7. LISTAR Y CREAR CITAS (Calendario Multi-Técnico y Parejas Dinámicas ASISTENTES)
    if (pathname === '/api/citas' && req.method === 'GET') {
      const operarioEmail = (parsedUrl.searchParams.get('email') || '').trim().toLowerCase();
      const fecha = (parsedUrl.searchParams.get('fecha') || '').trim();
      const desde = (parsedUrl.searchParams.get('desde') || '').trim();
      const hasta = (parsedUrl.searchParams.get('hasta') || '').trim();
      const limit = Math.min(3000, parseInt(parsedUrl.searchParams.get('limit') || '200', 10));

      let list = db.citas;
      if (operarioEmail) {
        list = list.filter(c => String(c.asistentes || '').toLowerCase().includes(operarioEmail));
      }
      if (fecha) {
        list = list.filter(c => String(c.inicio || '').startsWith(fecha));
      }
      if (desde && hasta) {
        list = list.filter(c => {
          const d = String(c.inicio || '').slice(0, 10);
          return d >= desde && d <= hasta;
        });
      }

      // Enriquecer cada cita con los datos completos del aviso y de la marca (códigos de reset y teléfono fábrica)
      const avisoMap = new Map(db.avisos.map(a => [a.idAviso, a]));
      const marcaMap = new Map(db.marcas.map(m => [m.marca.toUpperCase(), m]));

      const enriched = list.slice(0, limit).map(c => {
        const av = avisoMap.get(c.idAviso) || db.avisos.find(a => a.numero === c.avisoNumero) || null;
        const marcaKey = av && av.marca ? av.marca.toUpperCase() : '';
        let infoMarca = marcaMap.get(marcaKey) || null;
        if (!infoMarca && marcaKey) {
          for (const [mk, mv] of marcaMap.entries()) {
            if (marcaKey.includes(mk) || mk.includes(marcaKey)) {
              infoMarca = mv;
              break;
            }
          }
        }
        return {
          ...c,
          aviso: av,
          infoMarca
        };
      });

      return sendJson(res, 200, { ok: true, total: list.length, citas: enriched });
    }

    if (pathname === '/api/citas' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const av = db.avisos.find(a => a.idAviso === body.idAviso || String(a.numero) === String(body.avisoNumero));

      // Regla estricta Nota 5: Bloqueo si es contrato de instalación sin señal del 50% verificada
      if (av && av.esContratoObra === true && av.modalidadLogistica !== 'ENVIO_ALMACEN' && !av.pago50Verificado) {
        if (!body.forzarSinSenal) {
          return sendJson(res, 409, {
            ok: false,
            code: 'SENAL_50_NO_VERIFICADA',
            error: 'Bloqueo operativo: El pago del 50% de señal no está verificado para este contrato de instalación.'
          });
        }
        const stamp = nowMadridStr();
        const notaOverride = `[OVERRIDE DIRECCIÓN SIN SEÑAL 50% - ${stamp}]`;
        av.observaciones = av.observaciones ? `${av.observaciones}\n${notaOverride}` : notaOverride;
      }

      const idCita = crypto.randomBytes(4).toString('hex');

      const asistentesArr = Array.isArray(body.asistentes)
        ? body.asistentes
        : String(body.asistentes || 'jacobo.bazamazano@gmail.com').split(',').map(s => s.trim()).filter(Boolean);

      const tituloAuto = body.titulo || (av
        ? `${av.numero} - ${av.tipoIntervencion} (${av.nombreCliente} ${av.apellidosCliente})`
        : `CITA SAT`);

      const nuevaCita = {
        idCita,
        idAviso: av ? av.idAviso : (body.idAviso || ''),
        avisoNumero: av ? av.numero : (Number(body.avisoNumero) || 0),
        titulo: tituloAuto,
        inicio: String(body.inicio || nowMadridStr()),
        fin: String(body.fin || nowMadridStr(Date.now() + 3600000)),
        creadoPor: String(body.creadoPor || 'JACOBO'),
        direccion: av ? av.direccionCompleta : String(body.direccion || ''),
        asistentes: asistentesArr.join(', '),
        descripcion: body.descripcion || (av ? `${av.marca} ${av.modelo} — ${av.observaciones}` : ''),
        enCalendario: true,
        whatsappConfirmado: false
      };

      db.citas.unshift(nuevaCita);
      if (av) {
        av.estadoAviso = 'AGENDADO';
        // Actualizar operario preasignado según primer asistente
        const opObj = db.operarios.find(o => o.email.toLowerCase() === (asistentesArr[0] || '').toLowerCase());
        if (opObj) av.operarioPreasignado = opObj.nombre;
      }
      saveDb();
      return sendJson(res, 201, { ok: true, cita: nuevaCita, aviso: av });
    }

    // Confirmar Cita por WhatsApp (Botón explícito Q-004)
    if (pathname.startsWith('/api/citas/') && pathname.endsWith('/confirmar-whatsapp') && req.method === 'POST') {
      const idCita = pathname.split('/')[3];
      const body = await readJsonBody(req);
      const cita = db.citas.find(c => c.idCita === idCita);
      if (!cita) return sendJson(res, 404, { ok: false, error: 'Cita no encontrada' });

      cita.whatsappConfirmado = true;
      cita.whatsappEnviadoAt = new Date().toISOString();
      cita.ultimoMensajeWhatsapp = body.mensaje || '';
      saveDb();

      return sendJson(res, 200, {
        ok: true,
        cita,
        message: 'Confirmación de cita registrada y enviada por WhatsApp.'
      });
    }

    // 8. CALCULADORA DE TARIFAS 2026/2027 EN VIVO
    if (pathname === '/api/calcular-tarifa' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const desglose = calcularImporteIntervencion(body);
      return sendJson(res, 200, { ok: true, desglose });
    }

    // 9. FICHAJES DE TÉCNICOS (Iniciar Fichaje con Cinturón Anti-Olvidos + Cerrar Fichaje en 3 Pasos)
    if (pathname === '/api/fichajes' && req.method === 'GET') {
      const idAviso = parsedUrl.searchParams.get('idAviso') || '';
      const operario = (parsedUrl.searchParams.get('operario') || '').toLowerCase();
      let list = db.fichajes;
      if (idAviso) list = list.filter(f => f.idAviso === idAviso || String(f.avisoNumero) === idAviso);
      if (operario) list = list.filter(f => String(f.operario || '').toLowerCase().includes(operario));
      return sendJson(res, 200, { ok: true, total: list.length, fichajes: list.slice(0, 120) });
    }

    // INICIAR FICHAJE (Guarda UBICACION INICIO y activa Geocerca 1 km)
    if (pathname === '/api/fichajes/iniciar' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const operarioEmail = String(body.operario || 'jacobo.bazamazano@gmail.com').trim().toLowerCase();

      // CINTURÓN DE SEGURIDAD #2: Comprobar si el técnico ya tiene un fichaje abierto sin cerrar
      const abiertoPrevio = db.fichajes.find(f =>
        String(f.operario || '').toLowerCase() === operarioEmail &&
        (f.estadoFichaje === 'EN CURSO' || !f.fin)
      );
      if (abiertoPrevio && !body.forzarApertura) {
        return sendJson(res, 409, {
          ok: false,
          code: 'PARTE_PREVIO_ABIERTO',
          error: `Tienes el Parte #${abiertoPrevio.avisoNumero} abierto desde las ${abiertoPrevio.inicio}. Ciérralo antes de iniciar el siguiente aviso.`,
          fichajeAbierto: abiertoPrevio
        });
      }

      const av = db.avisos.find(a => a.idAviso === body.idAviso || String(a.numero) === String(body.avisoNumero));
      const idFichaje = crypto.randomBytes(4).toString('hex');
      const lat = Number(body.lat) || (av && av.lat) || HQ_COORDS.lat;
      const lng = Number(body.lng) || (av && av.lng) || HQ_COORDS.lng;

      const nuevoFichaje = {
        idFichaje,
        idAviso: av ? av.idAviso : String(body.idAviso || ''),
        avisoNumero: av ? av.numero : (Number(body.avisoNumero) || 0),
        clienteNombre: av ? `${av.nombreCliente} ${av.apellidosCliente}`.trim() : String(body.clienteNombre || ''),
        direccion: av ? av.direccionCompleta : String(body.direccion || ''),
        operario: operarioEmail,
        companeroApoyo: String(body.companeroApoyo || ''),
        inicio: nowMadridStr(),
        inicioTimestampMs: Date.now(),
        fin: '',
        ubicacionInicio: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        latInicio: lat,
        lngInicio: lng,
        ubicacionFin: '',
        duracion: 'EN CURSO',
        importe: 0,
        metodoPago: '',
        notas: '',
        tratoCliente: av ? av.tratoCliente : 'BUENO',
        estadoFichaje: 'EN CURSO',
        firma: '',
        fotoAdjuntar: '',
        repuestosUsados: [],
        kmCalculados: av ? av.kmIdaVuelta : 14
      };

      db.fichajes.unshift(nuevoFichaje);
      saveDb();
      return sendJson(res, 201, { ok: true, fichaje: nuevoFichaje, aviso: av });
    }

    // CERRAR FICHAJE (Asistente de 3 Pasos + Rollup automático en AVISOS)
    if (pathname === '/api/fichajes/cerrar' && req.method === 'POST') {
      const body = await readJsonBody(req);
      let fichaje = db.fichajes.find(f => f.idFichaje === body.idFichaje);
      const av = db.avisos.find(a =>
        a.idAviso === (body.idAviso || (fichaje && fichaje.idAviso)) ||
        String(a.numero) === String(body.avisoNumero || (fichaje && fichaje.avisoNumero))
      );

      const nowMs = body.ajustarSalida3MinAntes ? (Date.now() - 3 * 60 * 1000) : Date.now();
      const finStr = nowMadridStr(nowMs);
      const minutos = Math.max(15, Number(body.minutosTrabajados) || 45);
      const horas = Math.floor(minutos / 60);
      const minsRest = minutos % 60;
      const duracionStr = `${String(horas).padStart(2, '0')}:${String(minsRest).padStart(2, '0')}:00`;

      if (!fichaje) {
        fichaje = {
          idFichaje: crypto.randomBytes(4).toString('hex'),
          idAviso: av ? av.idAviso : String(body.idAviso || ''),
          avisoNumero: av ? av.numero : Number(body.avisoNumero || 0),
          operario: String(body.operario || 'jacobo.bazamazano@gmail.com'),
          companeroApoyo: String(body.companeroApoyo || ''),
          inicio: nowMadridStr(nowMs - minutos * 60000),
          ubicacionInicio: av ? `${av.lat}, ${av.lng}` : `${HQ_COORDS.lat}, ${HQ_COORDS.lng}`,
          latInicio: av ? av.lat : HQ_COORDS.lat,
          lngInicio: av ? av.lng : HQ_COORDS.lng
        };
        db.fichajes.unshift(fichaje);
      }

      fichaje.fin = finStr;
      fichaje.ubicacionFin = body.ubicacionFin || fichaje.ubicacionInicio;
      fichaje.duracion = duracionStr;
      fichaje.minutosTrabajados = minutos;
      fichaje.importe = Number(body.importe) || 0;
      fichaje.metodoPago = String(body.metodoPago || 'EFECTIVO');
      fichaje.notas = String(body.notas || '').trim();
      fichaje.tratoCliente = String(body.tratoCliente || 'BUENO');
      fichaje.estadoFichaje = 'TERMINADO';
      fichaje.firma = persistMediaDataUrl(body.firma || '', 'fichajes', `${fichaje.idFichaje}_firma`);
      fichaje.fotoAdjuntar = persistMediaDataUrl(body.fotoAdjuntar || '', 'fichajes', `${fichaje.idFichaje}_foto`);
      fichaje.repuestosUsados = Array.isArray(body.repuestosUsados) ? body.repuestosUsados : [];
      fichaje.desgloseTarifa = body.desgloseTarifa || null;
      fichaje.kmCalculados = Number(body.kmIdaVuelta) || (av ? av.kmIdaVuelta : 14);
      if (av && body.tipoIntervencion) av.tipoIntervencion = String(body.tipoIntervencion).trim();

      // ROLLUP AUTOMÁTICO EN AVISOS (Idéntico a AppSheet pero con desglose limpio para Silvia y Lidia)
      let albaranGenerado = null;
      if (av) {
        const opObj = db.operarios.find(o => o.email.toLowerCase() === String(fichaje.operario).toLowerCase());
        const opName = opObj ? opObj.nombre : fichaje.operario;
        const repText = fichaje.repuestosUsados.length > 0
          ? ` | REPUESTOS: ${fichaje.repuestosUsados.map(r => `${r.cantidad || 1}x ${r.codigo} (${r.descripcion})`).join(', ')}`
          : '';
        const lineaResumen = `[${finStr} · ${opName}${fichaje.companeroApoyo ? ' + ' + fichaje.companeroApoyo : ''} · ${minutos} min · ${fichaje.importe.toFixed(2)}€ (${fichaje.metodoPago})]: ${fichaje.notas}${repText}`;

        av.notasFichajes = av.notasFichajes
          ? `${lineaResumen}\n${av.notasFichajes}`
          : lineaResumen;

        // Recalcular SUMA IMPORTES AVISO
        const todosFichajesAviso = db.fichajes.filter(f => f.idAviso === av.idAviso && f.estadoFichaje === 'TERMINADO');
        av.sumaImportes = Number(todosFichajesAviso.reduce((sum, f) => sum + (Number(f.importe) || 0), 0).toFixed(2));
        av.tratoCliente = fichaje.tratoCliente || av.tratoCliente;

        const estadoDeseado = String(body.nuevoEstadoAviso || 'FINALIZADO, PASAR ALIQUO');
        const esDisconforme = fichaje.tratoCliente === 'MALO' || estadoDeseado.includes('DISCONFORME') || estadoDeseado.includes('JACOBO');

        // SEGURIDAD MÁXIMA: Si el cliente está disconforme, bloquear SIEMPRE el volcado automático a Aliquo
        if (esDisconforme) {
          av.estadoAviso = 'PASADO ALIQUO Y PENDIENTE REVISAR JACOBO';
          av.alertaDisconforme = true;
          av.motivoDisconformidad = fichaje.notas || 'Cliente disconforme con la intervención o importe';
        } else if (estadoDeseado === 'PASADO ALIQUO' || body.autoVolcarAliquo) {
          albaranGenerado = sincronizarAlbaranConAliquo(av, fichaje);
          av.estadoAviso = 'PASADO ALIQUO';
          av.aliquoDoc = albaranGenerado.idAlbaran;
          av.aliquoFecha = albaranGenerado.fechaGenerado;
        } else {
          av.estadoAviso = estadoDeseado;
        }
      }

      saveDb();
      return sendJson(res, 200, { ok: true, fichaje, aviso: av, albaran: albaranGenerado });
    }

    // 10. PROMOCIÓN 1-CLIC DE CONTRATOS DE MANTENIMIENTO (CM26/CM27 -> AVISOS ACTIVOS)
    if (pathname === '/api/contratos-cm' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
      const soloPendientes = parsedUrl.searchParams.get('pendientes') === '1';
      let list = db.contratosCm;
      if (soloPendientes) list = list.filter(c => !c.pasadoAAvisos);
      if (q) {
        list = list.filter(c =>
          (c.codigoCliente || '').toLowerCase().includes(q) ||
          (c.nombreCliente || '').toLowerCase().includes(q) ||
          (c.apellidosCliente || '').toLowerCase().includes(q) ||
          (c.direccionCompleta || '').toLowerCase().includes(q) ||
          (c.marca || '').toLowerCase().includes(q) ||
          (c.alcance || '').toLowerCase().includes(q)
        );
      }
      return sendJson(res, 200, { ok: true, total: list.length, contratos: list });
    }

    // PASO 3: GENERADOR DE REMESAS BANCARIAS SEPA XML (NORMA 19 / PAIN.008.001.02)
    if (pathname === '/api/contratos-cm/descargar-remesa-sepa' && req.method === 'GET') {
      const list = (db.contratosCm || []).filter(c => !c.pasadoAAvisos && !c.remesadoBanco);
      const validIbanRe = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
      const invalidContracts = [];
      for (const c of list) {
        const cleanIban = String(c.iban || '').replace(/\s+/g, '').toUpperCase();
        if (!cleanIban || !validIbanRe.test(cleanIban) || cleanIban === 'ES8200755814780601353513') {
          invalidContracts.push(`${c.codigoCliente || c.idContrato} (${(c.nombreCliente || '').trim()} ${(c.apellidosCliente || '').trim()})`.trim());
        }
      }
      if (list.length === 0) {
        return sendJson(res, 400, { ok: false, error: 'No hay contratos CM pendientes de remesar.' });
      }
      if (invalidContracts.length > 0) {
        return sendJson(res, 400, {
          ok: false,
          error: `Remesa bloqueada: ${invalidContracts.length} contrato(s) carecen de IBAN válido del cliente (nunca se usa IBAN por defecto). Revisa: ${invalidContracts.slice(0, 5).join(', ')}`
        });
      }

      const totalSuma = list.reduce((sum, c) => sum + (Number(c.cuotaAnual2026) || 175), 0);
      const fechaNow = new Date().toISOString().slice(0, 19);
      const fechaCobro = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const msgId = `BAZA-SEPA-CM26-${Date.now()}`;

      let xmlTxs = '';
      list.forEach((c, i) => {
        const cuota = (Number(c.cuotaAnual2026) || 175).toFixed(2);
        const cliNom = escapeHtmlServer(`${c.nombreCliente || ''} ${c.apellidosCliente || ''}`.trim().replace(/&/g, 'Y').slice(0, 65));
        const iban = escapeHtmlServer(String(c.iban || '').replace(/\s+/g, '').toUpperCase());
        const mandato = escapeHtmlServer(`MND-${c.codigoCliente || c.idContrato || ('REC' + i)}`);
        const endToEnd = escapeHtmlServer(`CM26-${c.idContrato || i}-${c.codigoCliente || 'CLI'}`);
        const refContrato = escapeHtmlServer(c.idContrato || '');

        xmlTxs += `
      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${endToEnd}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${cuota}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${mandato}</MndtId>
            <DtOfSgntr>2026-01-15</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId>
            <Othr>
              <Id>NOTPROVIDED</Id>
            </Othr>
          </FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${cliNom}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <IBAN>${iban}</IBAN>
          </Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>RENOVACION CUOTA ANUAL MANTENIMIENTO 2026 BAZA MAZANO - ${refContrato}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`;
      });

      const sepaXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${fechaNow}</CreDtTm>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${totalSuma.toFixed(2)}</CtrlSum>
      <InitgPty>
        <Nm>BAZA MAZANO S.L.</Nm>
        <Id>
          <OrgId>
            <Othr>
              <Id>ESB47312376</Id>
            </Othr>
          </OrgId>
        </Id>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>LOTE-CM2026-SANTANDER</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${totalSuma.toFixed(2)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>RCUR</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${fechaCobro}</ReqdColltnDt>
      <Cdtr>
        <Nm>BAZA MAZANO S.L.</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>ES8200755814780601353513</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <BIC>BSCHESMMXXX</BIC>
        </FinInstnId>
      </CdtrAgt>
      <CdtrSchmeId>
        <Id>
          <Spcfd>
            <Id>ES82000B47312376</Id>
          </Spcfd>
        </Id>
      </CdtrSchmeId>${xmlTxs}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;

      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="REMESA_SEPA_CM2026_BAZA_MAZANO.xml"',
        'Content-Length': Buffer.byteLength(sepaXml, 'utf8')
      });
      return res.end(sepaXml);
    }

    // PASO 3.1: CONFIRMAR REMESA Y ACTIVAR AVISOS DE FORMA MASIVA
    if (pathname === '/api/contratos-cm/confirmar-remesa' && req.method === 'POST') {
      const creados = [];
      const pendientes = db.contratosCm.filter(c => !c.pasadoAAvisos);

      for (const cm of pendientes) {
        const nuevoNumero = getNextAvisoNumero();
        const geo = inferGeo(cm.direccionCompleta, nuevoNumero);

        const nuevoAviso = {
          idAviso: crypto.randomBytes(4).toString('hex'),
          numero: nuevoNumero,
          fecha: nowMadridStr(),
          anota: 'REMESA SEPA BANCARIA',
          clienteExistente: true,
          codigoCliente: cm.codigoCliente || 'CLIENTE CM',
          nombreCliente: cm.nombreCliente,
          apellidosCliente: cm.apellidosCliente,
          direccionCompleta: cm.direccionCompleta,
          poblacion: cm.poblacion || geo.poblacionDetectada,
          lat: geo.lat,
          lng: geo.lng,
          kmIdaVuelta: cm.kmIdaVuelta || geo.kmIdaVuelta,
          telefono1: cm.telefono1,
          telefono2: cm.telefono2 || '',
          tipoAparato: cm.tipoAparato || 'PELLET AIRE',
          marca: cm.marca,
          modelo: cm.modelo,
          fechaInstalacion: '',
          relacion: 'INSTALADO',
          contratoMant: true,
          observaciones: `CONTRATO MANTENIMIENTO ANUAL ABONADO POR BANCO (${cm.alcance || '1L+1D'}). Limpieza y revisión oficial anual.`,
          tratoCliente: 'BUENO',
          horariosDisponibles: 'COORDINAR POR RUTA / ZONA',
          prioridad: 'MEDIA',
          tipoIntervencion: 'EJEC. CONT. MANT. CONTRATADO',
          estadoAviso: 'REALIZABLE',
          operarioPreasignado: 'JACOBO',
          notasFichajes: '',
          sumaImportes: 0
        };

        cm.pasadoAAvisos = true;
        cm.estadoAviso = 'REALIZABLE';
        cm.remesadoBanco = true;
        cm.avisoGeneradoNumero = nuevoNumero;
        db.avisos.unshift(nuevoAviso);
        creados.push(nuevoAviso);
      }

      saveDb();
      return sendJson(res, 200, { ok: true, activadosCount: creados.length, avisosCreados: creados });
    }

    if (pathname === '/api/contratos-cm/activar' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : (body.idContrato ? [body.idContrato] : []);
      const creados = [];

      for (const id of ids) {
        const cm = db.contratosCm.find(c => c.idContrato === id);
        if (!cm || cm.pasadoAAvisos) continue;

        const nuevoNumero = getNextAvisoNumero();
        const geo = inferGeo(cm.direccionCompleta, nuevoNumero);

        const nuevoAviso = {
          idAviso: crypto.randomBytes(4).toString('hex'),
          numero: nuevoNumero,
          fecha: nowMadridStr(),
          anota: String(body.anota || 'SILVIA'),
          clienteExistente: true,
          codigoCliente: cm.codigoCliente || 'CLIENTE CM',
          nombreCliente: cm.nombreCliente,
          apellidosCliente: cm.apellidosCliente,
          direccionCompleta: cm.direccionCompleta,
          poblacion: cm.poblacion || geo.poblacionDetectada,
          lat: geo.lat,
          lng: geo.lng,
          kmIdaVuelta: cm.kmIdaVuelta || geo.kmIdaVuelta,
          telefono1: cm.telefono1,
          telefono2: cm.telefono2 || '',
          tipoAparato: cm.tipoAparato || 'PELLET AIRE',
          marca: cm.marca,
          modelo: cm.modelo,
          fechaInstalacion: '',
          relacion: 'INSTALADO',
          contratoMant: true,
          observaciones: `CONTRATO MANTENIMIENTO ANUAL ABONADO (${cm.alcance || '1L+1D'}). Ejecutar limpieza y deshollinado incluido en contrato.`,
          tratoCliente: 'BUENO',
          horariosDisponibles: 'COORDINAR POR RUTA / ZONA',
          prioridad: 'MEDIA',
          tipoIntervencion: 'EJEC. CONT. MANT. CONTRATADO',
          estadoAviso: 'REALIZABLE',
          operarioPreasignado: 'JACOBO',
          notasFichajes: '',
          sumaImportes: 0
        };

        cm.pasadoAAvisos = true;
        cm.estadoAviso = 'REALIZABLE';
        cm.avisoGeneradoNumero = nuevoNumero;
        db.avisos.unshift(nuevoAviso);
        creados.push(nuevoAviso);
      }

      saveDb();
      return sendJson(res, 200, { ok: true, activadosCount: creados.length, avisosCreados: creados });
    }

    // 11. CONTROL DE FLOTA (8 VEHÍCULOS OFICIALES + TICKET CON FOTO)
    if (pathname === '/api/vehiculos' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const idGasto = crypto.randomBytes(4).toString('hex');
      const fotoTicket = persistMediaDataUrl(body.fotoTicket || '', 'flota', `${idGasto}_ticket`);
      const nuevoGasto = {
        idGasto,
        fecha: String(body.fecha || nowMadridStr().slice(0, 10)).slice(0, 10),
        operario: String(body.operario || authUser.nombre || 'OFICINA').trim().toUpperCase(),
        vehiculo: String(body.vehiculo || VEHICULOS_OFICIALES[0]),
        tipoGasto: String(body.tipoGasto || 'GASOIL').toUpperCase(),
        kms: Number(body.kms) || 0,
        importe: Number(body.importe) || 0,
        observaciones: String(body.observaciones || '').trim(),
        fotoTicket
      };
      db.gastosVehiculos.unshift(nuevoGasto);
      saveDb();
      return sendJson(res, 201, { ok: true, gasto: nuevoGasto });
    }

    // 12. ACTUALIZAR TARIFAS (2026 / 2027) O AÑADIR REPUESTO / MARCA
    if (pathname === '/api/tarifas' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (body.temporadaActiva) db.tarifas.temporadaActiva = body.temporadaActiva;
      if (body.tablas) db.tarifas.tablas = body.tablas;
      saveDb();
      return sendJson(res, 200, { ok: true, tarifas: db.tarifas });
    }

    if (pathname === '/api/repuestos' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const nuevoRep = {
        idArticulo: crypto.randomBytes(4).toString('hex'),
        codigo: String(body.codigo || `REP-${db.repuestos.length + 1}`).toUpperCase().trim(),
        descripcion: String(body.descripcion || '').toUpperCase().trim(),
        marca: String(body.marca || 'GENERAL').toUpperCase().trim(),
        precioNeto: Number(body.precioNeto) || 0,
        portes: Number(body.portes) || 0,
        pvp: Number(body.pvp) || 0,
        origen: 'MANUAL_SAT'
      };
      db.repuestos.unshift(nuevoRep);
      saveDb();
      return sendJson(res, 201, { ok: true, repuesto: nuevoRep });
    }

    if (pathname === '/api/marcas' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const idx = db.marcas.findIndex(m => m.marca.toUpperCase() === String(body.marca || '').toUpperCase().trim());
      const item = {
        marca: String(body.marca || '').toUpperCase().trim(),
        proveedor: String(body.proveedor || '').trim(),
        telefonoFabrica: String(body.telefonoFabrica || '').trim(),
        observaciones: String(body.observaciones || '').trim(),
        codigosReset: String(body.codigosReset || '').trim()
      };
      if (idx >= 0) db.marcas[idx] = item;
      else db.marcas.unshift(item);
      saveDb();
      return sendJson(res, 200, { ok: true, marca: item });
    }

    // 13. GENERADOR DE PARTE DE TRABAJO OFICIAL EN PDF / HTML IMPRIMIBLE
    if (pathname.startsWith('/api/parte-pdf/') && req.method === 'GET') {
      const id = pathname.split('/')[3];
      const matchingFichajes = db.fichajes.filter(
        f => f.idFichaje === id || f.idAviso === id || String(f.avisoNumero) === id
      );
      const fichaje =
        matchingFichajes.find(f => f.estadoFichaje === 'TERMINADO') ||
        matchingFichajes[0] ||
        null;
      const av = db.avisos.find(a =>
        (fichaje && a.idAviso === fichaje.idAviso) ||
        a.idAviso === id ||
        String(a.numero) === id
      );

      if (!av && !fichaje) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Parte de trabajo no encontrado');
      }

      const rawToken =
        parsedUrl.searchParams.get('token') ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const appendMediaToken = (src) => {
        if (!src || !rawToken || !String(src).startsWith('/media/')) return src;
        return `${src}?token=${encodeURIComponent(rawToken)}`;
      };
      const isDisplayableImg = (src) =>
        src && (String(src).startsWith('data:image') || String(src).startsWith('/media/'));

      const esc = escapeHtmlServer;
      const num = esc(av ? av.numero : (fichaje ? fichaje.avisoNumero : 'S/N'));
      const cliente = esc(av ? `${av.nombreCliente || ''} ${av.apellidosCliente || ''}`.trim() : (fichaje ? (fichaje.clienteNombre || '') : ''));
      const codCli = esc(av ? (av.codigoCliente || '') : '');
      const dir = esc(av ? (av.direccionCompleta || '') : (fichaje ? (fichaje.direccion || '') : ''));
      const tel = esc(av ? (av.telefono1 || '') : '');
      const aparato = esc(av ? `${av.tipoAparato || ''} · ${av.marca || ''} ${av.modelo || ''}` : '');
      const fecha = esc(fichaje ? (fichaje.fin || fichaje.inicio || '') : (av ? (av.fecha || '') : ''));
      const notas = esc(fichaje ? (fichaje.notas || '') : (av ? (av.notasFichajes || av.observaciones || '') : ''));
      const importe = fichaje ? Number(fichaje.importe || 0) : (av ? Number(av.sumaImportes || 0) : 0);
      const metodoPago = esc(fichaje ? (fichaje.metodoPago || 'PENDIENTE') : 'SEGÚN TARIFA');
      const repuestos = (fichaje && Array.isArray(fichaje.repuestosUsados)) ? fichaje.repuestosUsados : [];
      const firmaSrc = fichaje ? fichaje.firma : '';
      const firmaImg = isDisplayableImg(firmaSrc)
        ? `<img src="${esc(appendMediaToken(firmaSrc))}" style="max-height:95px;border-bottom:1px solid #1e293b;" />`
        : `<div style="height:75px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;border-bottom:1px dashed #94a3b8;">Conformidad registrada digitalmente (${esc(firmaSrc || 'SAT Baza Mazano')})</div>`;
      const fotoSrc = fichaje ? fichaje.fotoAdjuntar : '';
      const fotoHtml = isDisplayableImg(fotoSrc)
        ? `<div class="box" style="margin-bottom: 16px;"><h3>Evidencia Fotográfica del Equipo / Placa</h3><img src="${esc(appendMediaToken(fotoSrc))}" style="max-width:100%;max-height:280px;border-radius:6px;border:1px solid #cbd5e1;" /></div>`
        : '';

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Parte de Trabajo SAT #${num} - Baza Mazano S.L.</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 28px; background: #f8fafc; }
    .sheet { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #ea580c; padding-bottom: 16px; margin-bottom: 20px; }
    .brand h1 { margin: 0; font-size: 24px; color: #ea580c; letter-spacing: -0.5px; }
    .brand p { margin: 3px 0 0; font-size: 12px; color: #475569; }
    .badge-num { background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 8px; text-align: right; }
    .badge-num span { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; }
    .badge-num strong { font-size: 22px; color: #f97316; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
    .box h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .box p { margin: 4px 0; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 9px 12px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; color: #475569; }
    .total-bar { display: flex; justify-content: space-between; align-items: center; background: #fff7ed; border: 2px solid #fdba74; border-radius: 8px; padding: 14px 18px; margin-top: 16px; }
    .total-bar strong { font-size: 22px; color: #c2410c; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; text-align: center; font-size: 12px; color: #475569; }
    .no-print { text-align: right; max-width: 820px; margin: 0 auto 12px; }
    .btn-print { background: #ea580c; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border: none; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div class="brand">
        <h1>BAZA MAZANO S.L. — SERVICIO TÉCNICO OFICIAL (SAT)</h1>
        <p>CIF: B47312376 · C/ Annapurna 22, 47012 Valladolid · Tel: 983 333 222 · bazamazano@bazamazano.com</p>
      </div>
      <div class="badge-num">
        <span>Parte de Intervención</span>
        <strong>#${num}</strong>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Datos del Cliente (Aliquo ERP)</h3>
        <p><strong>Cliente:</strong> ${cliente} ${codCli ? `(${codCli})` : ''}</p>
        <p><strong>Dirección:</strong> ${dir}</p>
        <p><strong>Teléfono:</strong> ${tel}</p>
      </div>
      <div class="box">
        <h3>Equipo e Intervención</h3>
        <p><strong>Aparato / Marca / Modelo:</strong> ${aparato}</p>
        <p><strong>Tipo Intervención:</strong> ${esc(av ? av.tipoIntervencion : 'SAT')} ${av && av.contratoMant ? '· [CON CONTRATO MANTENIMIENTO]' : ''}</p>
        <p><strong>Fecha / Hora Cierre:</strong> ${fecha} · <strong>Duración:</strong> ${esc(fichaje ? fichaje.duracion : '00:45:00')}</p>
      </div>
    </div>

    <div class="box" style="margin-bottom: 16px;">
      <h3>Trabajos Realizados y Diagnóstico Técnico</h3>
      <p style="white-space: pre-wrap; line-height: 1.5;">${notas || 'Se realiza intervención técnica y comprobación de funcionamiento según protocolo oficial.'}</p>
    </div>

    ${fotoHtml}

    ${repuestos.length > 0 ? `
    <table>
      <thead>
        <tr><th>Código</th><th>Descripción Material / Repuesto</th><th>Cant.</th><th>PVP Unit.</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        ${repuestos.map(r => `
          <tr>
            <td><strong>${esc(r.codigo)}</strong></td>
            <td>${esc(r.descripcion)}</td>
            <td>${Number(r.cantidad || 1)}</td>
            <td>${Number(r.pvpUnitario || r.pvp || 0).toFixed(2)} €</td>
            <td><strong>${Number((r.cantidad || 1) * (r.pvpUnitario || r.pvp || 0)).toFixed(2)} €</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    <div class="total-bar">
      <div>
        <div style="font-size:12px;color:#9a3412;font-weight:700;text-transform:uppercase;">Método de Pago: ${metodoPago}</div>
        <div style="font-size:11px;color:#64748b;">Kilometraje calculado desde base C/ Annapurna 22 (${Number(fichaje ? fichaje.kmCalculados : (av ? av.kmIdaVuelta : 14))} km I/V · Franquicia 30 km incluidos en salida)</div>
      </div>
      <div>
        <span style="font-size:12px;color:#7c2d12;margin-right:8px;">IMPORTE TOTAL (IVA Incl.):</span>
        <strong>${importe.toFixed(2)} €</strong>
      </div>
    </div>

    <div class="signatures">
      <div>
        <div style="height:75px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #1e293b;font-weight:700;color:#0f172a;">
          Técnico SAT: ${esc(fichaje ? fichaje.operario : (av ? av.operarioPreasignado : 'Baza Mazano'))}
        </div>
        <p>Por BAZA MAZANO S.L.</p>
      </div>
      <div>
        ${firmaImg}
        <p>Conforme El Cliente (Firma digital en pantalla)</p>
      </div>
    </div>
  </div>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // =========================================================================
    // ARCHIVOS ESTÁTICOS (PWA FRONTEND)
    // =========================================================================
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(PUBLIC_DIR, reqPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback SPA a index.html
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexHtml).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    console.error('❌ Error en petición:', err);
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 SAT BAZA MAZANO 2.0 (2026/2027) escuchando en http://localhost:${PORT}`);
  console.log(`   - Consola de Mando SAT (Jacobo y Leandro)`);
  console.log(`   - App Móvil Técnicos con Geocerca >1 km (Alex, Jacobo, Dioni, Roberto, Ismael)`);
  console.log(`   - Panel Administración, Flota y Contratos CM (Silvia y Chus)`);
  console.log(`   - Directorio persistente: ${DATA_DIR}\n`);
});

function gracefulShutdown(signal) {
  console.log(`\n🛑 Señal ${signal} recibida: volcando base de datos a disco antes de cerrar...`);
  try {
    saveDb(true);
  } catch (err) {
    console.error('Error al volcar DB en cierre:', err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
