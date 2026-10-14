// Constantes globales y definiciones de unidades / edificios.

export const N = 192;            // celdas por lado
export const CELL = 2;           // unidades de mundo por celda
export const SIZE = N * CELL;    // tamaño del mapa en unidades de mundo
export const PLAYER = 'human';
export const BUILD_RADIUS = 24;  // distancia máxima a un edificio propio para construir
export const START_CREDITS = 4000;

export const other = (t) => (t === 'human' ? 'machine' : 'human');

export const TEAMS = {
  human:   { id: 'human',   name: 'Humanos',  color: 0x3d8bff, css: '#3d8bff' },
  machine: { id: 'machine', name: 'Máquinas', color: 0xff3b30, css: '#ff3b30' },
};

// The fixed gameplay camera looks from +Z. Every base can start in any corner, so all
// buildings show their entrances and service equipment to the camera.
export const buildingFront = () => 1;

export const DIFFICULTY = {
  easy:   { label: 'Fácil',   income: 0.7, think: 1.3, firstWave: 360, waveGap: 150, minArmy: 6, scoutDelay: 150, techDelay: 420 },
  normal: { label: 'Normal',  income: 0.9, think: 0.9, firstWave: 280, waveGap: 115, minArmy: 8, scoutDelay: 0, techDelay: 200 },
  hard:   { label: 'Difícil', income: 1.2, think: 0.5, firstWave: 210, waveGap: 80,  minArmy: 10, scoutDelay: 0, techDelay: 90 },
};

export const DEFS = {};
const def = (d) => { DEFS[d.id] = d; return d; };

// ---------------------------------------------------------------- edificios
// role: hq | power | refinery | barracks | factory | turret
const B = (o) => def({ kind: 'building', buildable: true, ...o });

B({ id: 'h_hq', team: 'human', role: 'hq', name: 'Cuartel General', buildable: false, cost: 0, time: 0,
    w: 3, h: 3, hp: 2200, power: 30, sight: 30, height: 5.5,
    desc: 'Centro de mando. Si caen todos tus edificios, pierdes.' });
B({ id: 'h_power', team: 'human', role: 'power', name: 'Planta de Energía', cost: 300, time: 10,
    w: 3, h: 3, hp: 700, power: 100, sight: 16, height: 5,
    desc: 'Genera +100 de energía. Sin energía, la producción se ralentiza.' });
B({ id: 'h_refinery', team: 'human', role: 'refinery', name: 'Refinería', cost: 1000, time: 20, requires: ['power'],
    w: 4, h: 3, hp: 1100, power: -30, sight: 18, height: 4.5,
    dock: { x: -.6, clearance: 1.9 },
    desc: 'Procesa mineral. Incluye una cosechadora gratis.' });
B({ id: 'h_barracks', team: 'human', role: 'barracks', name: 'Cuartel', cost: 400, time: 12, requires: ['power'],
    w: 3, h: 2, hp: 900, power: -20, sight: 18, height: 3.2, produces: 'barracks',
    desc: 'Entrena infantería.' });
B({ id: 'h_factory', team: 'human', role: 'factory', name: 'Fábrica', cost: 1200, time: 24, requires: ['refinery', 'power'],
    w: 3, h: 3, hp: 1300, power: -40, sight: 18, height: 4.5, produces: 'factory',
    desc: 'Construye vehículos blindados y cosechadoras.' });
B({ id: 'h_turret', team: 'human', role: 'turret', name: 'Torreta', cost: 500, time: 12, requires: ['barracks'],
    w: 2, h: 2, hp: 600, power: -15, sight: 28, height: 3.4,
    weapon: { range: 26, damage: 16, cd: 0.55, proj: 'bullet', mult: { light: 1, armor: 0.7, building: 0.5 } },
    desc: 'Defensa automática contra todo tipo de unidades.' });

