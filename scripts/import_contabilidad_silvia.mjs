/**
 * Importa gastos (Gasolina, Proveedores, Portes) y actualiza importes faltantes
 * desde "CONTABILIDAD SAT BAZA.xlsx" hacia data/sat_db.json sin duplicar registros.
 *
 * Uso:
 *   node scripts/import_contabilidad_silvia.mjs ["C:/Users/NuevoNatal/Downloads/CONTABILIDAD SAT BAZA.xlsx"]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const EXCEL_PATH = process.argv[2] || 'C:/Users/NuevoNatal/Downloads/CONTABILIDAD SAT BAZA.xlsx';
const DB_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../data/sat_db.json');

function parseNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[€\s]/g, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('❌ No se encontró el Excel:', EXCEL_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ No se encontró sat_db.json:', DB_PATH);
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!Array.isArray(db.gastosSat)) db.gastosSat = [];

  const wb = XLSX.readFile(EXCEL_PATH);
  const existingKeys = new Set(
    db.gastosSat.map(g => `${g.fecha}|${g.categoria}|${g.importe}|${g.matricula}|${g.avisoNumero}`)
  );

  let addedGastos = 0;
  const wsGastos = wb.Sheets['Gastos'];
  if (wsGastos) {
    const rows = XLSX.utils.sheet_to_json(wsGastos, { header: 1, defval: null, raw: false });
    for (let i = 6; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const fechaRaw = String(r[0]).trim();
      const avisoNumero = r[3] ? String(r[3]).trim() : '';
      const vehiculoRaw = r[8] ? String(r[8]).trim() : '';
      const operario = r[9] ? String(r[9]).trim() : '';
      const concepto = [r[10], r[11]].filter(Boolean).join(' - ').trim();
      const categoria = r[12] ? String(r[12]).trim() : 'OTROS';
      const metodoPago = r[13] ? String(r[13]).trim() : 'TARJETA';
      const importe = parseNum(r[16]);
      const totalNeto = parseNum(r[23]) || Number((importe / 1.21).toFixed(2));
      if (importe <= 0 && totalNeto <= 0) continue;

      const matMatch = categoria.match(/([0-9]{4}[A-Z]{3})/i) || vehiculoRaw.match(/([0-9]{4}[A-Z]{3})/i);
      const matricula = matMatch ? matMatch[1].toUpperCase() : '';
      const key = `${fechaRaw}|${categoria}|${importe}|${matricula}|${avisoNumero}`;
      if (existingKeys.has(key)) continue;

      existingKeys.add(key);
      db.gastosSat.push({
        idGasto: crypto.randomBytes(4).toString('hex'),
        fecha: fechaRaw,
        categoria,
        proveedor: r[11] ? String(r[11]).trim() : '',
        concepto: concepto || categoria,
        avisoNumero,
        matricula,
        operario,
        metodoPago,
        importe: Number(importe.toFixed(2)),
        ivaPct: 21,
        totalNeto: Number(totalNeto.toFixed(2)),
        registradoPor: 'IMPORT_EXCEL_SILVIA'
      });
      addedGastos++;
    }
  }

  // Actualizar sumaImportes en avisos de sat_db.json si en Ingresos del Excel consta cobro y en DB estaba a 0
  let updatedAvisos = 0;
  const wsIng = wb.Sheets['Ingresos'];
  if (wsIng) {
    const rowsI = XLSX.utils.sheet_to_json(wsIng, { header: 1, defval: null, raw: false });
    const avisosByNum = new Map((db.avisos || []).map(a => [String(a.numero), a]));
    for (let i = 7; i < rowsI.length; i++) {
      const r = rowsI[i];
      if (!r || !r[2]) continue;
      const num = String(r[2]).trim();
      const pvp = parseNum(r[35]); // Columna AJ: COSTE UNIDAD / PVP
      const av = avisosByNum.get(num);
      if (av && pvp > 0 && (!av.sumaImportes || av.sumaImportes === 0)) {
        av.sumaImportes = Number(pvp.toFixed(2));
        updatedAvisos++;
      }
    }
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log(`✅ Importación completada: +${addedGastos} gastos añadidos, ${updatedAvisos} avisos actualizados con importe cobrado.`);
}

main();
