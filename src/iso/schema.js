// ISO 11783-6 (Virtual Terminal) object definitions – annex B, VT version 3, with the version 4 options.
// The field list of every type follows the byte order of the standard exactly: it drives the encoder,
// the parser and the property panel. Multi-byte values are little-endian.

export const NONE = 0xffff;

/** Font size codes 0..14 → [character width, character height] in pixels. */
export const FONT_SIZES = [
  [6, 8], [8, 8], [8, 12], [12, 16], [16, 16], [16, 24], [24, 32], [32, 32], [32, 48], [48, 64],
  [64, 64], [64, 96], [96, 128], [128, 128], [128, 192],
];

export const HJUST = [[0, 'Links'], [1, 'Midden'], [2, 'Rechts']];
export const VJUST = [[0, 'Boven'], [1, 'Midden (v4)'], [2, 'Onder (v4)']];

/** Macro events (event ID → name). */
export const EVENTS = [
  [1, 'On Activate'], [2, 'On Deactivate'], [3, 'On Show'], [4, 'On Hide'], [5, 'On Enable'], [6, 'On Disable'],
  [7, 'On Change Active Mask'], [8, 'On Change Soft Key Mask'], [9, 'On Change Attribute'],
  [10, 'On Change Background Colour'], [11, 'On Change Font Attributes'], [12, 'On Change Line Attributes'],
  [13, 'On Change Fill Attributes'], [14, 'On Change Child Location'], [15, 'On Change Size'],
  [16, 'On Change Value'], [17, 'On Change Priority'], [18, 'On Change End Point'],
  [19, 'On Input Field Selection'], [20, 'On Input Field Deselection'], [21, 'On ESC'],
  [22, 'On Entry of a Value'], [23, 'On Entry of a New Value'], [24, 'On Key Press'], [25, 'On Key Release'],
  [26, 'On Change Child Position'],
];

// ---------- field constructors ----------
const num = (k) => (n, label, def = 0, extra = {}) => ({ k, n, label, def, ...extra });
const u8 = num('u8');
const u16 = num('u16');
const u32 = num('u32');
const i32 = num('i32');
const f32 = num('f32');
const colour = (n, label, def = 0) => ({ k: 'colour', n, label, def });
const bool = (n, label, def = 1) => ({ k: 'bool', n, label, def });
const en = (n, label, opts, def = 0) => ({ k: 'enum', n, label, opts, def });
const bits = (n, label, list, def = 0) => ({ k: 'bits', n, label, bits: list, def });
/** Object reference (2 bytes). `none`: 0xFFFF (no object) allowed. `auto`: type created when a new object needs one. */
const ref = (n, label, types, { none = true, auto } = {}) => ({ k: 'ref', n, label, types, none, auto, def: NONE });
const just = () => ({ k: 'just', n: 'justification', label: 'Uitlijning', def: 0 });
/** Length-prefixed string. `fixed`: the length is an attribute (`length`) and the value is padded with spaces. */
const str = (n, label, lenSize, fixed) => ({ k: 'string', n, label, lenSize, fixed, def: '' });
/** Number of items of the list `of`, written as `size` bytes (lists follow their counts later on). */
const cnt = (of, size = 1) => ({ k: 'count', of, size });
const children = () => ({ k: 'children', n: 'children', label: 'Kinderen' });
const macros = () => ({ k: 'macros', n: 'macros', label: 'Macro\'s' });
const idlist = (n, label, types) => ({ k: 'idlist', n, label, types });

const mac = [cnt('macros')];
const W = (def) => u16('width', 'Breedte', def, { min: 0, max: 65535 });
const H = (def) => u16('height', 'Hoogte', def, { min: 0, max: 65535 });
const BG = (def = 1) => colour('bgColour', 'Achtergrondkleur', def);
const FONT = ref('fontAttributes', 'Lettertype', [23], { none: false, auto: 23 });
const LINE = ref('lineAttributes', 'Lijnattributen', [24], { none: false, auto: 24 });
const FILL = ref('fillAttributes', 'Vulattributen', [25]);
const NUMVAR = ref('variableReference', 'Variabele (Number Variable)', [21]);
const STRVAR = ref('variableReference', 'Variabele (String Variable)', [22]);
const ANGLE = (n, label, def) => u8(n, label, def, { min: 0, max: 180, hint: '× 2°, 0 = rechts, tegen de klok in' });

const STRING_OPTS = [[0, 'Transparant'], [1, 'Automatisch afbreken'], [2, 'Afbreken op koppelteken (v4)']];
const NUMBER_OPTS = [[0, 'Transparant'], [1, 'Voorloopnullen'], [2, 'Nul als leeg'], [3, 'Afkappen i.p.v. afronden (v4)']];
const FORMAT = en('format', 'Notatie', [[0, 'Vast aantal decimalen'], [1, 'Exponentieel']]);