B({ id: 'm_hq', team: 'machine', role: 'hq', name: 'Núcleo Central', buildable: false, cost: 0, time: 0,
    w: 3, h: 3, hp: 2200, power: 30, sight: 30, height: 5,
    desc: 'La inteligencia que controla la red.' });
B({ id: 'm_power', team: 'machine', role: 'power', name: 'Reactor', cost: 300, time: 10,
    w: 2, h: 2, hp: 700, power: 100, sight: 16, height: 4,
    desc: 'Reactor de fusión: +100 de energía.' });
B({ id: 'm_refinery', team: 'machine', role: 'refinery', name: 'Fundición', cost: 1000, time: 20, requires: ['power'],
    w: 3, h: 3, hp: 1100, power: -30, sight: 18, height: 4.5,
    desc: 'Funde mineral. Incluye un recolector gratis.' });
B({ id: 'm_barracks', team: 'machine', role: 'barracks', name: 'Ensambladora', cost: 400, time: 12, requires: ['power'],
    w: 3, h: 2, hp: 900, power: -20, sight: 18, height: 3.2, produces: 'barracks',
    desc: 'Ensambla drones y centinelas.' });
B({ id: 'm_factory', team: 'machine', role: 'factory', name: 'Forja', cost: 1200, time: 24, requires: ['refinery', 'power'],
    w: 3, h: 3, hp: 1300, power: -40, sight: 18, height: 4.5, produces: 'factory',
    desc: 'Forja máquinas pesadas y recolectores.' });
B({ id: 'm_turret', team: 'machine', role: 'turret', name: 'Torre Láser', cost: 500, time: 12, requires: ['barracks'],
    w: 2, h: 2, hp: 600, power: -15, sight: 28, height: 3.4,
    weapon: { range: 26, damage: 18, cd: 0.7, proj: 'laserbolt', mult: { light: 1, armor: 0.7, building: 0.5 } },
    desc: 'Defensa láser automática.' });

// ----------------------------------------------------------------- unidades
// cls: light | armor (para multiplicadores de daño). producer: barracks | factory
// repair.targets: productor de las unidades aliadas que puede curar o reparar.
const U = (o) => def({ kind: 'unit', turn: 8, sight: 20, ...o });

U({ id: 'h_rifle', team: 'human', role: 'inf1', name: 'Fusilero', cost: 100, time: 5, producer: 'barracks',
    hp: 60, speed: 5.5, radius: 0.7, cls: 'light', height: 1.9, sight: 18,
    weapon: { range: 12, damage: 7, cd: 0.7, proj: 'bullet', mult: { light: 1, armor: 0.4, building: 0.25 } },
    desc: 'Infantería ligera. Eficaz contra infantería.' });
U({ id: 'h_rocket', team: 'human', role: 'inf2', name: 'Lanzacohetes', cost: 250, time: 8, producer: 'barracks',
    hp: 70, speed: 4.6, radius: 0.75, cls: 'light', height: 2, sight: 18,
    weapon: { range: 20, damage: 30, cd: 2.2, proj: 'rocket', splash: 2, mult: { light: 0.5, armor: 1.5, building: 1.2 } },
    desc: 'Cohetes antiblindaje. Débil contra infantería.' });
U({ id: 'h_medic', team: 'human', role: 'medic', name: 'Médico', cost: 150, time: 6, producer: 'barracks',
    hp: 55, speed: 4.4, radius: 0.7, cls: 'light', height: 1.9, sight: 18,
    repair: { targets: 'barracks', rate: 9, range: 5 },
    desc: 'Cura a la infantería aliada cercana. Desarmado.' });
U({ id: 'h_tank', team: 'human', role: 'tank', name: 'Tanque Atlas', cost: 600, time: 14, producer: 'factory',
    hp: 320, speed: 5, turn: 2.4, radius: 1.5, cls: 'armor', height: 2.2, turret: true, turretTurn: 3.5, fireOnMove: true,
    sight: 22,
    weapon: { range: 18, damage: 32, cd: 1.5, proj: 'shell', splash: 2.5, mult: { light: 0.8, armor: 1, building: 1 } },
    desc: 'Tanque principal. Dispara en movimiento.' });
