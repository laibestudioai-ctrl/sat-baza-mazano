import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./sat_baza_2026/data/sat_db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

console.log('Total citas previas:', db.citas.length);

// Avisos realizables o sin procesar para agendar
const candidateAvisos = db.avisos.filter(a => a.estadoAviso === 'REALIZABLE' || a.estadoAviso === 'SIN PROCESAR');
console.log('Candidatos para agendar:', candidateAvisos.length);

// Técnicos
const techs = [
  'alejandro.bazamazano@gmail.com',
  'jacobo.bazamazano@gmail.com',
  'dioni.bazamazano@gmail.com',
  'rober.bazamazano@gmail.com',
  'alejandro.bazamazano@gmail.com, jacobo.bazamazano@gmail.com',
  'alejandro.bazamazano@gmail.com, jacobo.bazamazano@gmail.com, dioni.bazamazano@gmail.com'
];

// Semanas a poblar:
// Semana 1: Lunes 2 Nov a Viernes 6 Nov 2026 (Semana actual)
// Semana 2: Lunes 9 Nov a Sábado 14 Nov 2026 (Próxima semana)
const daysCurrentWeek = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const daysNextWeek = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];

const allDays = [...daysCurrentWeek, ...daysNextWeek];
const timeSlots = [
  { start: '08:30:00', end: '10:00:00' },
  { start: '10:30:00', end: '12:00:00' },
  { start: '12:30:00', end: '14:00:00' },
  { start: '16:00:00', end: '17:30:00' },
  { start: '17:45:00', end: '19:15:00' }
];

let avisoIdx = 0;
const newCitas = [];

allDays.forEach((dayStr, dIdx) => {
  // 3 a 5 citas por día
  const slotsForDay = (dIdx % 2 === 0) ? timeSlots.slice(0, 4) : timeSlots.slice(0, 5);

  slotsForDay.forEach((slot, sIdx) => {
    if (avisoIdx >= candidateAvisos.length) return;
    const av = candidateAvisos[avisoIdx++];
    const techAsignado = techs[(dIdx + sIdx) % techs.length];

    const cita = {
      idCita: 'nov_' + Math.random().toString(36).substring(2, 9),
      idAviso: av.idAviso,
      avisoNumero: av.numero,
      titulo: `${av.numero} - ${av.tipoIntervencion || 'SAT'} - ${av.marca || 'PELLETS'} ${av.modelo || ''}`,
      inicio: `${dayStr}T${slot.start}.000Z`,
      fin: `${dayStr}T${slot.end}.000Z`,
      creadoPor: 'OFICINA BAZA MAZANO',
      direccion: av.direccionCompleta,
      asistentes: techAsignado,
      descripcion: av.observaciones || 'Revisión y puesta a punto de temporada.',
      enCalendario: true,
      whatsappConfirmado: sIdx === 0
    };

    av.estadoAviso = 'AGENDADO';
    newCitas.push(cita);
  });
});

console.log(`✅ Creadas ${newCitas.length} citas reales para Noviembre 2026 (Semana actual y próxima semana).`);
db.citas.unshift(...newCitas);

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Base de datos guardada con éxito.');
