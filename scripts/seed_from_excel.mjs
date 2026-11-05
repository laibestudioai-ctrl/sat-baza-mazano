import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const excelPath = process.argv[2] || 'C:/Users/NuevoNatal/Downloads/AVISOS (2).xlsx';
const outDir = 'c:/Users/NuevoNatal/Documents/antigravity/Baza_Mazano/sat_baza_2026/data';
fs.mkdirSync(outDir, { recursive: true });

console.log('Reading workbook:', excelPath);
const wb = xlsx.readFile(excelPath, { cellDates: true });
console.log('Sheets found:', wb.SheetNames);

function sheetToRows(sheetName) {
  const ws = wb.Sheets[sheetName] ||
             wb.Sheets[sheetName.replace(/^Copia de /, '')] ||
             wb.Sheets['Copia de ' + sheetName];
  if (!ws) return [];
  return xlsx.utils.sheet_to_json(ws, { defval: '' });
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

function inferGeo(addressStr, idNum = 1) {
  const norm = String(addressStr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  let matched = null;

  // 1. Prioridad: Buscar en municipios y urbanizaciones de fuera
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

  // 2. Si no es de ningún pueblo de fuera, comprobar Valladolid capital
  if (!matched) {
    matched = VALLADOLID_CAPITAL;
  }

  // Dispersión sutil basada en idNum para que las chinchetas de un mismo pueblo no se solapen exactamente
  const seed = Number(idNum) || 1;
  const dLat = ((seed * 9301 + 49297) % 233280) / 233280 * 0.012 - 0.006;
  const dLng = ((seed * 49297 + 9301) % 233280) / 233280 * 0.016 - 0.008;

  return {
    lat: Number((matched.lat + dLat).toFixed(5)),
    lng: Number((matched.lng + dLng).toFixed(5)),
    kmIdaVuelta: matched.km,
    poblacionDetectada: matched.name
  };
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString();
  }
  return String(val).trim();
}

// 1. AVISOS (Sheet: "Copia de AVISOS")
const rawAvisos = sheetToRows('Copia de AVISOS');
const avisos = [];
for (const r of rawAvisos) {
  const idAviso = String(r['ID AVISO'] || '').trim();
  const numAviso = Number(r['AVISO']) || 0;
  if (!idAviso && !numAviso) continue;
  const dir = String(r['DIRECCIÓN COMPLETA'] || '').trim();
  const geo = inferGeo(dir, numAviso);
  const rawEstado = String(r['ESTADO AVISO'] || 'SIN PROCESAR').trim().toUpperCase();
  const normEstado = rawEstado === 'NO PROCESADO' ? 'SIN PROCESAR' : rawEstado;
  const rawOp = String(r['OPERARIO PREASIGNADO'] || 'JACOBO').trim();
  const normOp = rawOp.includes('NINGUNO') ? 'JACOBO' : rawOp.replace(/^[0-9]+-/, '');
  const codCli = String(r['CÓDIGO CLIENTE'] || r['C.CLIENTE'] || '').trim();
  avisos.push({
    idAviso: idAviso || `AV-${numAviso}`,
    numero: numAviso,
    fecha: fmtDate(r['FECHA AVISO'] || r['FECHA']),
    anota: String(r['ANOTA'] || 'JACOBO').trim(),
    clienteExistente: r['CLIENTE YA EXISTENTE'] === 1 || r['CLIENTE YA EXISTENTE'] === '1' || r['CLIENTE YA EXISTENTE'] === 'SI' || Boolean(codCli && codCli !== 'NO ES CLIENTE'),
    codigoCliente: codCli || 'NO ES CLIENTE',
    nombreCliente: String(r['NOMBRE CLIENTE'] || '').trim(),
    apellidosCliente: String(r['APELLIDOS CLIENTE'] || '').trim(),
    direccionCompleta: dir,
    poblacion: geo.poblacionDetectada,
    lat: geo.lat,
    lng: geo.lng,
    kmIdaVuelta: geo.kmIdaVuelta,
    telefono1: String(r['TELÉFONO1'] || '').trim(),
    telefono2: String(r['TELÉFONO2'] || r['TELEFONO2'] || '').trim(),
    tipoAparato: String(r['TIPO APARATO'] || 'PELLET AIRE').trim(),
    marca: String(r['MARCA'] || '').trim(),
    modelo: String(r['MODELO'] || '').trim(),
    fechaInstalacion: fmtDate(r['FECHA INSTALACIÓN/VENTA'] || r['FECHA INSTALACIÓN']),
    docCompra: String(r['DOC COMPRA'] || '').trim(),
    relacion: String(r['RELACIÓN'] || 'INSTALADO').trim(),
    contratoMant: r['CONTRATO MANT.'] === 1 || r['CONTRATO MANT.'] === '1' || r['CONTRATO MANT.'] === 'SI' || r['CONTRATO MANT.'] === true,
    observaciones: String(r['OBSERVACIONES AVISO'] || '').trim(),
    tratoCliente: String(r['TRATO CLIENTE EN AVISO'] || 'BUENO').trim(),
    horariosDisponibles: String(r['HORARIOS DISPONIBLES'] || '').trim(),
    prioridad: String(r['PRIORIDAD AVISO'] || 'MEDIA').trim(),
    tipoIntervencion: String(r['TIPO INTERVENCIÓN'] || 'SAT NORMAL').trim(),
    estadoAviso: normEstado,
    operarioPreasignado: normOp,
    notasFichajes: String(r['NOTAS GENERADAS FICHAJES'] || '').trim(),
    sumaImportes: Number(r['SUMA IMPORTES AVISO']) || 0
  });
}

// Sort avisos descending by numero so newest are first
avisos.sort((a, b) => b.numero - a.numero);

// 2. TRANSITO CM26 A AVISOS
const rawTransito = sheetToRows('Copia de TRANSITO CM26 A AVISOS');
const contratosCm = [];
for (const r of rawTransito) {
  const idCm = String(r['ID AVISO'] || '').trim();
  const nombre = String(r['NOMBRE CLIENTE'] || '').trim();
  const dir = String(r['DIRECCIÓN COMPLETA'] || '').trim();
  if (!nombre && !dir) continue;
  const numSlot = Number(r['AVISO']) || 0;
  const geo = inferGeo(dir, numSlot);
  const tipoAparato = String(r['TIPO APARATO'] || 'PELLET AIRE').trim();
  const esAgua = tipoAparato.includes('AGUA');
  const obs = String(r['OBSERVACIONES AVISO'] || '1L+1D').trim();
  contratosCm.push({
    idContrato: idCm,
    numeroSlot: numSlot,
    fecha: fmtDate(r['FECHA AVISO'] || r['FECHA']),
    codigoCliente: String(r['CÓDIGO CLIENTE'] || r['C.CLIENTE'] || '').trim(),
    nombreCliente: nombre,
    apellidosCliente: String(r['APELLIDOS CLIENTE'] || '').trim(),
    direccionCompleta: dir,
    poblacion: geo.poblacionDetectada,
    kmIdaVuelta: geo.kmIdaVuelta,
    telefono1: String(r['TELÉFONO1'] || '').trim(),
    telefono2: String(r['TELEFONO2'] || '').trim(),
    tipoAparato,
    marca: String(r['MARCA'] || '').trim(),
    modelo: String(r['MODELO'] || '').trim(),
    alcance: obs || '1L+1D',
    estadoAviso: String(r['ESTADO AVISO'] || 'PENDIENTE ACTIVAR').trim(),
    cuotaAnual2026: esAgua ? 210 : 175,
    cuotaAnual2027: esAgua ? 210 : 175,
    pasadoAAvisos: String(r['ESTADO AVISO'] || '').trim() === 'REALIZABLE'
  });
}

// 3. CITAS (Sheet: "Copia de CITAS")
const rawCitas = sheetToRows('Copia de CITAS');
const citas = [];
for (const r of rawCitas) {
  const idCita = String(r['ID CITA'] || '').trim();
  if (!idCita) continue;
  citas.push({
    idCita,
    idAviso: String(r['ID AVISO'] || '').trim(),
    avisoNumero: Number(r['AVISO']) || 0,
    titulo: String(r['TÍTULO'] || '').trim(),
    inicio: fmtDate(r['INICIO']),
    fin: fmtDate(r['FIN']),
    creadoPor: String(r['CREADO POR'] || '').trim(),
    direccion: String(r['DIRECCIÓN'] || '').trim(),
    asistentes: String(r['ASISTENTES'] || '').trim(),
    descripcion: String(r['DESCRIPCIÓN'] || '').trim(),
    enCalendario: r['EN CALENDARIO'] === 1 || r['EN CALENDARIO'] === '1' || r['EN CALENDARIO'] === 'SI',
    whatsappConfirmado: false
  });
}
citas.sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));