U({ id: 'h_arty', team: 'human', role: 'arty', name: 'Artillería', cost: 750, time: 16, producer: 'factory',
    hp: 140, speed: 3.8, turn: 2, radius: 1.4, cls: 'armor', height: 2.2, turret: true, turretTurn: 2,
    sight: 20,
    weapon: { range: 40, damage: 55, cd: 4, proj: 'arty', splash: 5, mult: { light: 1, armor: 0.8, building: 1.3 } },
    desc: 'Artillería de largo alcance con daño en área.' });
U({ id: 'h_mech', team: 'human', role: 'repair', name: 'Vehículo de Reparación', cost: 500, time: 12, producer: 'factory',
    hp: 240, speed: 3.5, turn: 2.6, radius: 1.4, cls: 'armor', height: 2.3, sight: 20,
    repair: { targets: 'factory', rate: 16, range: 6 },
    desc: 'Repara vehículos aliados cercanos. Desarmado.' });
U({ id: 'h_harv', team: 'human', role: 'harv', name: 'Cosechadora', cost: 700, time: 14, producer: 'factory',
    hp: 350, speed: 4, turn: 2.2, radius: 1.6, cls: 'armor', height: 2, harvester: true, capacity: 400,
    gatherRate: 28, unloadRate: 110, sight: 16,
    desc: 'Recolecta mineral y lo lleva a la refinería.' });

U({ id: 'm_drone', team: 'machine', role: 'inf1', name: 'Dron', cost: 80, time: 4, producer: 'barracks',
    hp: 45, speed: 9, radius: 0.6, cls: 'light', height: 1.6, hover: true, sight: 22,
    weapon: { range: 11, damage: 5, cd: 0.5, proj: 'laserbolt', mult: { light: 1, armor: 0.35, building: 0.25 } },
    desc: 'Dron veloz y barato. Ataca en enjambre.' });
U({ id: 'm_sentinel', team: 'machine', role: 'inf2', name: 'Centinela', cost: 230, time: 8, producer: 'barracks',
    hp: 100, speed: 4.8, radius: 0.9, cls: 'armor', height: 2.8, sight: 20,
    weapon: { range: 19, damage: 24, cd: 2, proj: 'beam', mult: { light: 0.6, armor: 1.4, building: 1.2 } },
    desc: 'Caminante con cañón láser antiblindaje.' });
U({ id: 'm_nanite', team: 'machine', role: 'medic', name: 'Nanodron', cost: 140, time: 6, producer: 'barracks',
    hp: 45, speed: 4.5, radius: 0.6, cls: 'light', height: 1.6, hover: true, sight: 20,
    repair: { targets: 'barracks', rate: 9, range: 5 },
    desc: 'Enjambre de nanobots que restaura drones y centinelas. Desarmado.' });
U({ id: 'm_crusher', team: 'machine', role: 'tank', name: 'Segador', cost: 580, time: 14, producer: 'factory',
    hp: 350, speed: 4.6, turn: 2.6, radius: 1.6, cls: 'armor', height: 2.6, turret: true, turretTurn: 3.2, fireOnMove: true,
    sight: 22,
    weapon: { range: 17, damage: 30, cd: 1.4, proj: 'plasma', splash: 2.5, mult: { light: 0.85, armor: 1, building: 1 } },
    desc: 'Máquina de guerra arácnida con cañón de plasma.' });
U({ id: 'm_siege', team: 'machine', role: 'arty', name: 'Araña de Asedio', cost: 750, time: 16, producer: 'factory',
    hp: 130, speed: 4, turn: 2.2, radius: 1.4, cls: 'armor', height: 2.8, turret: true, turretTurn: 2,
    sight: 20,
    weapon: { range: 40, damage: 50, cd: 3.8, proj: 'plasmalob', splash: 5, mult: { light: 1, armor: 0.8, building: 1.3 } },
    desc: 'Mortero de plasma de largo alcance.' });
