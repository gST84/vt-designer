// Task controller interface for the PLC: the DB TC_Io (parameters, values from and to the TC, and the
// process data table of FB TC_Client) and the FC TC_IoMap that keeps the named fields and the table
// equal. Generated from the same implement description as TC_Pool, so the element numbers match.
import { buildDdop, kindOf } from '../tc/build.js';
import { APP_VERSION, blockTitle, generatedBy } from './common.js';

/** SCL REAL literal (always with a decimal point). */
export function realLit(x) {
  if (Number.isInteger(x)) return x.toFixed(1);
  if (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e7) return String(x);
  const [m, e] = x.toExponential().split('e');
  return `${m.includes('.') ? m : m + '.0'}E${Number(e)}`;
}

/** Per setpoint (1..P): name, kind, display unit, scale raw → display, content/total units. */
function channels(b) {
  return b.products.map((pr) => {
    const k = kindOf(pr.kind);
    return { ...pr, k, unit: k ? k.rate[0] : '', scale: k ? k.rate[1] : 1, contentUnit: k?.contentUnit?.[0] ?? '', totalUnit: k?.totalUnit?.[0] ?? '' };
  });
}

export function tiaTcIo(p) {
  const b = buildDdop(p.implement);
  const db = p.export.tcIoDb || 'TC_Io';
  const N = b.maxSections;
  const ch = channels(b);
  const P = Math.max(1, ch.length);
  const chList = ch.map((c) => `${c.index} = ${c.name}${c.k ? ` (${c.k.nl}, in ${c.unit})` : ' (geen instelwaarde)'}`).join('; ');
  const L = [
    '// =====================================================================',
    `//  ${db} – PLC-interface van werktuig "${b.implement.designator}" voor FB TC_Client – ${generatedBy()}`,
    `//  ${N} secties max., instelwaarden: ${chList || 'geen'}.`,
    `//  sys: tabellen voor TC_Client – niet zelf schrijven. Elke cyclus na TC_Client "${db}Map"() aanroepen.`,
    '//  Niet met de hand aanpassen: opnieuw exporteren.',
    '// =====================================================================',
    `DATA_BLOCK "${db}"`,
    blockTitle(`PLC-interface TC "${b.implement.designator}"`),
    "{ S7_Optimized_Access := 'TRUE' }",
    `VERSION : ${APP_VERSION}`,
    'NON_RETAIN',
    '   VAR ',
    '      status : Struct',
    '         connected : Bool;   // beschrijving geactiveerd bij de TC',
    '         taskActive : Bool;   // de TC meldt een lopende taak',
    '         sectionCount : USInt;   // secties in de gestuurde beschrijving',
    '         tcVersion : USInt;',
    '      END_STRUCT;',
    '      par : Struct   // gelezen bij de start van TC_Client; na een wijziging: enable uit en weer aan',
    `         sectionCount : USInt;   // gebruikte secties 1..${N} (0 = ${N})`,
    '         autoLayout : Bool;   // TRUE = sectionY uit de breedtes berekenen (symmetrisch)',
    `         sectionWidth : Array[1..${N}] of DInt;   // mm`,
    `         sectionX : Array[1..${N}] of DInt;   // mm ten opzichte van de koppeling, + = vooruit`,
    `         sectionY : Array[1..${N}] of DInt;   // mm, + = rechts`,
    '      END_STRUCT;',
    '      in : Struct   // van de TC',
    '         workState : Bool;   // werkstand gevraagd door de TC',
    `         section : Array[1..${N}] of Bool;   // sectie aan (sectiebesturing van de TC)`,
    `         setpoint : Array[1..${P}] of Real;   // instelwaarde (taakkaart), in de eenheid van de instelwaarde`,
    `         setpointRaw : Array[1..${P}] of DInt;   // zoals de TC ze stuurt (ISO 11783-11)`,
    '      END_STRUCT;',
    '      io : Struct   // beide richtingen: de TC zet ze, de PLC mag ze ook wijzigen',
    '         sectionAuto : Bool;   // sectiebesturing automatisch',
    `         prescriptionAuto : Array[1..${P}] of Bool;   // instelwaarde volgens taakkaart`,
    '         totalTime : DInt;   // s in werkstand (de TC mag ze op 0 zetten)',
    '      END_STRUCT;',
    '      out : Struct   // naar de TC',
    '         workState : Bool;   // het werktuig werkt',
    `         section : Array[1..${N}] of Bool;   // sectie werkt`,
    `         actual : Array[1..${P}] of Real;   // werkelijke waarde, in de eenheid van de instelwaarde`,
    `         content : Array[1..${P}] of Real;   // inhoud in L of kg (enkel producten met inhoud)`,
    `         total : Array[1..${P}] of DInt;   // totaal in L, kg of aantal`,
    '         totalArea : DInt;   // bewerkte oppervlakte in m²',
    '      END_STRUCT;',
    '      sys : Struct   // intern voor TC_Client en TC_IoMap – niet zelf schrijven',
    '         ctrl : "typeTcCtrl";',
    `         pd : Array[0..${b.pd.length - 1}] of "typeTcPd";`,
    '      END_STRUCT;',
    '   END_VAR',
    '',
    '',
    'BEGIN',
    `   par.sectionCount := ${N};`,
    '   par.autoLayout := TRUE;',
  ];
  for (const s of b.sections) {
    L.push(`   par.sectionWidth[${s.section}] := ${s.w.value}; par.sectionX[${s.section}] := ${s.x.value}; par.sectionY[${s.section}] := ${s.y.value};`);
  }
  b.pd.forEach((r, i) => {
    const what = r.index && r.role !== 'actualCondensed' && r.role !== 'setpointCondensed' ? ` ${r.index}` : '';
    L.push(`   sys.pd[${i}].element := ${r.element}; sys.pd[${i}].ddi := ${r.ddi}; sys.pd[${i}].settable := ${r.settable ? 'TRUE' : 'FALSE'};   // ${r.role}${what}: ${r.designator}`);
  });
  L.push('END_DATA_BLOCK', '');
  return L.join('\n');
}