// 4. FICHAJES (Sheet: "Copia de FICHAJES")
const rawFichajes = sheetToRows('Copia de FICHAJES');
const fichajes = [];
for (const r of rawFichajes) {
  const idFichaje = String(r['ID FICHAJE'] || '').trim();
  if (!idFichaje) continue;
  fichajes.push({
    idFichaje,
    idAviso: String(r['ID AVISO'] || '').trim(),
    avisoNumero: Number(r['AVISO NÚMERO']) || 0,
    operario: String(r['OPERARIO'] || '').trim(),
    inicio: fmtDate(r['FICHAJE INICIO']),
    fin: fmtDate(r['FICHAJE FIN']),
    ubicacionInicio: String(r['UBICACION INICIO'] || '').trim(),
    ubicacionFin: String(r['UBICACION FIN'] || '').trim(),
    duracion: String(r['DURACIÓN'] || '').trim(),
    importe: Number(r['IMPORTE']) || 0,
    metodoPago: String(r['MÉTODO DE PAGO'] || '').trim(),
    notas: String(r['NOTAS GENERADAS INTERVENCION'] || '').trim(),
    tratoCliente: String(r['TRATO CLIENTE EN AVISO'] || 'BUENO').trim(),
    estadoFichaje: String(r['ESTADO FICHAJE'] || 'TERMINADO').trim(),
    firma: String(r['FIRMA'] || '').trim(),
    fotoAdjuntar: String(r['FOTO ADJUNTAR'] || '').trim(),
    repuestosUsados: [],
    kmCalculados: 0
  });
}
fichajes.sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));