U({ id: 'm_welder', team: 'machine', role: 'repair', name: 'Soldador', cost: 500, time: 12, producer: 'factory',
    hp: 250, speed: 3.5, turn: 2.6, radius: 1.4, cls: 'armor', height: 2.4, sight: 20,
    repair: { targets: 'factory', rate: 16, range: 6 },
    desc: 'Repara máquinas pesadas aliadas cercanas. Desarmado.' });
U({ id: 'm_harv', team: 'machine', role: 'harv', name: 'Recolector', cost: 700, time: 14, producer: 'factory',
    hp: 330, speed: 4.2, turn: 2.4, radius: 1.6, cls: 'armor', height: 2, harvester: true, capacity: 400,
    gatherRate: 28, unloadRate: 110, sight: 16,
    desc: 'Taladra mineral y lo transporta a la fundición.' });

U({ id: 'h_engineer', team: 'human', role: 'engineer', name: 'Ingeniero', cost: 500, time: 10, producer: 'barracks',
    hp: 50, speed: 4.6, radius: 0.7, cls: 'light', height: 1.9, sight: 16, engineer: true,
    desc: 'Captura estructuras tecnológicas: entra en ellas y pasan a ser tuyas. Se consume al entrar. Desarmado.' });
U({ id: 'm_engineer', team: 'machine', role: 'engineer', name: 'Infiltrador', cost: 500, time: 10, producer: 'barracks',
    hp: 50, speed: 4.8, radius: 0.65, cls: 'light', height: 1.6, hover: true, sight: 16, engineer: true,
    desc: 'Dron que se infiltra en estructuras tecnológicas y toma su control. Se consume al entrar. Desarmado.' });

// ------------------------------------------------- estructuras tecnológicas
// Pre-war sites in ruins, two drawn at random each match. They belong to nobody until an engineer
// captures one; its owner then pays to repair it. They never count for victory, cannot be sold
// and do not extend the build radius. ruin: fraction of health left in a ruin.
export const TECH_SITE_COUNT = 2;
const T = (o) => def({ kind: 'building', tech: true, team: null, role: 'tech', buildable: false, cost: 0, time: 0,
  w: 4, h: 4, hp: 2400, power: 0, sight: 20, ruin: 0.3, repairCost: 2000, repairTime: 60, ...o });

// superweapon: charge (s) once repaired and powered; delay (s) from firing to impact; damage at the centre,
// falling to 40 % at the edge of radius. Both consume power, but only once repaired.
T({ id: 't_silo', name: 'Silo de misiles', height: 5, power: -60,
    superweapon: { kind: 'nuke', title: 'Misil nuclear', charge: 360, delay: 8, radius: 11, damage: 1000 },
    desc: 'Silo de misiles. Reparado y con energía, carga un misil nuclear (6 min) que arrasa una zona amplia. El misil tarda 8 s en caer y todos ven dónde.' });
T({ id: 't_ion', name: 'Cañón de iones', height: 8.5, power: -60,
    superweapon: { kind: 'ion', title: 'Cañón de iones', charge: 240, delay: 1.5, radius: 5, damage: 1200 },
    desc: 'Enlace con un cañón de iones orbital. Reparado y con energía, carga (4 min) un haz preciso y devastador que cae en 1,5 s.' });
T({ id: 't_mammoth', name: 'Fábrica Mamut', height: 6, produces: 'mammoth',
    desc: 'Planta de tanques pesados. Reparada, construye el supertanque Mamut (pestaña Vehículos).' });
T({ id: 't_juggernaut', name: 'Fábrica Juggernaut', height: 8, produces: 'juggernaut',
    desc: 'Línea de montaje de caminantes. Reparada, construye el Juggernaut de tres cañones (pestaña Vehículos).' });