// ---------- groups of types ----------
export const OUTPUTS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 27, 3];
export const INPUTS = [7, 8, 9, 10];
/** Allowed child types per parent type. */
export const CHILD_TYPES = {
  0: OUTPUTS,
  1: [...OUTPUTS, ...INPUTS, 6],
  2: [...OUTPUTS, ...INPUTS, 6],
  3: [...OUTPUTS, ...INPUTS, 6],
  5: OUTPUTS,
  6: OUTPUTS,
};

// ---------- the objects ----------
export const TYPES = {
  0: {
    name: 'Working Set', nl: 'Werkset', prefix: 'WorkingSet',
    fields: [BG(), bool('selectable', 'Selecteerbaar'), ref('activeMask', 'Actief masker', [1, 2], { none: false }),
      cnt('children'), cnt('macros'), cnt('languages'), children(), macros(), { k: 'langs', n: 'languages', label: 'Talen' }],
  },
  1: {
    name: 'Data Mask', nl: 'Datamasker', prefix: 'DataMask',
    fields: [BG(), ref('softKeyMask', 'Softkeymasker', [4]), cnt('children'), ...mac, children(), macros()],
  },
  2: {
    name: 'Alarm Mask', nl: 'Alarmmasker', prefix: 'AlarmMask',
    fields: [BG(), ref('softKeyMask', 'Softkeymasker', [4]),
      en('priority', 'Prioriteit', [[0, 'Hoog – bediener in gevaar'], [1, 'Middel – machinestoring'], [2, 'Laag – informatie']], 2),
      en('acousticSignal', 'Geluidssignaal', [[0, 'Hoogste prioriteit'], [1, 'Middel'], [2, 'Laagste'], [3, 'Geen']], 3),
      cnt('children'), ...mac, children(), macros()],
  },
  3: {
    name: 'Container', nl: 'Container', prefix: 'Container',
    fields: [W(120), H(80), bool('hidden', 'Verborgen', 0), cnt('children'), ...mac, children(), macros()],
  },
  4: {
    name: 'Soft Key Mask', nl: 'Softkeymasker', prefix: 'SoftKeyMask',
    fields: [BG(7), cnt('keys'), ...mac, idlist('keys', 'Toetsen', [5, 27]), macros()],
  },
  5: {
    name: 'Key', nl: 'Softkey', prefix: 'Key',
    fields: [BG(7), u8('keyCode', 'Toetscode', 1, { max: 255 }), cnt('children'), ...mac, children(), macros()],
  },
  6: {
    name: 'Button', nl: 'Knop', prefix: 'Button',
    fields: [W(100), H(40), BG(7), colour('borderColour', 'Randkleur', 8), u8('keyCode', 'Toetscode', 1, { max: 255 }),
      bits('options', 'Opties', [[0, 'Vergrendelbaar (latchable)'], [1, 'Ingedrukt (v4)'], [2, 'Rand onderdrukken (v4)'],
        [3, 'Transparante achtergrond (v4)'], [4, 'Uitgeschakeld (v4)'], [5, 'Geen rand (v4)']]),
      cnt('children'), ...mac, children(), macros()],
  },
  7: {
    name: 'Input Boolean', nl: 'Invoer ja/nee', prefix: 'InBool',
    fields: [BG(), W(24), ref('foreground', 'Voorgrond (lettertype)', [23], { none: false, auto: 23 }), NUMVAR,
      bool('value', 'Waarde', 0), bool('enabled', 'Ingeschakeld'), ...mac, macros()],
  },
  8: {
    name: 'Input String', nl: 'Invoer tekst', prefix: 'InStr',
    fields: [W(120), H(20), BG(), FONT, ref('inputAttributes', 'Invoerattributen', [26]), bits('options', 'Opties', STRING_OPTS),
      STRVAR, just(), str('value', 'Tekst', 1, true), bool('enabled', 'Ingeschakeld'), ...mac, macros()],
  },
  9: {
    name: 'Input Number', nl: 'Invoer getal', prefix: 'InNum',
    fields: [W(80), H(20), BG(), FONT, bits('options', 'Opties', NUMBER_OPTS), NUMVAR,
      u32('value', 'Waarde (ruw)'), u32('minValue', 'Minimum (ruw)'), u32('maxValue', 'Maximum (ruw)', 100), i32('offset', 'Offset'),
      f32('scale', 'Schaal', 1), u8('decimals', 'Decimalen', 0, { max: 7 }), FORMAT, just(),
      bits('options2', 'Opties 2', [[0, 'Ingeschakeld'], [1, 'Realtime bewerken (v4)']], 1), ...mac, macros()],
  },
  10: {
    name: 'Input List', nl: 'Invoer keuzelijst', prefix: 'InList',
    fields: [W(100), H(20), NUMVAR, u8('value', 'Waarde (index)', 0, { max: 255 }), cnt('items'),
      bits('options', 'Opties', [[0, 'Ingeschakeld'], [1, 'Realtime bewerken (v4)']], 1), ...mac,
      idlist('items', 'Lijstitems', OUTPUTS), macros()],
  },
  11: {
    name: 'Output String', nl: 'Tekst', prefix: 'OutStr',
    fields: [W(160), H(20), BG(), FONT, bits('options', 'Opties', STRING_OPTS), STRVAR, just(), str('value', 'Tekst', 2, true), ...mac, macros()],
  },
  12: {
    name: 'Output Number', nl: 'Getal', prefix: 'OutNum',
    fields: [W(80), H(20), BG(), FONT, bits('options', 'Opties', NUMBER_OPTS), NUMVAR,
      u32('value', 'Waarde (ruw)'), i32('offset', 'Offset'), f32('scale', 'Schaal', 1), u8('decimals', 'Decimalen', 0, { max: 7 }),
      FORMAT, just(), ...mac, macros()],
  },
  13: {
    name: 'Output Line', nl: 'Lijn', prefix: 'Line',
    fields: [LINE, W(100), H(0), en('lineDirection', 'Richting', [[0, 'Linksboven → rechtsonder'], [1, 'Linksonder → rechtsboven']]), ...mac, macros()],
  },
  14: {
    name: 'Output Rectangle', nl: 'Rechthoek', prefix: 'Rect',
    fields: [LINE, W(100), H(60), bits('lineSuppression', 'Zijde weglaten', [[0, 'Boven'], [1, 'Rechts'], [2, 'Onder'], [3, 'Links']]),
      FILL, ...mac, macros()],
  },
  15: {
    name: 'Output Ellipse', nl: 'Ellips', prefix: 'Ellipse',
    fields: [LINE, W(80), H(80), en('ellipseType', 'Soort', [[0, 'Gesloten ellips'], [1, 'Open (boog)'], [2, 'Gesloten segment'], [3, 'Gesloten sector (taart)']]),
      ANGLE('startAngle', 'Beginhoek', 0), ANGLE('endAngle', 'Eindhoek', 90), FILL, ...mac, macros()],
  },
  16: {
    name: 'Output Polygon', nl: 'Veelhoek', prefix: 'Polygon',
    fields: [W(80), H(60), LINE, FILL, en('polygonType', 'Soort', [[0, 'Convex'], [1, 'Niet-convex'], [2, 'Complex'], [3, 'Open']]),
      cnt('points'), ...mac, { k: 'points', n: 'points', label: 'Punten' }, macros()],
  },
  17: {
    name: 'Output Meter', nl: 'Meter', prefix: 'Meter',
    fields: [W(100), colour('needleColour', 'Naaldkleur', 12), colour('borderColour', 'Randkleur', 0), colour('arcColour', 'Boog- en streepkleur', 0),
      bits('options', 'Opties', [[0, 'Boog tekenen'], [1, 'Rand tekenen'], [2, 'Streepjes tekenen'], [3, 'Met de klok mee']], 15),
      u8('ticks', 'Aantal streepjes', 6, { max: 255 }), ANGLE('startAngle', 'Beginhoek', 112), ANGLE('endAngle', 'Eindhoek', 158),
      u16('minValue', 'Minimum', 0), u16('maxValue', 'Maximum', 100), NUMVAR, u16('value', 'Waarde', 30), ...mac, macros()],
  },
  18: {
    name: 'Output Linear Bar Graph', nl: 'Staafmeter', prefix: 'Bar',
    fields: [W(24), H(100), colour('colour', 'Kleur', 2), colour('targetLineColour', 'Kleur doellijn', 12),
      bits('options', 'Opties', [[0, 'Rand'], [1, 'Doellijn'], [2, 'Streepjes'], [3, 'Enkel een lijn (niet gevuld)'], [4, 'Horizontaal'], [5, 'Omgekeerde richting']], 1),
      u8('ticks', 'Aantal streepjes', 0, { max: 255 }), u16('minValue', 'Minimum', 0), u16('maxValue', 'Maximum', 100), NUMVAR,
      u16('value', 'Waarde', 50), ref('targetVariableReference', 'Variabele doelwaarde', [21]), u16('targetValue', 'Doelwaarde', 0), ...mac, macros()],
  },
  19: {
    name: 'Output Arched Bar Graph', nl: 'Boogmeter', prefix: 'Arc',
    fields: [W(100), H(100), colour('colour', 'Kleur', 2), colour('targetLineColour', 'Kleur doellijn', 12),
      bits('options', 'Opties', [[0, 'Rand'], [1, 'Doellijn'], [3, 'Enkel een lijn (niet gevuld)'], [4, 'Met de klok mee']], 16),
      ANGLE('startAngle', 'Beginhoek', 112), ANGLE('endAngle', 'Eindhoek', 158), u16('barWidth', 'Breedte balk', 12),
      u16('minValue', 'Minimum', 0), u16('maxValue', 'Maximum', 100), NUMVAR, u16('value', 'Waarde', 50),
      ref('targetVariableReference', 'Variabele doelwaarde', [21]), u16('targetValue', 'Doelwaarde', 0), ...mac, macros()],
  },
  20: {
    name: 'Picture Graphic', nl: 'Afbeelding', prefix: 'Picture',
    fields: [W(32), u16('actualWidth', 'Werkelijke breedte', 1, { ro: true }), u16('actualHeight', 'Werkelijke hoogte', 1, { ro: true }),
      en('format', 'Kleuren', [[0, 'Monochroom (1 bit)'], [1, '16 kleuren (4 bit)'], [2, '256 kleuren (8 bit)']], 2),
      bits('options', 'Opties', [[0, 'Transparant'], [1, 'Knipperend'], [2, 'RLE-compressie']]),
      colour('transparencyColour', 'Transparante kleur', 13), cnt('$raw', 4), ...mac, { k: 'picdata', n: 'pixels', label: 'Beeld' }, macros()],
  },
  21: {
    name: 'Number Variable', nl: 'Getalvariabele', prefix: 'NumVar',
    fields: [u32('value', 'Waarde (ruw)')],
  },
  22: {
    name: 'String Variable', nl: 'Tekstvariabele', prefix: 'StrVar',
    fields: [str('value', 'Tekst', 2, true)],
  },
  23: {
    name: 'Font Attributes', nl: 'Lettertype', prefix: 'Font',
    fields: [colour('fontColour', 'Tekstkleur', 0), en('fontSize', 'Grootte', FONT_SIZES.map(([w, h], i) => [i, `${w} × ${h}`]), 2),
      en('fontType', 'Tekenset', [[0, 'ISO 8859-1 (Latin 1)'], [1, 'ISO 8859-15 (Latin 9)'], [2, 'ISO 8859-2 (Latin 2)'], [4, 'ISO 8859-4 (Latin 4)'],
        [5, 'ISO 8859-5 (Cyrillisch)'], [7, 'ISO 8859-7 (Grieks)'], [255, 'Eigen (proprietary)']]),
      bits('fontStyle', 'Stijl', [[0, 'Vet'], [1, 'Doorgestreept'], [2, 'Onderstreept'], [3, 'Cursief'], [4, 'Omgekeerd'],
        [5, 'Knipperend omgekeerd'], [6, 'Knipperend verborgen'], [7, 'Proportioneel (v4)']]),
      ...mac, macros()],
  },
  24: {
    name: 'Line Attributes', nl: 'Lijnattributen', prefix: 'LineAttr',
    fields: [colour('lineColour', 'Lijnkleur', 0), u8('lineWidth', 'Lijndikte', 1, { max: 255 }),
      u16('lineArt', 'Lijnpatroon', 0xffff, { hex: true, hint: '16 bits, 1 = pixel aan, FFFF = doorlopend' }), ...mac, macros()],
  },
  25: {
    name: 'Fill Attributes', nl: 'Vulattributen', prefix: 'FillAttr',
    fields: [en('fillType', 'Vulling', [[0, 'Geen'], [1, 'Lijnkleur'], [2, 'Vulkleur'], [3, 'Patroon (afbeelding)']], 2),
      colour('fillColour', 'Vulkleur', 1), ref('fillPattern', 'Patroon', [20]), ...mac, macros()],
  },
  26: {
    name: 'Input Attributes', nl: 'Invoerattributen', prefix: 'InAttr',
    fields: [en('validationType', 'Controle', [[0, 'Enkel deze tekens toegelaten'], [1, 'Deze tekens niet toegelaten']]),
      str('validationString', 'Tekens', 1, false), ...mac, macros()],
  },
  27: {
    name: 'Object Pointer', nl: 'Objectverwijzing', prefix: 'Ptr',
    fields: [ref('value', 'Verwijst naar', [...OUTPUTS.filter((t) => t !== 27), ...INPUTS, 5, 6])],
  },
  28: {
    name: 'Macro', nl: 'Macro', prefix: 'Macro',
    fields: [cnt('commands', 2), { k: 'macrocmds', n: 'commands', label: 'Opdrachten' }],
  },
};

/** Types shown on a canvas as their own page. */
export const ROOT_TYPES = [0, 1, 2, 4, 5, 3, 6];
/** Types with fields called width / height. */
export const hasField = (type, n) => !!TYPES[type]?.fields.some((f) => f.n === n);
export const typeName = (type) => TYPES[type]?.name ?? `Type ${type}`;
export const typeNl = (type) => TYPES[type]?.nl ?? `Type ${type}`;