// 5. OPERARIOS (Sheet: "Copia de OPERARIOS")
const rawOperarios = sheetToRows('Copia de OPERARIOS');
const operarios = rawOperarios.filter(r => r['EMAIL']).map(r => ({
  idOperario: String(r['ID OPERARIO'] || '').trim(),
  email: String(r['EMAIL'] || '').trim(),
  nombre: String(r['NOMBRE'] || '').trim(),
  tipo: String(r['TIPO'] || 'TOTAL').trim(),
  color: String(r['COLOR'] || 'BLUE').trim()
}));

// 6. GASTOS VEHÍCULOS (Sheet: "Copia de GASTOS VEHÍCULOS")
const rawVehiculos = sheetToRows('Copia de GASTOS VEHÍCULOS');
const gastosVehiculos = rawVehiculos.filter(r => r['ID GASTOSVE'] || r['ID GASTO'] || r['VEHÍCULO']).map((r, idx) => ({
  idGasto: String(r['ID GASTOSVE'] || r['ID GASTO'] || `GV-${idx + 1}`).trim(),
  fecha: fmtDate(r['FECHA']),
  vehiculo: String(r['VEHÍCULO'] || '').trim(),
  tipoGasto: String(r['CONCEPTO'] || r['TIPO GASTO'] || 'GASOIL').trim(),
  kms: Number(r['KMS']) || 0,
  importe: Number(r['IMPORTE']) || 0,
  observaciones: String(r['OBSERVACIONES'] || '').trim(),
  fotoTicket: String(r['FOTO TICKET'] || '').trim()
}));