T({ id: 't_zeppelin', name: 'Hangar de zepelines', height: 7,
    desc: 'Hangar de dirigibles. El zepelín bombardero llegará en una próxima actualización.' });

// Units of a pre-war design, built by whichever side holds the repaired factory. Each side has its own
// copy with its colours. selfRepair: mends itself up to a fraction of its health once out of combat.
const MAMMOTH = { role: 'mammoth', name: 'Tanque Mamut', cost: 2200, time: 40, producer: 'mammoth',
  hp: 1100, speed: 3.4, turn: 1.6, radius: 2.1, cls: 'armor', height: 3.2, turret: true, turretTurn: 2.2, fireOnMove: true,
  sight: 24, selfRepair: { rate: 6, upTo: 0.5, delay: 5 },
  weapon: { range: 20, damage: 42, cd: 1, proj: 'shell', splash: 2.8, mult: { light: 0.8, armor: 1.15, building: 1.15 } },
  desc: 'Supertanque de antes de la guerra: doble cañón y blindaje pesado. Fuera de combate se repara solo hasta la mitad de su vida.' };
U({ ...MAMMOTH, id: 'h_mammoth', team: 'human' });
U({ ...MAMMOTH, id: 'm_mammoth', team: 'machine' });

// Long-range walker: outranges the Mammoth but is far less armoured and must stop to fire.
// salvo: shells per volley, one per gun, salvoGap seconds apart.
const JUGGERNAUT = { role: 'juggernaut', name: 'Juggernaut', cost: 2000, time: 36, producer: 'juggernaut',
  hp: 650, speed: 3.8, turn: 2, radius: 1.9, cls: 'armor', height: 4.6, turret: true, turretTurn: 1.8,
  sight: 30,
  weapon: { range: 30, damage: 30, cd: 3.2, proj: 'arty', lob: 0.15, splash: 3.5, salvo: 3, salvoGap: 0.18,
    mult: { light: 1, armor: 0.9, building: 1.25 } },
  desc: 'Caminante de artillería de antes de la guerra: dispara salvas de tres cañones desde lejos. Menos blindado que el Mamut y tiene que detenerse para disparar.' };
U({ ...JUGGERNAUT, id: 'h_juggernaut', team: 'human' });
U({ ...JUGGERNAUT, id: 'm_juggernaut', team: 'machine' });

// Índices auxiliares
export const ROLE = { human: {}, machine: {} };
for (const d of Object.values(DEFS)) if (d.team) ROLE[d.team][d.role] = d;
export const TECH_IDS = Object.values(DEFS).filter((d) => d.tech).map((d) => d.id);

export const STRUCT_ROLES = ['power', 'refinery', 'barracks', 'factory', 'turret'];
export const UNIT_ROLES = {
  barracks: ['inf1', 'inf2', 'medic', 'engineer'],
  factory: ['tank', 'arty', 'repair', 'harv'],
};

export const ROLE_NAMES = {
  hq: 'Cuartel General', power: 'Energía', refinery: 'Refinería',
  barracks: 'Cuartel', factory: 'Fábrica', turret: 'Torreta', tech: 'Estructura tecnológica',
  mammoth: 'Fábrica Mamut reparada', juggernaut: 'Fábrica Juggernaut reparada',
};

// Un médico cura lo que sale del cuartel; un reparador, lo que sale de la fábrica.
export const canRepair = (healer, target) => !!healer.def.repair && healer !== target && !target.dead &&
  target.kind === 'unit' && target.team === healer.team && target.def.producer === healer.def.repair.targets;

// Engineers take over tech structures that are not already theirs: ruins or enemy-held sites alike.
export const canCapture = (unit, target) => !!unit.def.engineer && !unit.dead && !!target && !target.dead &&
  !!target.def?.tech && target.team !== unit.team;
