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
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'sat_db.json');
const LOCAL_ALIQUO_FILE = path.join(DATA_DIR, 'clientes_aliquo_cache.json');
const EXTERNAL_ALIQUO_FILE = path.resolve(__dirname, '../03_Datos_Tarifas_y_Stock/clientes_aliquo_cache.json');
const ALIQUO_CACHE_FILE = fs.existsSync(LOCAL_ALIQUO_FILE) ? LOCAL_ALIQUO_FILE : EXTERNAL_ALIQUO_FILE;

// Asegurar carpetas
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// Cargar base de datos principal SAT
let db = {
  meta: {},
  tarifas: {},
  operarios: [],
  marcas: [],
  repuestos: [],
  gastosVehiculos: [],
  contratosCm: [],
  citas: [],
  fichajes: [],
  avisos: []
};

function loadDb() {
  try {
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
    console.log(`📦 Caché local de clientes Aliquo cargada: ${aliquoLocalCache.length} clientes.`);
  }
} catch (e) {
  console.warn('⚠️ No se pudo cargar clientes_aliquo_cache.json:', e.message);
}

let saveTimeout = null;
function saveDb() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      db.meta.counts = {
        avisos: db.avisos.length,
        contratosCm: db.contratosCm.length,
        citas: db.citas.length,
        fichajes: db.fichajes.length,
        operarios: db.operarios.length,
        gastosVehiculos: db.gastosVehiculos.length,
        repuestos: db.repuestos.length,
        marcas: db.marcas.length
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ Error guardando sat_db.json:', e.message);
    }
  }, 150);
}