// 7. TARIFA REPUESTOS (Sheet: "Copia de TARIFA REPUESTOS" + Catalogo Aliquo)
const rawRepuestos = sheetToRows('Copia de TARIFA REPUESTOS');
const repuestos = [];
const seenCod = new Set();
for (const r of rawRepuestos) {
  const idArt = String(r['ID ARTÍCULO'] || '').trim();
  const cod = String(r['CÓDIGO INTERNO ARTÍCULO'] || r['CÓDIGO'] || idArt || '').trim();
  const desc = String(r['DESCRIPCIÓN'] || r['REPUESTO'] || '').trim();
  if (!desc && !cod) continue;
  const pvp = Number(r['PVP CLIENTE'] || r['PVP'] || 0) || 0;
  const neto = Number(r['PRECIO NETO'] || 0) || 0;
  const portes = Number(r['PORTES'] || 0) || 0;
  const marca = String(r['PROVEEDOR'] || r['MARCA'] || '').trim();
  seenCod.add(cod);
  repuestos.push({
    idArticulo: idArt || cod,
    codigo: cod || `REP-${repuestos.length + 1}`,
    descripcion: desc,
    marca,
    precioNeto: Number(neto.toFixed(2)),
    portes: Number(portes.toFixed(2)),
    pvp: Number((pvp || (neto + portes) * 1.4).toFixed(2)),
    origen: 'TARIFA_REPUESTOS_SAT'
  });
}

// Add common SAT spare parts from catalogo_aliquo_filtrado.json if available
const catPath = 'c:/Users/NuevoNatal/Documents/antigravity/Baza_Mazano/03_Datos_Tarifas_y_Stock/catalogo_aliquo_filtrado.json';
if (fs.existsSync(catPath)) {
  try {
    const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
    const items = [...(cat.tubos || []), ...(cat.repuestos || []), ...(cat.accesorios || [])];
    for (const item of items.slice(0, 120)) {
      const cod = String(item.artCode || '').trim();
      const desc = String(item.name || '').trim();
      if (!cod || !desc || seenCod.has(cod) || !(Number(item.pvp) > 0)) continue;
      seenCod.add(cod);
      repuestos.push({
        idArticulo: cod,
        codigo: cod,
        descripcion: desc,
        marca: String(item.techCode || item.prov || 'ALIQUO').trim(),
        precioNeto: Number((Number(item.pvp) * 0.6).toFixed(2)),
        portes: 0,
        pvp: Number(Number(item.pvp).toFixed(2)),
        origen: 'ALIQUO_SQL'
      });
    }
  } catch (e) {
    console.warn('Could not load catalogo_aliquo_filtrado.json:', e.message);
  }
}

// 8. MARCAS (Sheet: "Copia de MARCAS")
const rawMarcas = sheetToRows('Copia de MARCAS');
const marcas = [];
for (const r of rawMarcas) {
  const nombreMarca = String(r['MARCAS'] || '').trim();
  if (!nombreMarca) continue;
  const tlfRaw = r['TLF '] || r['TLF'] || '';
  const tlf = typeof tlfRaw === 'number' && tlfRaw > 1000 ? String(Math.round(tlfRaw)) : String(tlfRaw || '').trim();
  marcas.push({
    marca: nombreMarca,
    proveedor: String(r['PROVEEDOR'] || '').trim(),
    telefonoFabrica: tlf === '-1' || tlf === '0' || tlf === '1' ? '' : tlf,
    observaciones: String(r['OBSERVACIONES'] || '').trim(),
    codigosReset: String(r['CONTRASEÑAS'] || '').trim()
  });
}