export function tiaTcIoMap(p) {
  const b = buildDdop(p.implement);
  const db = p.export.tcIoDb || 'TC_Io';
  const D = `"${db}"`;
  const N = b.maxSections;
  const ch = channels(b);
  const pd = (i) => `${D}.sys.pd[${i}]`;
  const from = [], both = [], to = [];
  b.pd.forEach((r, i) => {
    const c = ch[r.index - 1];
    switch (r.role) {
      case 'setpointWorkState':
        from.push(`\t    // werkstand gevraagd (DDI ${r.ddi})`, `\t    IF ${pd(i)}.fromTc THEN`,
          `\t        ${D}.in.workState := (DINT_TO_DWORD(${pd(i)}.value) AND 16#3) = 16#1;`, `\t        ${pd(i)}.fromTc := FALSE;`, '\t    END_IF;');
        break;
      case 'setpointCondensed':
        from.push(`\t    // secties ${r.index * 16 + 1}-${r.index * 16 + 16} aan/uit (DDI ${r.ddi}, 2 bits per sectie: 01 = aan)`, `\t    IF ${pd(i)}.fromTc THEN`,
          `\t        #w := DINT_TO_DWORD(${pd(i)}.value);`, '\t        FOR #b := 0 TO 15 DO',
          `\t            #k := ${r.index * 16 + 1} + #b;`, `\t            IF #k <= ${N} THEN`,
          '\t                #sh := INT_TO_UINT(2 * #b);',
          `\t                ${D}.in.section[#k] := (SHR(IN := #w, N := #sh) AND 16#3) = 16#1;`, '\t            END_IF;', '\t        END_FOR;',
          `\t        ${pd(i)}.fromTc := FALSE;`, '\t    END_IF;');
        break;
      case 'setpoint':
        from.push(`\t    // ${c.name}: instelwaarde (DDI ${r.ddi}) in ${c.unit}`, `\t    IF ${pd(i)}.fromTc THEN`,
          `\t        ${D}.in.setpointRaw[${r.index}] := ${pd(i)}.value;`,
          `\t        ${D}.in.setpoint[${r.index}] := DINT_TO_REAL(${pd(i)}.value) * ${realLit(c.scale)};`,
          `\t        ${pd(i)}.fromTc := FALSE;`, '\t    END_IF;');
        break;
      case 'sectionControlState':
      case 'prescription': {
        const f = r.role === 'prescription' ? `${D}.io.prescriptionAuto[${r.index}]` : `${D}.io.sectionAuto`;
        both.push(`\t    // ${r.role === 'prescription' ? `${c.name}: taakkaart` : 'sectiebesturing'} automatisch (DDI ${r.ddi})`, `\t    IF ${pd(i)}.fromTc THEN`,
          `\t        ${f} := (DINT_TO_DWORD(${pd(i)}.value) AND 16#3) = 16#1;`, `\t        ${pd(i)}.fromTc := FALSE;`,
          `\t    ELSIF ${f} THEN`, `\t        ${pd(i)}.value := 1;`, '\t    ELSE', `\t        ${pd(i)}.value := 0;`, '\t    END_IF;');
        break;
      }
      case 'totalTime':
        both.push(`\t    // tijd in werkstand (DDI ${r.ddi}, s)`, `\t    IF ${pd(i)}.fromTc THEN`, `\t        ${D}.io.totalTime := ${pd(i)}.value;`,
          `\t        ${pd(i)}.fromTc := FALSE;`, '\t    ELSE', `\t        ${pd(i)}.value := ${D}.io.totalTime;`, '\t    END_IF;');
        break;
      case 'actualWorkState':
        to.push(`\t    // werkstand (DDI ${r.ddi})`, `\t    IF ${D}.out.workState THEN`, `\t        ${pd(i)}.value := 1;`, '\t    ELSE', `\t        ${pd(i)}.value := 0;`, '\t    END_IF;');
        break;
      case 'actualCondensed':
        to.push(`\t    // secties ${r.index * 16 + 1}-${r.index * 16 + 16} werkelijk (DDI ${r.ddi}): 01 = aan, 00 = uit, 11 = niet aanwezig`,
          '\t    #w := 16#0;', '\t    FOR #b := 0 TO 15 DO', `\t        #k := ${r.index * 16 + 1} + #b;`, '\t        #sh := INT_TO_UINT(2 * #b);',
          `\t        IF #k <= ${N} AND #k <= USINT_TO_INT(${D}.sys.ctrl.sectionCount) THEN`,
          `\t            IF ${D}.out.section[#k] THEN`, '\t                #w := #w OR SHL(IN := DINT_TO_DWORD(1), N := #sh);', '\t            END_IF;',
          '\t        ELSE', '\t            #w := #w OR SHL(IN := DINT_TO_DWORD(3), N := #sh);', '\t        END_IF;', '\t    END_FOR;',
          `\t    ${pd(i)}.value := DWORD_TO_DINT(#w);`);
        break;
      case 'workingWidth':
        to.push(`\t    // werkbreedte (DDI ${r.ddi}, mm): som van de werkende secties`, '\t    #sum := 0;', `\t    FOR #k := 1 TO ${N} DO`,
          `\t        IF #k <= USINT_TO_INT(${D}.sys.ctrl.sectionCount) AND ${D}.out.section[#k] THEN`,
          `\t            #sum := #sum + ${D}.par.sectionWidth[#k];`, '\t        END_IF;', '\t    END_FOR;', `\t    ${pd(i)}.value := #sum;`);
        break;
      case 'totalArea':
        to.push(`\t    // oppervlakte (DDI ${r.ddi}, m²)`, `\t    ${pd(i)}.value := ${D}.out.totalArea;`);
        break;
      case 'actual':
        to.push(`\t    // ${c.name}: werkelijke waarde (DDI ${r.ddi}) in ${c.unit}`, `\t    ${pd(i)}.value := REAL_TO_DINT(${D}.out.actual[${r.index}] * ${realLit(Number((1 / c.scale).toPrecision(12)))});`);
        break;
      case 'content':
        to.push(`\t    // ${c.name}: inhoud (DDI ${r.ddi}) in ${c.contentUnit}`, `\t    ${pd(i)}.value := REAL_TO_DINT(${D}.out.content[${r.index}] * 1000.0);`);
        break;
      case 'total':
        to.push(`\t    // ${c.name}: totaal (DDI ${r.ddi}) in ${c.totalUnit}`, `\t    ${pd(i)}.value := ${D}.out.total[${r.index}];`);
        break;
      default:
        throw new Error(`Onbekende rol ${r.role}`);
    }
  });
  const L = [
    '// =====================================================================',
    `//  ${db}Map – koppelt ${db} aan de procesdatatabel van TC_Client – ${generatedBy()}`,
    '//  Elke cyclus aanroepen, na TC_Client en vóór je eigen logica. Niet met de hand aanpassen.',
    '// =====================================================================',
    `FUNCTION "${db}Map" : Void`,
    blockTitle(`Koppelt ${db} aan TC_Client`),
    "{ S7_Optimized_Access := 'TRUE' }",
    `VERSION : ${APP_VERSION}`,
    `//${b.implement.designator}: ${generatedBy()}. Hoort bij ${db} en TC_Pool van dezelfde export.`,
    '   VAR_TEMP',
    '      b : Int;',
    '      k : Int;',
    '      sh : UInt;',
    '      w : DWord;',
    '      sum : DInt;',
    '   END_VAR',
    '',
    'BEGIN',
    '\tREGION Status',
    `\t    ${D}.status.connected := ${D}.sys.ctrl.connected;`,
    `\t    ${D}.status.taskActive := ${D}.sys.ctrl.taskActive;`,
    `\t    ${D}.status.sectionCount := ${D}.sys.ctrl.sectionCount;`,
    `\t    ${D}.status.tcVersion := ${D}.sys.ctrl.tcVersion;`,
    '\tEND_REGION',
    '',
    '\tREGION Van de TC',
    ...(from.length ? from : ['\t    // geen']),
    '\tEND_REGION',
    '',
    '\tREGION Beide richtingen',
    ...(both.length ? both : ['\t    // geen']),
    '\tEND_REGION',
    '',
    '\tREGION Naar de TC',
    ...(to.length ? to : ['\t    // geen']),
    '\tEND_REGION',
    'END_FUNCTION',
    '',
  ];
  return L.join('\n');
}