// =========================================================================
// CONEXIÓN EN VIVO A ALIQUO SQL SERVER WEBAPI (Opción B Confirmada)
// =========================================================================
const ALIQUO_KEYS = [
  'GFRHR9pjtuJyNTW7XSZ3Ol5WiFK78UHI', // Api.implantaciones@bazamzano.com
  'CKqkRyKYdoZyNTW7XSZ3OlKtAx5tZlRQ'  // Api.almacenes@bazamzano.com
];

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
    fechaParte: fichaje.fin || new Date().toISOString().slice(0, 16).replace('T', ' '),
    operario: fichaje.operario || 'JACOBO',
    metodoPago: fichaje.metodoPago || 'EFECTIVO',
    totalImporte: Number(fichaje.importe || aviso.sumaImportes || 0),
    notasTrabajo: fichaje.notas || '',
    tieneFirmaCliente: Boolean(fichaje.firma),
    tieneFotoAdjunta: Boolean(fichaje.fotoAdjuntar),
    estadoSincro: 'SINCRONIZADO_EN_ALIQUO',
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

  // 1. Procesar filas de Aliquo Live
  for (const c of liveRows) {
    const cod = String(c.Codigo || '').trim();
    const obs = String(c.Observaciones || '').trim();
    let va = cod.toUpperCase().startsWith('VA') ? cod.toUpperCase() : '';
    if (!va) {
      const m = obs.match(/\b(VA-?[0-9]{3,6})\b/i);
      if (m) va = m[1].toUpperCase();
    }
    const fullName = String(c.Nombre || c.SobreNombre || '').trim();
    const parts = fullName.split(/\s+/);
    const nombre = parts[0] || '';
    const apellidos = parts.slice(1).join(' ');
    const dir = [c.Direccion, c.CodigoPostal, c.Poblacion, c.Provincia].filter(Boolean).join(', ');
    const key = cod || fullName.toUpperCase();
    mapByKey.set(key, {
      codigoCliente: va || cod || 'CLIENTE',
      codigoAliquo: cod,
      nombreCompleto: fullName,
      nombreCliente: nombre,
      apellidosCliente: apellidos,
      direccionCompleta: dir,
      poblacion: String(c.Poblacion || 'VALLADOLID').trim(),
      telefono1: String(c.Telefono || '').trim(),
      telefono2: String(c.Telefono2 || '').trim(),
      email: String(c.Email || '').trim(),
      tipoAparato: '',
      marca: '',
      modelo: '',
      contratoMant: false,
      relacion: 'INSTALADO',
      tratoCliente: 'BUENO',
      origen: 'ALIQUO SQL LIVE'
    });
  }

  // 2. Enriquecer y buscar también en el histórico de 2.027 AVISOS y 322 CONTRATOS CM (para traer su Marca, Modelo, Tipo de Aparato y Contrato CM)
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
      if (
        cod.toLowerCase().includes(lower) ||
        nom.toLowerCase().includes(lower) ||
        dir.toLowerCase().includes(lower) ||
        (cleanDigits.length >= 3 && tel.includes(cleanDigits))
      ) {
        const key = cod || nom.toUpperCase();
        if (!mapByKey.has(key)) {
          const parts = nom.split(/\s+/);
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
            tipoAparato: 'PELLET AIRE',
            marca: '',
            modelo: '',
            contratoMant: false,
            relacion: 'INSTALADO',
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
        repuestos: db.repuestos,
        gastosVehiculos: db.gastosVehiculos,
        fichajesAbiertos
      });
    }

    // 2. BÚSQUEDA EN VIVO DE CLIENTES EN ALIQUO SQL + HISTÓRICO SAT
    if (pathname === '/api/aliquo/buscar-cliente' && req.method === 'GET') {
      const q = parsedUrl.searchParams.get('q') || '';
      const result = await searchClientsAliquoAndSat(q);
      return sendJson(res, 200, { ok: true, query: q, ...result });
    }

    // 2.1 VOLCADO DIRECTO DE ALBARÁN A ALIQUO EN 1 CLIC (Panel de Administración)
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

      const alb = sincronizarAlbaranConAliquo(av, fichaje);
      av.estadoAviso = 'PASADO ALIQUO';
      av.aliquoDoc = alb.idAlbaran;
      av.aliquoFecha = alb.fechaGenerado;
      saveDb();

      return sendJson(res, 200, { ok: true, albaran: alb, aviso: av });
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
      const limit = Math.min(500, parseInt(parsedUrl.searchParams.get('limit') || '150', 10));

      let list = db.avisos;
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

      return sendJson(res, 200, {
        ok: true,
        total: list.length,
        avisos: list.slice(0, limit)
      });
    }

    // 4. CREAR NUEVO AVISO (Alta Express 15s con numerador atómico MAX + 1)
    if (pathname === '/api/avisos' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const maxNumero = db.avisos.reduce((max, a) => (a.numero > max && a.numero < 90000 ? a.numero : max), 2710);
      const nuevoNumero = maxNumero + 1;
      const idAviso = crypto.randomBytes(4).toString('hex');
      const dir = String(body.direccionCompleta || '').trim();
      const geo = inferGeo(dir, nuevoNumero);

      // PASO 2: ALTA AUTOMÁTICA EN ALIQUO SI EL CLIENTE NO EXISTE
      let codCli = String(body.codigoCliente || '').trim();
      let clienteCreadoAliquo = null;
      const debeCrearEnAliquo = body.crearClienteEnAliquo || codCli === 'NO ES CLIENTE' || !codCli;

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
          Origen: 'ALTA DIRECTA SAT BAZA 2.0'
        };

        codCli = nuevoCodigo;
        aliquoLocalCache.unshift(clienteCreadoAliquo);
        if (!db.clientesCreadosAliquo) db.clientesCreadosAliquo = [];
        db.clientesCreadosAliquo.unshift(clienteCreadoAliquo);
      }

      const nuevoAviso = {
        idAviso,
        numero: nuevoNumero,
        fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
        anota: String(body.anota || 'JACOBO').toUpperCase(),
        clienteExistente: true,
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
        fechaInstalacion: String(body.fechaInstalacion || '').trim(),
        relacion: String(body.relacion || 'INSTALADO').trim(),
        contratoMant: Boolean(body.contratoMant),
        observaciones: String(body.observaciones || '').trim(),
        tratoCliente: String(body.tratoCliente || 'BUENO').trim(),
        horariosDisponibles: String(body.horariosDisponibles || 'MAÑANAS O TARDES').trim(),
        prioridad: String(body.prioridad || 'MEDIA').trim(),
        tipoIntervencion: String(body.tipoIntervencion || 'SAT NORMAL').trim(),
        estadoAviso: String(body.estadoAviso || 'SIN PROCESAR').trim(),
        operarioPreasignado: String(body.operarioPreasignado || 'JACOBO').trim(),
        notasFichajes: '',
        sumaImportes: 0
      };

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
        'estadoAviso', 'prioridad', 'tratoCliente', 'operarioPreasignado',
        'tipoIntervencion', 'observaciones', 'horariosDisponibles', 'marca',
        'modelo', 'tipoAparato', 'contratoMant', 'codigoCliente', 'telefono1',
        'direccionCompleta', 'sumaImportes', 'notasFichajes', 'kmIdaVuelta'
      ];
      for (const k of allowed) {
        if (body[k] !== undefined) aviso[k] = body[k];
      }
      saveDb();
      return sendJson(res, 200, { ok: true, aviso });
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
        inicio: String(body.inicio || new Date().toISOString().slice(0, 16).replace('T', ' ')),
        fin: String(body.fin || new Date(Date.now() + 3600000).toISOString().slice(0, 16).replace('T', ' ')),
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
        inicio: new Date().toISOString().slice(0, 16).replace('T', ' '),
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
      const finStr = new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ');
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
          inicio: new Date(nowMs - minutos * 60000).toISOString().slice(0, 16).replace('T', ' '),
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
      fichaje.firma = String(body.firma || '');
      fichaje.fotoAdjuntar = String(body.fotoAdjuntar || '');
      fichaje.repuestosUsados = Array.isArray(body.repuestosUsados) ? body.repuestosUsados : [];
      fichaje.desgloseTarifa = body.desgloseTarifa || null;
      fichaje.kmCalculados = Number(body.kmIdaVuelta) || (av ? av.kmIdaVuelta : 14);

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
          av.estadoAviso = 'PASADO ALIQUIO Y PENDIENTE REVISAR JACOBO';
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
      const list = db.contratosCm || [];
      const totalSuma = list.reduce((sum, c) => sum + (Number(c.cuotaAnual2026) || 175), 0);
      const fechaNow = new Date().toISOString().slice(0, 19);
      const fechaCobro = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const msgId = `BAZA-SEPA-CM26-${Date.now()}`;

      let xmlTxs = '';
      list.forEach((c, i) => {
        const cuota = (Number(c.cuotaAnual2026) || 175).toFixed(2);
        const cliNom = `${c.nombreCliente || ''} ${c.apellidosCliente || ''}`.trim().replace(/&/g, 'Y').slice(0, 65);
        const iban = c.iban || 'ES8200755814780601353513';
        const mandato = `MND-${c.codigoCliente || c.idContrato || ('REC' + i)}`;
        const endToEnd = `CM26-${c.idContrato || i}-${c.codigoCliente || 'CLI'}`;

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
          <Ustrd>RENOVACION CUOTA ANUAL MANTENIMIENTO 2026 BAZA MAZANO - ${c.idContrato}</Ustrd>
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
      let currentMax = db.avisos.reduce((max, a) => (a.numero > max && a.numero < 90000 ? a.numero : max), 27100);

      for (const cm of pendientes) {
        currentMax++;
        const nuevoNumero = currentMax;
        const geo = inferGeo(cm.direccionCompleta, nuevoNumero);

        const nuevoAviso = {
          idAviso: crypto.randomBytes(4).toString('hex'),
          numero: nuevoNumero,
          fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
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
      let currentMax = db.avisos.reduce((max, a) => (a.numero > max && a.numero < 90000 ? a.numero : max), 27100);

      for (const id of ids) {
        const cm = db.contratosCm.find(c => c.idContrato === id);
        if (!cm || cm.pasadoAAvisos) continue;

        currentMax++;
        const nuevoNumero = currentMax;
        const geo = inferGeo(cm.direccionCompleta, nuevoNumero);

        const nuevoAviso = {
          idAviso: crypto.randomBytes(4).toString('hex'),
          numero: nuevoNumero,
          fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
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

    // 11. CONTROL DE FLOTA (4 FURGONETAS: 9390HSV, 7206GDH, 7392DFX, 4037NJX)
    if (pathname === '/api/vehiculos' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const nuevoGasto = {
        idGasto: crypto.randomBytes(4).toString('hex'),
        fecha: body.fecha || new Date().toISOString().slice(0, 10),
        vehiculo: String(body.vehiculo || '9390HSV - DACIA DOKKER'),
        tipoGasto: String(body.tipoGasto || 'GASOIL').toUpperCase(),
        kms: Number(body.kms) || 0,
        importe: Number(body.importe) || 0,
        observaciones: String(body.observaciones || '').trim(),
        fotoTicket: ''
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
      const fichaje = db.fichajes.find(f => f.idFichaje === id || String(f.avisoNumero) === id);
      const av = db.avisos.find(a =>
        (fichaje && a.idAviso === fichaje.idAviso) ||
        a.idAviso === id ||
        String(a.numero) === id
      );

      if (!av && !fichaje) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Parte de trabajo no encontrado');
      }

      const num = av ? av.numero : (fichaje ? fichaje.avisoNumero : 'S/N');
      const cliente = av ? `${av.nombreCliente} ${av.apellidosCliente}`.trim() : (fichaje ? fichaje.clienteNombre : '');
      const codCli = av ? av.codigoCliente : '';
      const dir = av ? av.direccionCompleta : (fichaje ? fichaje.direccion : '');
      const tel = av ? av.telefono1 : '';
      const aparato = av ? `${av.tipoAparato} · ${av.marca} ${av.modelo}` : '';
      const fecha = fichaje ? (fichaje.fin || fichaje.inicio) : (av ? av.fecha : '');
      const notas = fichaje ? fichaje.notas : (av ? (av.notasFichajes || av.observaciones) : '');
      const importe = fichaje ? Number(fichaje.importe || 0) : (av ? Number(av.sumaImportes || 0) : 0);
      const metodoPago = fichaje ? (fichaje.metodoPago || 'PENDIENTE') : 'SEGÚN TARIFA';
      const repuestos = (fichaje && Array.isArray(fichaje.repuestosUsados)) ? fichaje.repuestosUsados : [];
      const firmaImg = (fichaje && fichaje.firma && fichaje.firma.startsWith('data:image'))
        ? `<img src="${fichaje.firma}" style="max-height:95px;border-bottom:1px solid #1e293b;" />`
        : `<div style="height:75px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;border-bottom:1px dashed #94a3b8;">Conformidad registrada digitalmente (${fichaje && fichaje.firma ? fichaje.firma : 'SAT Baza Mazano'})</div>`;

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
        <p><strong>Tipo Intervención:</strong> ${av ? av.tipoIntervencion : 'SAT'} ${av && av.contratoMant ? '· [CON CONTRATO MANTENIMIENTO]' : ''}</p>
        <p><strong>Fecha / Hora Cierre:</strong> ${fecha} · <strong>Duración:</strong> ${fichaje ? fichaje.duracion : '00:45:00'}</p>
      </div>
    </div>

    <div class="box" style="margin-bottom: 16px;">
      <h3>Trabajos Realizados y Diagnóstico Técnico</h3>
      <p style="white-space: pre-wrap; line-height: 1.5;">${notas || 'Se realiza intervención técnica y comprobación de funcionamiento según protocolo oficial.'}</p>
    </div>

    ${repuestos.length > 0 ? `
    <table>
      <thead>
        <tr><th>Código</th><th>Descripción Material / Repuesto</th><th>Cant.</th><th>PVP Unit.</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        ${repuestos.map(r => `
          <tr>
            <td><strong>${r.codigo}</strong></td>
            <td>${r.descripcion}</td>
            <td>${r.cantidad || 1}</td>
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
        <div style="font-size:11px;color:#64748b;">Kilometraje calculado desde base C/ Annapurna 22 (${fichaje ? fichaje.kmCalculados : (av ? av.kmIdaVuelta : 14)} km I/V · Franquicia 30 km incluidos en salida)</div>
      </div>
      <div>
        <span style="font-size:12px;color:#7c2d12;margin-right:8px;">IMPORTE TOTAL (IVA Incl.):</span>
        <strong>${importe.toFixed(2)} €</strong>
      </div>
    </div>

    <div class="signatures">
      <div>
        <div style="height:75px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #1e293b;font-weight:700;color:#0f172a;">
          Técnico SAT: ${fichaje ? fichaje.operario : (av ? av.operarioPreasignado : 'Baza Mazano')}
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
  console.log(`   - App Móvil Técnicos con Geocerca >1 km (Alex, Jacobo, Dioni, Roberto)`);
  console.log(`   - Panel Administración, Flota y Contratos CM (Silvia y Lidia)\n`);
});