// 9. TARIFAS OFICIALES (2026 & 2027)
const tarifas = {
  temporadaActiva: '2026-2027',
  franquiciaKmIdaVuelta: 30,
  direccionBase: 'C/ Annapurna 22, 47012 Valladolid',
  descuentoContratoMantPct: 20,
  tablas: {
    '2026': {
      nombre: 'Tarifa Oficial 2026 (Copia de TARIFAS vigente)',
      salidaBase: 35.0,
      precioKmExtra: 1.20,
      horaManoObraCliente: 60.0,
      horaManoObraNoCliente: 70.0,
      minimoMediaHoraCliente: 62.50,
      minimoMediaHoraNoCliente: 67.50,
      servicios: {
        'CONTRATO MANTENIMIENTO': { aireCliente: 175, aireNoCliente: 220, aguaCliente: 210, aguaNoCliente: 270 },
        'EJEC. CONT. MANT. CONTRATADO': { aireCliente: 0, aireNoCliente: 0, aguaCliente: 0, aguaNoCliente: 0 },
        'LIMPIEZA + DESHOLLINADO': { aireCliente: 240, aireNoCliente: 270, aguaCliente: 265, aguaNoCliente: 290 },
        'DESHOLLINADO + LIMPIEZA': { aireCliente: 240, aireNoCliente: 270, aguaCliente: 265, aguaNoCliente: 290 },
        'DESHOLLINADO': { aireCliente: 185, aireNoCliente: 210, aguaCliente: 195, aguaNoCliente: 230 },
        'LIMPIEZA': { aireCliente: 140, aireNoCliente: 170, aguaCliente: 160, aguaNoCliente: 180 },
        'PUESTA EN MARCHA': { aireCliente: 100, aireNoCliente: 100, aguaCliente: 120, aguaNoCliente: 120 },
        'VISITA TÉCNICA': { aireCliente: 120, aireNoCliente: 120, aguaCliente: 120, aguaNoCliente: 120 },
        'RECLAMACIÓN GARANTÍA': { aireCliente: 0, aireNoCliente: 0, aguaCliente: 0, aguaNoCliente: 0 }
      }
    },
    '2027': {
      nombre: 'Tarifa Oficial 2027 (Contratos y Servicios 2027)',
      salidaBase: 35.0,
      precioKmExtra: 1.20,
      horaManoObraCliente: 60.0,
      horaManoObraNoCliente: 70.0,
      minimoMediaHoraCliente: 65.00,
      minimoMediaHoraNoCliente: 70.00,
      servicios: {
        'CONTRATO MANTENIMIENTO': { aireCliente: 175, aireNoCliente: 220, aguaCliente: 210, aguaNoCliente: 270 },
        'EJEC. CONT. MANT. CONTRATADO': { aireCliente: 0, aireNoCliente: 0, aguaCliente: 0, aguaNoCliente: 0 },
        'LIMPIEZA + DESHOLLINADO': { aireCliente: 240, aireNoCliente: 270, aguaCliente: 265, aguaNoCliente: 290 },
        'DESHOLLINADO + LIMPIEZA': { aireCliente: 240, aireNoCliente: 270, aguaCliente: 265, aguaNoCliente: 290 },
        'DESHOLLINADO': { aireCliente: 185, aireNoCliente: 210, aguaCliente: 195, aguaNoCliente: 230 },
        'LIMPIEZA': { aireCliente: 140, aireNoCliente: 170, aguaCliente: 160, aguaNoCliente: 180 },
        'PUESTA EN MARCHA': { aireCliente: 100, aireNoCliente: 100, aguaCliente: 120, aguaNoCliente: 120 },
        'VISITA TÉCNICA': { aireCliente: 120, aireNoCliente: 120, aguaCliente: 120, aguaNoCliente: 120 },
        'RECLAMACIÓN GARANTÍA': { aireCliente: 0, aireNoCliente: 0, aguaCliente: 0, aguaNoCliente: 0 }
      }
    }
  }
};

const db = {
  meta: {
    appName: 'SAT BAZA MAZANO 2.0',
    sourceWorkbook: 'estructura appsheet.xlsx',
    seededAt: new Date().toISOString(),
    counts: {
      avisos: avisos.length,
      contratosCm: contratosCm.length,
      citas: citas.length,
      fichajes: fichajes.length,
      operarios: operarios.length,
      gastosVehiculos: gastosVehiculos.length,
      repuestos: repuestos.length,
      marcas: marcas.length
    }
  },
  tarifas,
  operarios,
  marcas,
  repuestos,
  gastosVehiculos,
  contratosCm,
  citas,
  fichajes,
  avisos
};

const outPath = path.join(outDir, 'sat_db.json');
fs.writeFileSync(outPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Saved sat_db.json successfully:', db.meta.counts);
