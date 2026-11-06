(() => {
'use strict';

/* ============================================================
   ZONA CERO — Última señal
   Survival horror RPG 2D · homenaje a Resident Evil
   ============================================================ */

const $ = (id) => document.getElementById(id);
const canvas = $('game');
let ctx = canvas.getContext('2d');
const hud = $('hud');

const WORLD = { w: 2200, h: 1600 };
const TAU = Math.PI * 2;
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);

let W = 0, H = 0, DPR = 1;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ---------------- state ---------------- */
let started = false, ended = false, paused = false, modalOpen = null;
let elapsed = 0, ambient = 0, last = performance.now();
let player, enemies = [], bullets = [], particles = [], decals = [], pickups = [], notes = [], terminals = [], exit;
let boss = null, cam = { x: 0, y: 0 }, stats = { kills: 0, time: 0, notes: 0 };
let keys = {}, pointerFire = false, spaceDown = false, mouse = { x: 0, y: 0 }, lastMouse = 0, mouseSeen = false;
let shake = 0, noiseLevel = 0, toastTimer = 0, fireCooldown = 0;
let pendingLevels = 0, levelChoices = [], flashTime = 0, flashX = 0, flashY = 0;
let lightning = 0, lightningTimer = 9, frames = 0;
let rain = [], groundPattern = null, worldCache = null, lightCanvas = null, lightCtx = null;

/* ---------------- audio ---------------- */
let actx = null, master = null, muted = false;

function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.26;
    master.connect(actx.destination);

    const o1 = actx.createOscillator(), o2 = actx.createOscillator();
    const f = actx.createBiquadFilter(), g = actx.createGain();
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 41; o2.frequency.value = 41.8;
    f.type = 'lowpass'; f.frequency.value = 150; f.Q.value = 4;
    g.gain.value = 0.09;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = 0.09; lg.gain.value = 18;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  } catch (e) { /* audio opcional */ }
}

function tone(freq, dur, type = 'sine', vol = 0.12, endFreq) {
  if (!actx || muted) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, actx.currentTime);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), actx.currentTime + dur);
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(actx.currentTime + dur + 0.03);
  } catch (e) {}
}

function noiseBurst(dur, vol, freq = 1200, type = 'lowpass') {
  if (!actx || muted) return;
  try {
    const len = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = actx.createBufferSource(); s.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
  } catch (e) {}
}

function sfx(kind) {
  if (!actx || muted) return;
  switch (kind) {
    case 'shot':
      noiseBurst(0.09, 0.5, 1800, 'highpass');
      tone(120, 0.14, 'square', 0.22, 45);
      break;
    case 'reload':
      tone(300, 0.05, 'square', 0.07, 180);
      setTimeout(() => tone(190, 0.06, 'square', 0.06, 120), 110);
      break;
    case 'hit':
      noiseBurst(0.05, 0.22, 700);
      break;
    case 'splat':
      noiseBurst(0.18, 0.32, 380);
      tone(70, 0.16, 'sawtooth', 0.12, 38);
      break;
    case 'hurt':
      tone(130, 0.24, 'sawtooth', 0.16, 62);
      noiseBurst(0.1, 0.2, 500);
      break;
    case 'pickup':
      tone(660, 0.1, 'sine', 0.12, 880);
      setTimeout(() => tone(990, 0.14, 'sine', 0.1, 1200), 90);
      break;
    case 'level':
      [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.1), i * 90));
      break;
    case 'groan':
      tone(rand(52, 74), 0.5, 'sawtooth', 0.05, rand(40, 50));
      break;
    case 'roar':
      tone(46, 0.9, 'sawtooth', 0.2, 28);
      noiseBurst(0.7, 0.18, 300);
      break;
    case 'note':
      tone(520, 0.12, 'sine', 0.08, 600);
      break;
    case 'empty':
      tone(220, 0.05, 'square', 0.06, 140);
      break;
  }
}

/* ---------------- world data ---------------- */
const buildings = [
  { x: 80, y: 80, w: 430, h: 250, c: '#27302c', name: 'CLÍNICA' },
  { x: 630, y: 70, w: 520, h: 230, c: '#252d2a', name: 'ARCHIVO' },
  { x: 1300, y: 70, w: 460, h: 290, c: '#29302c', name: 'HOTEL' },
  { x: 1850, y: 80, w: 270, h: 420, c: '#252c29', name: 'ESTACIÓN' },
  { x: 70, y: 470, w: 300, h: 410, c: '#29302b', name: 'VIVIENDAS' },
  { x: 500, y: 800, w: 390, h: 350, c: '#252d2a', name: 'COMISARÍA' },
  { x: 1020, y: 530, w: 420, h: 350, c: '#2a322e', name: 'MERCADO' },
  { x: 1510, y: 620, w: 600, h: 330, c: '#262e2b', name: 'PLANTA' },
  { x: 90, y: 1320, w: 490, h: 200, c: '#252c29', name: 'ALMACÉN' },
  { x: 770, y: 1300, w: 440, h: 230, c: '#29312c', name: 'DEPÓSITO' },
  { x: 1370, y: 1250, w: 400, h: 270, c: '#252c29', name: 'HOSPITAL' }
];

const upgrades = [
  { id: 'dmg', name: 'CALIBRE +P', desc: 'Daño de bala +1. Cada disparo muerde de verdad.', icon: '✕', apply() { player.dmg += 1; } },
  { id: 'armor', name: 'CHALECO TÁCTICO', desc: 'Salud máxima +25 y recupera 25 al instante.', icon: '◆', apply() { player.maxHp += 25; player.hp = Math.min(player.maxHp, player.hp + 25); } },
  { id: 'boots', name: 'BOTAS DE CAMPO', desc: 'Velocidad de movimiento +18.', icon: '↗', apply() { player.speed += 18; } },
  { id: 'ammo', name: 'PROVISIÓN', desc: 'Cargador +4 y 36 balas de reserva.', icon: '▮', apply() { player.magCap += 4; player.reserve += 36; } },
  { id: 'med', name: 'SUERO ESTIMULANTE', desc: 'Botiquín +1 y recupera 40 de salud.', icon: '✚', apply() { player.med += 1; player.hp = Math.min(player.maxHp, player.hp + 40); } },
  { id: 'reload', name: 'MANOS RÁPIDAS', desc: 'Recarga un 35% más rápida.', icon: '↻', apply() { player.reloadSpeed = Math.max(0.45, player.reloadSpeed * 0.65); } },
  { id: 'aim', name: 'MIRA LÁSER', desc: 'Dispersión reducida y balas más veloces.', icon: '◎', apply() { player.spread = Math.max(0.012, player.spread * 0.55); player.bulletSpeed += 90; } }
];

const neonSigns = [
  { x: 300, y: 345, label: 'CLÍNICA', color: '120,255,185', icon: '+' },
  { x: 1560, y: 1235, label: 'HOSPITAL', color: '255,110,95', icon: '+' },
  { x: 1580, y: 378, label: 'HOTEL', color: '255,95,80', icon: '▮' },
  { x: 1240, y: 515, label: 'MERCADO', color: '255,208,105', icon: '◈' },
  { x: 480, y: 910, label: 'R.P.D.', color: '110,185,255', icon: '✚' },
  { x: 1836, y: 300, label: 'ESTACIÓN', color: '255,175,85', icon: '▤' }
];

const lore = [
  { title: 'ARCHIVO 01 · SUERO T', body: 'No hay vacuna. El suero T no cura: reescribe. Los sujetos que despiertan ya no responden a su nombre. Si esto llega a alguien, quemen el laboratorio y no miren atrás. — Dra. Verónica Estévez, 28/09/1998' },
  { title: 'ARCHIVO 02 · LÍNEA ROJA', body: 'El tren de la línea Raccoon llegó vacío, pero las puertas estaban abiertas desde dentro. Encontramos huellas de una niña y de algo que no camina como nosotros. El distrito 07 queda clausurado por orden de Umbrella.' },
  { title: 'ARCHIVO 03 · T-07', body: 'Primer huésped compatible. Fuerza excepcional, regeneración limitada. Conserva recuerdos fragmentados y responde a una voz femenina. No lo llamen por su nombre. — Nota interna, laboratorio móvil.' }
];


/* ---------------- geometry & world helpers ---------------- */
function isBuilding(x, y, pad = 0) {
  return buildings.some((b) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
}
function circleRect(x, y, r, b) {
  const cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}
function collides(x, y, r) {
  if (x < 24 || y < 24 || x > WORLD.w - 24 || y > WORLD.h - 24) return true;
  return buildings.some((b) => circleRect(x, y, r, b));
}
function moveEntity(e, dx, dy) {
  const nx = clamp(e.x + dx, 25, WORLD.w - 25), ny = clamp(e.y + dy, 25, WORLD.h - 25);
  if (!buildings.some((b) => circleRect(nx, e.y, e.r, b))) e.x = nx;
  if (!buildings.some((b) => circleRect(e.x, ny, e.r, b))) e.y = ny;
}
function moveChase(e, angle, speed, dt) {
  const step = speed * dt;
  for (const off of [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, 2.5, -2.5]) {
    const nx = e.x + Math.cos(angle + off) * step;
    const ny = e.y + Math.sin(angle + off) * step;
    if (!collides(nx, ny, e.r)) { e.x = nx; e.y = ny; return true; }
  }
  return false;
}
function freeSpot(x, y, minDist = 0) {
  const px = player ? player.x : 0, py = player ? player.y : 0;
  const valid = (sx, sy) => !isBuilding(sx, sy, 30) && Math.hypot(sx - px, sy - py) > minDist;
  for (let j = 0; j < 90; j++) {
    const sx = clamp(x + rand(-280, 280), 90, WORLD.w - 90);
    const sy = clamp(y + rand(-280, 280), 90, WORLD.h - 90);
    if (valid(sx, sy)) return { x: sx, y: sy };
  }
  // barrido en anillos: garantiza un punto libre aunque el centro esté bloqueado
  for (let r = 90; r < 1300; r += 70) {
    for (let a = 0; a < TAU; a += 0.35) {
      const sx = clamp(x + Math.cos(a) * r, 90, WORLD.w - 90);
      const sy = clamp(y + Math.sin(a) * r, 90, WORLD.h - 90);
      if (valid(sx, sy)) return { x: sx, y: sy };
    }
  }
  return { x: clamp(x, 90, WORLD.w - 90), y: clamp(y, 90, WORLD.h - 90) };
}

/* ---------------- init ---------------- */
function initDecor() {
  decals = [];
  for (let i = 0; i < 105; i++) {
    const x = rand(60, WORLD.w - 60), y = rand(60, WORLD.h - 60);
    if (isBuilding(x, y, 24)) { i--; continue; }
    const r = Math.random();
    const type = r < 0.34 ? 'puddle' : r < 0.56 ? 'crack' : r < 0.72 ? 'paper' : r < 0.9 ? 'dirt' : 'blood';
    decals.push({ type, x, y, a: rand(0, TAU), s: rand(0.6, 1.7), rot: rand(0, TAU) });
  }
  // marcas de la evacuación fallida
  [[640, 430, 3.2], [1470, 470, 0.4], [1230, 990, 1.1], [720, 1210, 2.4], [1640, 1150, 0.8]].forEach(([x, y, a]) => {
    decals.push({ type: 'bodybag', x, y, a, s: 1, rot: a });
  });
  for (let i = 0; i < 8; i++) {
    const p = freeSpot(rand(300, 1900), rand(300, 1300), 0);
    decals.push({ type: 'blood', x: p.x, y: p.y, a: 0, s: rand(1.2, 2.2), rot: rand(0, TAU) });
  }
}

function makeZombie(x, y, aggro = false) {
  const tint = pick(['#56604f', '#4c584d', '#5e594c', '#4c5551', '#61594c']);
  return { x, y, r: 14, hp: 2, maxHp: 2, speed: rand(38, 52), phase: rand(0, TAU), hit: 0, attack: rand(0, 0.8), aggro, angle: rand(0, TAU), tint, dmg: 9, wobble: rand(0, TAU) };
}

function initWorld() {
  player = {
    x: 700, y: 1180, r: 14, hp: 100, maxHp: 100, ammo: 12, reserve: 48, magCap: 12,
    speed: 190, angle: -Math.PI / 2, reload: 0, reloadSpeed: 1.05, inv: 0, med: 1,
    xp: 0, xpNext: 160, level: 1, dmg: 1, spread: 0.045, bulletSpeed: 680, step: 0
  };
  enemies = []; bullets = []; particles = []; pickups = []; notes = [];
  boss = null; fireCooldown = 0; pendingLevels = 0; modalOpen = null; paused = false;
  stats = { kills: 0, time: 0, notes: 0 };
  shake = 0; noiseLevel = 0; pointerFire = false; spaceDown = false; lightning = 0; lightningTimer = 9;

  terminals = [
    { x: 600, y: 440, got: false },
    { x: 1515, y: 500, got: false },
    { x: 1770, y: 1110, got: false }
  ];
  exit = { x: 2040, y: 1070, active: false };

  pickups = [
    { x: 930, y: 1180, type: 'ammo', used: false },
    { x: 440, y: 1000, type: 'ammo', used: false },
    { x: 1300, y: 1180, type: 'ammo', used: false },
    { x: 1450, y: 1000, type: 'ammo', used: false },
    { x: 1950, y: 560, type: 'ammo', used: false },
    { x: 1200, y: 430, type: 'med', used: false },
    { x: 1150, y: 1250, type: 'med', used: false },
    { x: 430, y: 700, type: 'med', used: false }
  ];
  notes = [
    { x: 820, y: 1240, read: false, title: lore[0].title, body: lore[0].body },
    { x: 1100, y: 980, read: false, title: lore[1].title, body: lore[1].body },
    { x: 1790, y: 430, read: false, title: lore[2].title, body: lore[2].body }
  ];

  for (let i = 0; i < 14; i++) {
    const p = freeSpot(rand(520, 1950), rand(300, 1360), 460);
    enemies.push(makeZombie(p.x, p.y));
  }

  initDecor();
  cam.x = clamp(player.x - W / 2, 0, Math.max(0, WORLD.w - W));
  cam.y = clamp(player.y - H / 2, 0, Math.max(0, WORLD.h - H));
}


/* ---------------- progression ---------------- */
function samplesCount() { return terminals.filter((t) => t.got).length; }

function updateObjective() {
  const n = samplesCount();
  let text = 'Recupera las muestras de sangre';
  if (n >= 3 && boss && boss.alive) text = 'Elimina al experimento T-07';
  else if (n >= 3 && (!boss || !boss.alive)) text = 'Alcanza el punto de extracción';
  else if (n > 0) text = `Recupera las muestras de sangre (${n}/3)`;
  $('objectiveText').textContent = text;
}

function gainXp(n, allowModal = true) {
  player.xp += n;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level++;
    player.xpNext = Math.round(player.xpNext * 1.32 + 45);
    player.hp = Math.min(player.maxHp, player.hp + 12);
    pendingLevels++;
    sfx('level');
  }
  updateHud();
  if (allowModal && pendingLevels > 0 && !paused && !ended) openLevelUp();
}

function openLevelUp() {
  if (ended || paused) return;
  paused = true;
  modalOpen = 'levelup';
  pointerFire = false; spaceDown = false;
  $('newLevel').textContent = String(player.level).padStart(2, '0');
  levelChoices = upgrades.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  const box = $('choices');
  box.innerHTML = '';
  levelChoices.forEach((u, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.innerHTML = `<span class="num">0${i + 1}</span><b>${u.name}</b><small>${u.desc}</small><span class="ic">${u.icon}</span>`;
    b.addEventListener('click', () => takeUpgrade(i));
    box.appendChild(b);
  });
  $('levelup').classList.remove('hidden');
}

function takeUpgrade(i) {
  if (modalOpen !== 'levelup') return;
  const u = levelChoices[i];
  if (!u) return;
  u.apply();
  pendingLevels = Math.max(0, pendingLevels - 1);
  modalOpen = null;
  paused = false;
  $('levelup').classList.add('hidden');
  sfx('level');
  updateHud();
  toast('MEJORA ADQUIRIDA · ' + u.name);
  if (pendingLevels > 0) setTimeout(openLevelUp, 320);
}

function openNote(n, isNew = false) {
  paused = true;
  modalOpen = 'note';
  pointerFire = false; spaceDown = false;
  $('noteTitle').textContent = n.title;
  $('noteBody').textContent = n.body;
  $('noteReward').textContent = isNew ? '+50 XP · ARCHIVO REGISTRADO' : 'ARCHIVO YA REGISTRADO';
  $('note').classList.remove('hidden');
  sfx('note');
}

function closeNote() {
  if (modalOpen !== 'note') return;
  modalOpen = null;
  paused = false;
  $('note').classList.add('hidden');
  if (pendingLevels > 0) setTimeout(openLevelUp, 200);
}

/* ---------------- flow ---------------- */
function startGame() {
  initWorld();
  started = true; ended = false; paused = false; modalOpen = null;
  elapsed = 0;
  hud.style.display = 'block';
  $('title').classList.add('hidden');
  $('end').classList.add('hidden');
  $('levelup').classList.add('hidden');
  $('note').classList.add('hidden');
  updateHud();
  updateObjective();
  updateHint();
  initAudio();
  toast('WASD MOVER · CLIC DISPARAR · E INTERACTUAR', 4.5);
}

function finish(win) {
  ended = true;
  pointerFire = false; spaceDown = false;
  const t = Math.floor(stats.time);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  $('endTitle').innerHTML = win ? 'MISIÓN<span>COMPLETA</span>' : 'SEÑAL<span>PERDIDA</span>';
  $('endCopy').textContent = win
    ? `Extracción confirmada a las 03:30. ${stats.kills} infectados neutralizados · nivel ${player.level} · ${stats.notes}/3 archivos · tiempo ${mm}:${ss}.`
    : `La señal se ha perdido en la zona de cuarentena. Resististe ${mm}:${ss}, eliminaste a ${stats.kills} infectados y alcanzaste el nivel ${player.level}. La ciudad aún guarda sus secretos.`;
  $('end').classList.remove('hidden');
  hud.style.display = 'none';
  sfx(win ? 'level' : 'roar');
}

function toast(msg, time = 2.4) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = time;
}

function updateHud() {
  if (!player) return;
  const hp = clamp(player.hp / player.maxHp, 0, 1);
  $('hpBar').style.width = (hp * 100) + '%';
  $('hpBar').style.background = hp < 0.35 ? 'var(--red)' : 'var(--lime)';
  $('hpText').textContent = Math.ceil((player.hp / player.maxHp) * 100) + '%';
  $('ammoText').innerHTML = player.ammo + ' <small>/ ' + player.reserve + '</small>';
  $('medText').textContent = player.med;
  $('levelText').textContent = 'NIV. ' + String(player.level).padStart(2, '0');
  $('xpText').textContent = 'XP ' + String(player.xp).padStart(3, '0');
  $('xpBar').style.width = clamp(player.xp / player.xpNext, 0, 1) * 100 + '%';
  $('sampleCount').textContent = samplesCount() + ' / 3';
  if (typeof updateObjective === 'function' && terminals) updateObjective();
}

/* ---------------- interaction ---------------- */
function nearestUse() {
  let best = null, bd = 62;
  for (const t of terminals) {
    if (t.got) continue;
    const d = Math.hypot(t.x - player.x, t.y - player.y);
    if (d < bd) { bd = d; best = { type: 'sample', item: t }; }
  }
  for (const p of pickups) {
    if (p.used) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d < bd) { bd = d; best = { type: p.type, item: p }; }
  }
  for (const n of notes) {
    if (n.read) continue;
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d < bd) { bd = d; best = { type: 'note', item: n }; }
  }
  const de = Math.hypot(exit.x - player.x, exit.y - player.y);
  if (de < 70 && (!best || de < bd)) best = { type: 'exit', item: exit };
  return best;
}

function updateHint() {
  if (!started || ended || paused) { $('interactHint').classList.remove('show'); return; }
  const n = nearestUse();
  const el = $('interactHint');
  if (!n) { el.classList.remove('show'); return; }
  let text = '[ E ] INTERACTUAR';
  if (n.type === 'sample') text = '[ E ] RECUPERAR MUESTRA';
  else if (n.type === 'ammo') text = '[ E ] RECOGER MUNICIÓN';
  else if (n.type === 'med') text = '[ E ] RECOGER BOTIQUÍN';
  else if (n.type === 'note') text = '[ E ] LEER ARCHIVO';
  else if (n.type === 'exit') text = !exit.active ? 'PUNTO DE EXTRACCIÓN INACTIVO' : ((boss && boss.alive) ? '[ E ] EXTRACCIÓN BLOQUEADA · T-07' : '[ E ] EXTRAER');
  el.textContent = text;
  el.classList.add('show');
}

function interact() {
  if (!started || ended || paused) return;
  const n = nearestUse();
  if (!n) { toast('No hay nada que utilizar aquí'); return; }
  if (n.type === 'sample') {
    const t = n.item;
    t.got = true;
    gainXp(120);
    burst(t.x, t.y, 24, '#d3fb64', 1);
    toast('MUESTRA RECUPERADA · +120 XP');
    sfx('pickup');
    if (samplesCount() >= 3) {
      exit.active = true;
      spawnBoss();
      toast('LA SEÑAL HA DESPERTADO ALGO · T-07', 4);
    } else {
      spawnAmbush(samplesCount());
      toast('LA HORDA HA OÍDO LA SEÑAL', 3);
    }
    updateHud();
  } else if (n.type === 'ammo') {
    n.item.used = true;
    player.reserve += 18;
    gainXp(15);
    toast('MUNICIÓN RECOGIDA · +18');
    sfx('pickup');
    updateHud();
  } else if (n.type === 'med') {
    n.item.used = true;
    player.med += 1;
    gainXp(15);
    toast('BOTIQUÍN RECOGIDO · [F] PARA USAR');
    sfx('pickup');
    updateHud();
  } else if (n.type === 'note') {
    const note = n.item;
    if (!note.read) {
      note.read = true;
      stats.notes++;
      gainXp(50, false);
      updateHud();
      openNote(note, true);
    } else {
      openNote(note, false);
    }
  } else if (n.type === 'exit') {
    if (boss && boss.alive) { toast('EXTRACCIÓN BLOQUEADA · ELIMINA AL T-07'); return; }
    if (!exit.active) { toast('EL PUNTO DE EXTRACCIÓN AÚN NO ESTÁ ACTIVO'); return; }
    finish(true);
  }
  updateHint();
}

/* ---------------- combat ---------------- */
function shoot() {
  if (!started || ended || paused || player.reload > 0 || fireCooldown > 0) return;
  if (player.ammo <= 0) {
    if (player.reserve > 0) { reload(); }
    else { toast('SIN MUNICIÓN · BUSCA PROVISIONES'); fireCooldown = 0.35; sfx('empty'); }
    return;
  }
  player.ammo--;
  fireCooldown = 0.205;
  const a = player.angle + rand(-player.spread, player.spread);
  const mx = player.x + Math.cos(a) * 16, my = player.y + Math.sin(a) * 16;
  bullets.push({ x: mx, y: my, vx: Math.cos(a) * player.bulletSpeed, vy: Math.sin(a) * player.bulletSpeed, life: 0.9, dmg: player.dmg });
  flashTime = 0.075; flashX = mx; flashY = my;
  shake = Math.min(6, shake + 2.2);
  noiseLevel = 1.9;
  sfx('shot');
  for (let i = 0; i < 5; i++) {
    particles.push({ x: mx, y: my, vx: Math.cos(a) * rand(50, 190) + rand(-40, 40), vy: Math.sin(a) * rand(50, 190) + rand(-40, 40), life: rand(0.06, 0.18), max: 0.18, color: '#ffd47e', size: rand(1, 2.4), glow: true });
  }
  updateHud();
}

function reload() {
  if (!started || ended || paused) return;
  if (player.reload > 0 || player.ammo >= player.magCap || player.reserve <= 0) return;
  player.reload = player.reloadSpeed;
  sfx('reload');
}

function useMed() {
  if (!started || ended || paused) return;
  if (player.med <= 0) { toast('NO QUEDAN BOTIQUINES'); return; }
  if (player.hp >= player.maxHp) { toast('SALUD AL MÁXIMO'); return; }
  player.med--;
  player.hp = Math.min(player.maxHp, player.hp + 45);
  burst(player.x, player.y, 18, '#8ed88e', 0.8);
  toast('BOTIQUÍN APLICADO · +45 SALUD');
  sfx('pickup');
  updateHud();
}

function hurtPlayer(dmg) {
  if (player.inv > 0 || ended) return;
  player.hp -= dmg;
  player.inv = 0.8;
  shake = 9;
  sfx('hurt');
  burst(player.x, player.y, 14, '#f35c4b', 1);
  updateHud();
  if (player.hp <= 0) { player.hp = 0; updateHud(); finish(false); }
}

function burst(x, y, n, color, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(20, 130) * power;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.85), max: 0.85, color, size: rand(1, 3.2), glow: Math.random() < 0.4 });
  }
}

function spawnAmbush(n) {
  const count = 2 + n;
  for (let i = 0; i < count; i++) {
    if (enemies.length > 24) break;
    const p = freeSpot(player.x + rand(-430, 430), player.y + rand(-430, 430), 260);
    const z = makeZombie(p.x, p.y, true);
    z.speed += rand(2, 8);
    enemies.push(z);
  }
}

function spawnBoss() {
  const p = freeSpot(1960, 1160, 260);
  boss = { x: p.x, y: p.y, r: 27, hp: 26, maxHp: 26, speed: 62, dmg: 18, attack: 1, hit: 0, phase: 0, angle: Math.PI, active: true, alive: true };
  sfx('roar');
  shake = 12;
  updateObjective();
}

function killZombie(z, index) {
  enemies.splice(index, 1);
  stats.kills++;
  gainXp(45);
  decals.push({ type: 'corpse', x: z.x, y: z.y, angle: z.angle, tint: z.tint, rot: rand(-0.5, 0.5), s: 1 });
  if (decals.length > 120) decals.splice(0, decals.length - 120);
  burst(z.x, z.y, 18, '#7e1c18', 1.1);
  sfx('splat');
  if (Math.random() < 0.24) pickups.push({ x: z.x + rand(-10, 10), y: z.y + rand(-10, 10), type: 'ammo', used: false });
  else if (Math.random() < 0.09) pickups.push({ x: z.x + rand(-10, 10), y: z.y + rand(-10, 10), type: 'med', used: false });
}

function killBoss() {
  boss.alive = false;
  stats.kills++;
  gainXp(500);
  decals.push({ type: 'corpse', x: boss.x, y: boss.y, angle: boss.angle, tint: '#6d7467', rot: 0, s: 2.2 });
  burst(boss.x, boss.y, 46, '#7e1c18', 1.8);
  burst(boss.x, boss.y, 20, '#d3fb64', 1.2);
  shake = 16;
  sfx('roar');
  toast('T-07 NEUTRALIZADO · EXTRACCIÓN DESBLOQUEADA', 4);
  updateObjective();
  updateHud();
}

/* ---------------- simulation ---------------- */
function nearestTarget(maxDist) {
  let best = null, bd = maxDist;
  for (const z of enemies) {
    const d = Math.hypot(z.x - player.x, z.y - player.y);
    if (d < bd) { bd = d; best = z; }
  }
  if (boss && boss.alive) {
    const d = Math.hypot(boss.x - player.x, boss.y - player.y);
    if (d < bd) { bd = d; best = boss; }
  }
  return best;
}

function updateCamera(dt) {
  const k = Math.min(1, dt * 6.5);
  const look = isTouch ? 0 : 42;
  const tx = clamp(player.x - W / 2 + Math.cos(player.angle) * look, 0, Math.max(0, WORLD.w - W));
  const ty = clamp(player.y - H / 2 + Math.sin(player.angle) * look, 0, Math.max(0, WORLD.h - H));
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);
}

function update(dt) {
  stats.time += dt;
  elapsed += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
  if (fireCooldown > 0) fireCooldown -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 22);
  if (noiseLevel > 0) noiseLevel = Math.max(0, noiseLevel - dt * 1.35);
  if (flashTime > 0) flashTime -= dt;
  if (player.inv > 0) player.inv -= dt;
  if (lightning > 0) lightning -= dt;
  lightningTimer -= dt;
  if (lightningTimer <= 0) { lightning = 0.14; lightningTimer = rand(13, 31); sfx('hit'); }

  if (player.reload > 0) {
    player.reload -= dt;
    if (player.reload <= 0) {
      const need = player.magCap - player.ammo;
      const take = Math.min(need, player.reserve);
      player.ammo += take;
      player.reserve -= take;
      player.reload = 0;
      updateHud();
    }
  }

  // movimiento
  let dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  let dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;
  if (moving) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    moveEntity(player, dx * player.speed * dt, dy * player.speed * dt);
    player.step += dt;
    if (player.step > 0.15) {
      player.step = 0;
      particles.push({ x: player.x + rand(-5, 5), y: player.y + rand(-2, 8), vx: rand(-8, 8), vy: rand(-4, 6), life: 0.4, max: 0.4, color: '#7d8c80', size: 1.2 });
    }
  }

  // apuntado
  if (isTouch) {
    const t = nearestTarget(640);
    if (t && (pointerFire || Math.hypot(t.x - player.x, t.y - player.y) < 230)) {
      player.angle = Math.atan2(t.y - player.y, t.x - player.x);
    } else if (moving) {
      player.angle = Math.atan2(dy, dx);
    }
  } else if (performance.now() - lastMouse < 4200) {
    player.angle = Math.atan2(mouse.y + cam.y - player.y, mouse.x + cam.x - player.x);
  } else if (moving) {
    player.angle = Math.atan2(dy, dx);
  }

  if (pointerFire || spaceDown) shoot();

  updateBullets(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateParticles(dt);
  updateCamera(dt);
  updateHint();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0 || b.x < 10 || b.y < 10 || b.x > WORLD.w - 10 || b.y > WORLD.h - 10;
    if (!dead && buildings.some((bld) => circleRect(b.x, b.y, 2, bld))) {
      dead = true;
      burst(b.x, b.y, 5, '#c9b98b', 0.5);
    }
    if (!dead) {
      let hitSomething = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const z = enemies[j];
        if (Math.hypot(z.x - b.x, z.y - b.y) < z.r + 8) {
          z.hp -= b.dmg;
          z.hit = 0.12;
          z.aggro = true;
          burst(b.x, b.y, 8, '#8e2420', 0.8);
          sfx('hit');
          if (z.hp <= 0) killZombie(z, j);
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething && boss && boss.alive && Math.hypot(boss.x - b.x, boss.y - b.y) < boss.r + 6) {
        boss.hp -= b.dmg;
        boss.hit = 0.1;
        burst(b.x, b.y, 10, '#8e2420', 0.9);
        sfx('hit');
        if (boss.hp <= 0) killBoss();
        hitSomething = true;
      }
      if (hitSomething) dead = true;
    }
    if (dead) bullets.splice(i, 1);
  }
}

function updateEnemies(dt) {
  for (const z of enemies) {
    if (z.hit > 0) z.hit -= dt;
    if (z.attack > 0) z.attack -= dt;
    z.wobble += dt * 2;
    const d = Math.hypot(player.x - z.x, player.y - z.y);
    if (!z.aggro && (d < 330 || (noiseLevel > 0.1 && d < 880))) {
      z.aggro = true;
      if (d < 500 && Math.random() < 0.5) sfx('groan');
    }
    if (!z.aggro) {
      // deambular
      z.angle += Math.sin(elapsed * 0.6 + z.phase) * dt * 0.4;
      moveChase(z, z.angle, z.speed * 0.22, dt);
      continue;
    }
    const len = d || 1;
    const a = Math.atan2(player.y - z.y, player.x - z.x) + Math.sin(elapsed * 1.9 + z.phase) * 0.16;
    z.angle = a;
    const sp = z.speed * (d < 170 ? 1.28 : 1);
    if (d > z.r + player.r + 3) moveChase(z, a, sp, dt);
    if (d < z.r + player.r + 9 && z.attack <= 0) {
      z.attack = 1.15;
      hurtPlayer(z.dmg);
    }
  }
  // separación simple para que no se apilen
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01 && d < 25) {
        const push = (25 - d) * 0.5;
        a.x -= dx / d * push; a.y -= dy / d * push;
        b.x += dx / d * push; b.y += dy / d * push;
      }
    }
  }
}

function updateBoss(dt) {
  if (!boss || !boss.alive) return;
  if (boss.hit > 0) boss.hit -= dt;
  if (boss.attack > 0) boss.attack -= dt;
  boss.phase += dt;
  const d = Math.hypot(player.x - boss.x, player.y - boss.y);
  const a = Math.atan2(player.y - boss.y, player.x - boss.x);
  boss.angle = a;
  if (d < 1200 && d > boss.r + player.r + 6) {
    moveChase(boss, a, boss.speed * (d < 200 ? 1.18 : 1), dt);
  }
  if (d < boss.r + player.r + 12 && boss.attack <= 0) {
    boss.attack = 1.35;
    hurtPlayer(boss.dmg);
    shake = 13;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.93; p.vy *= 0.93;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ---------------- input ---------------- */
function onKey(e, down) {
  const k = e.key;
  let mapped = null;
  if (k === 'ArrowUp' || k === 'w' || k === 'W') mapped = 'w';
  else if (k === 'ArrowDown' || k === 's' || k === 'S') mapped = 's';
  else if (k === 'ArrowLeft' || k === 'a' || k === 'A') mapped = 'a';
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') mapped = 'd';

  if (down && modalOpen === 'levelup') {
    if (k === '1' || k === '2' || k === '3') { e.preventDefault(); takeUpgrade(Number(k) - 1); }
    return;
  }
  if (down && modalOpen === 'note') {
    if (k === 'e' || k === 'E' || k === 'Enter' || k === 'Escape' || k === ' ') { e.preventDefault(); closeNote(); }
    return;
  }
  if (down && !started && (k === 'Enter' || k === ' ')) { e.preventDefault(); startGame(); return; }
  if (mapped) { keys[mapped] = down; e.preventDefault(); return; }
  if (k === ' ') { spaceDown = down; e.preventDefault(); return; }
  if (!down) return;
  if (k === 'e' || k === 'E') interact();
  else if (k === 'r' || k === 'R') reload();
  else if (k === 'f' || k === 'F') useMed();
  else if (k === 'm' || k === 'M') {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.26;
    toast(muted ? 'SONIDO DESACTIVADO' : 'SONIDO ACTIVADO');
  }
}

document.addEventListener('keydown', (e) => onKey(e, true));
document.addEventListener('keyup', (e) => onKey(e, false));

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  lastMouse = performance.now();
  mouseSeen = true;
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  lastMouse = performance.now();
  pointerFire = true;
});
window.addEventListener('mouseup', () => { pointerFire = false; });
canvas.addEventListener('mouseleave', () => { pointerFire = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const wx = e.clientX + cam.x, wy = e.clientY + cam.y;
  player.angle = Math.atan2(wy - player.y, wx - player.x);
  pointerFire = true;
});
window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointerFire = false; });
window.addEventListener('pointercancel', () => { pointerFire = false; });

document.querySelectorAll('[data-key]').forEach((el) => {
  const k = el.dataset.key;
  const on = (e) => { e.preventDefault(); keys[k] = true; el.classList.add('active'); };
  const off = (e) => { e.preventDefault(); keys[k] = false; el.classList.remove('active'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
});

document.querySelectorAll('[data-action]').forEach((el) => {
  const action = el.dataset.action;
  const on = (e) => {
    e.preventDefault(); e.stopPropagation();
    el.classList.add('active');
    if (action === 'fire') pointerFire = true;
    else if (action === 'reload') reload();
    else if (action === 'interact') interact();
  };
  const off = (e) => {
    e.preventDefault();
    el.classList.remove('active');
    if (action === 'fire') pointerFire = false;
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
});

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('noteClose').addEventListener('click', closeNote);

/* ============================================================
   RENDER
   ============================================================ */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function buildGroundPattern() {
  const c = document.createElement('canvas');
  c.width = c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2421';
  g.fillRect(0, 0, 180, 180);
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(210,225,200,' + rand(0.012, 0.045) + ')' : 'rgba(0,0,0,' + rand(0.02, 0.1) + ')';
    g.fillRect(rand(0, 180), rand(0, 180), rand(1, 3), rand(1, 2));
  }
  groundPattern = ctx.createPattern(c, 'repeat');
}

function drawGround() {
  ctx.fillStyle = groundPattern || '#1b2421';
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  // grandes manchas de humedad y asfalto gastado
  ctx.fillStyle = 'rgba(10,16,14,.30)';
  for (let i = 0; i < 12; i++) {
    const x = (i * 197 + 120) % WORLD.w, y = (i * 331 + 90) % WORLD.h;
    ctx.beginPath(); ctx.ellipse(x, y, 150 + (i % 4) * 55, 70 + (i % 3) * 35, i, 0, TAU); ctx.fill();
  }

  // señalética vial desgastada
  ctx.save();
  ctx.strokeStyle = 'rgba(205,195,140,.10)';
  ctx.lineWidth = 5;
  ctx.setLineDash([38, 30]);
  ctx.beginPath(); ctx.moveTo(520, 366); ctx.lineTo(1300, 366); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(934, 500); ctx.lineTo(934, 1270); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1475, 970); ctx.lineTo(1475, 1235); ctx.stroke();
  ctx.setLineDash([]);
  // pasos de cebra
  for (const [x, y, v] of [[565, 407, 0], [1462, 445, 0], [1228, 956, 1], [700, 1198, 0], [1630, 1140, 1]]) {
    ctx.fillStyle = 'rgba(210,215,195,.075)';
    for (let s = -2; s <= 2; s++) {
      if (v) ctx.fillRect(x - 28, y + s * 22 - 7, 56, 10);
      else ctx.fillRect(x + s * 22 - 8, y - 26, 10, 52);
    }
  }
  // tapas de alcantarilla
  for (const [x, y] of [[760, 650], [1360, 1080], [520, 1150], [1900, 800], [1050, 360]]) {
    ctx.strokeStyle = 'rgba(150,165,150,.16)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(10,15,13,.5)';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 9, y - 6 + i * 6); ctx.lineTo(x + 9, y - 6 + i * 6); ctx.stroke(); }
  }
  // flecha de evacuación
  ctx.fillStyle = 'rgba(211,251,100,.06)';
  ctx.beginPath(); ctx.moveTo(2010, 995); ctx.lineTo(2070, 1025); ctx.lineTo(2010, 1055); ctx.lineTo(2010, 1040); ctx.lineTo(1960, 1040); ctx.lineTo(1960, 1010); ctx.lineTo(2010, 1010); ctx.closePath(); ctx.fill();
  ctx.restore();

  // alambrada de cuarentena en el perímetro
  ctx.strokeStyle = 'rgba(180,195,160,.13)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 9]);
  ctx.strokeRect(18, 18, WORLD.w - 36, WORLD.h - 36);
  ctx.setLineDash([]);
  // cintas de peligro
  for (let x = 60; x < WORLD.w - 60; x += 220) {
    ctx.save();
    ctx.translate(x, 26); ctx.rotate(-0.035);
    ctx.fillStyle = 'rgba(196,168,60,.22)';
    ctx.fillRect(0, 0, 120, 8);
    ctx.fillStyle = 'rgba(15,18,15,.6)';
    for (let s = 0; s < 120; s += 20) ctx.fillRect(s, 0, 10, 8);
    ctx.restore();
  }
}


function buildWorldCache() {
  const wc = document.createElement('canvas');
  wc.width = WORLD.w; wc.height = WORLD.h;
  const wctx = wc.getContext('2d');
  const main = ctx;
  ctx = wctx;
  drawGround();
  drawSidewalks();
  drawBuildings();
  drawProps();
  ctx = main;
  worldCache = wc;
}

function drawDecals() {
  for (const d of decals) {
    if (d.x < cam.x - 60 || d.x > cam.x + W + 60 || d.y < cam.y - 60 || d.y > cam.y + H + 60) continue;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot || 0);
    const s = d.s || 1;
    if (d.type === 'puddle') {
      ctx.fillStyle = 'rgba(24,45,45,.5)';
      ctx.beginPath(); ctx.ellipse(0, 0, 30 * s, 14 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(130,170,170,.06)';
      ctx.beginPath(); ctx.ellipse(-6 * s, -3 * s, 16 * s, 5 * s, 0, 0, TAU); ctx.fill();
    } else if (d.type === 'crack') {
      ctx.strokeStyle = 'rgba(8,12,11,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-22 * s, 0);
      for (let i = 0; i < 5; i++) ctx.lineTo(-22 * s + i * 11 * s, Math.sin(i * 2.3 + d.x) * 4 * s);
      ctx.stroke();
    } else if (d.type === 'paper') {
      ctx.fillStyle = 'rgba(190,192,168,.32)';
      ctx.fillRect(-4, -6, 8 * s, 11 * s);
    } else if (d.type === 'dirt') {
      ctx.fillStyle = 'rgba(45,38,30,.26)';
      ctx.beginPath(); ctx.ellipse(0, 0, 26 * s, 18 * s, 0, 0, TAU); ctx.fill();
    } else if (d.type === 'blood') {
      ctx.fillStyle = 'rgba(86,20,18,.42)';
      ctx.beginPath(); ctx.ellipse(0, 0, 22 * s, 12 * s, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9 + d.y * 0.01, rr = 9 + i * 4.5;
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr * s, Math.sin(a * 1.3) * rr * 0.55 * s, (1.4 + (i % 3) * 0.8) * s, 0, TAU); ctx.fill();
      }
    } else if (d.type === 'bodybag') {
      ctx.fillStyle = 'rgba(12,16,14,.5)';
      ctx.beginPath(); ctx.ellipse(0, 4, 34, 14, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(32,38,33,.9)';
      rr(-25, -9, 50, 18, 9); ctx.fill();
      ctx.fillStyle = 'rgba(190,195,165,.10)';
      rr(-18, -6, 36, 4, 2); ctx.fill();
    } else if (d.type === 'corpse') {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = 'rgba(15,10,10,.4)';
      ctx.beginPath(); ctx.ellipse(0, 5, 23 * s, 10 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = d.tint || '#4e584c';
      ctx.beginPath(); ctx.ellipse(0, 0, 17 * s, 9 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8c8f7a';
      ctx.beginPath(); ctx.arc(16 * s, -2, 5.5 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(70,14,12,.7)';
      ctx.beginPath(); ctx.ellipse(4 * s, 7 * s, 16 * s, 7 * s, 0.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

function drawSidewalks() {
  for (const b of buildings) {
    ctx.fillStyle = '#323d36';
    rr(b.x - 30, b.y - 30, b.w + 60, b.h + 60, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(170,190,165,.13)'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(8,12,10,.35)'; ctx.lineWidth = 6;
    rr(b.x - 25, b.y - 25, b.w + 50, b.h + 50, 2); ctx.stroke();
    // losas
    ctx.strokeStyle = 'rgba(15,20,17,.28)'; ctx.lineWidth = 1;
    for (let x = b.x - 30; x < b.x + b.w + 30; x += 52) {
      ctx.beginPath(); ctx.moveTo(x, b.y - 30); ctx.lineTo(x, b.y);
      ctx.moveTo(x, b.y + b.h); ctx.lineTo(x, b.y + b.h + 30); ctx.stroke();
    }
    for (let y = b.y - 30; y < b.y + b.h + 30; y += 42) {
      ctx.beginPath(); ctx.moveTo(b.x - 30, y); ctx.lineTo(b.x, y);
      ctx.moveTo(b.x + b.w, y); ctx.lineTo(b.x + b.w + 30, y); ctx.stroke();
    }
  }
}

function drawBuildings() {
  buildings.forEach((b, i) => {
    // sombra proyectada
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    rr(b.x + 9, b.y + 12, b.w, b.h, 4); ctx.fill();

    // techo
    ctx.fillStyle = b.c;
    rr(b.x, b.y, b.w, b.h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.022)';
    rr(b.x + 7, b.y + 7, b.w - 14, b.h - 14, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(190,210,180,.15)'; ctx.lineWidth = 1.5;
    rr(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 3); ctx.stroke();

    // junta del techo
    ctx.strokeStyle = 'rgba(8,12,10,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(b.x + 18, b.y + 18); ctx.lineTo(b.x + b.w - 18, b.y + 18); ctx.stroke();

    // equipo de azotea determinista
    const seed = i * 37.7;
    const vents = 2 + (i % 3);
    for (let v = 0; v < vents; v++) {
      const vx = b.x + 46 + ((Math.sin(seed + v * 5.3) * 0.5 + 0.5) * (b.w - 100));
      const vy = b.y + 60 + ((Math.cos(seed + v * 3.1) * 0.5 + 0.5) * (b.h - 120));
      ctx.fillStyle = 'rgba(16,21,18,.72)';
      rr(vx, vy, 26, 20, 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,134,120,.18)';
      for (let k = 0; k < 4; k++) ctx.fillRect(vx + 4, vy + 4 + k * 4, 18, 1.4);
      ctx.strokeStyle = 'rgba(150,170,150,.12)';
      ctx.strokeRect(vx + 0.5, vy + 0.5, 25, 19);
    }
    // tanque de agua
    if (i % 2 === 0) {
      const wx = b.x + b.w - 70, wy = b.y + 66;
      ctx.fillStyle = 'rgba(13,18,15,.75)';
      ctx.beginPath(); ctx.arc(wx, wy, 24, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(145,160,140,.2)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wy, 17, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(wx, wy, 8, 0, TAU); ctx.stroke();
    }
    // entrada de azotea
    ctx.fillStyle = 'rgba(18,24,20,.8)';
    rr(b.x + 24, b.y + b.h - 46, 30, 26, 1); ctx.fill();

    // fachada inferior con ventanas iluminadas
    ctx.fillStyle = '#151c19';
    ctx.fillRect(b.x + 3, b.y + b.h - 16, b.w - 6, 13);
    const winCount = Math.max(3, Math.floor(b.w / 52));
    for (let w = 0; w < winCount; w++) {
      const lit = Math.sin(seed + w * 2.9) > 0.15;
      ctx.fillStyle = lit ? 'rgba(214,198,142,.34)' : 'rgba(40,52,45,.7)';
      ctx.fillRect(b.x + 14 + w * (b.w - 28) / winCount, b.y + b.h - 12, 14, 6);
    }

    // placa de identificación
    ctx.fillStyle = 'rgba(8,12,10,.5)';
    rr(b.x + 16, b.y + 16, Math.min(150, b.w * 0.5), 22, 1); ctx.fill();
    ctx.fillStyle = 'rgba(211,251,100,.72)';
    ctx.fillRect(b.x + 16, b.y + 16, 2, 22);
    ctx.fillStyle = 'rgba(225,235,218,.55)';
    ctx.font = '500 10px "DM Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(b.name, b.x + 26, b.y + 27);

    // baliza roja intermitente
    if (i % 3 === 1) {
      const on = Math.sin(ambient * 2.2 + i) > 0.55;
      ctx.fillStyle = on ? 'rgba(243,92,75,.95)' : 'rgba(120,40,35,.35)';
      ctx.beginPath(); ctx.arc(b.x + b.w - 20, b.y + 20, 3, 0, TAU); ctx.fill();
      if (on) {
        const g = ctx.createRadialGradient(b.x + b.w - 20, b.y + 20, 1, b.x + b.w - 20, b.y + 20, 26);
        g.addColorStop(0, 'rgba(243,92,75,.28)'); g.addColorStop(1, 'rgba(243,92,75,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x + b.w - 20, b.y + 20, 26, 0, TAU); ctx.fill();
      }
    }
  });
}

function drawCar(x, y, vertical, color, hazard) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(vertical ? Math.PI / 2 : 0);
  ctx.fillStyle = 'rgba(0,0,0,.32)';
  rr(-34, -16, 72, 36, 8); ctx.fill();
  ctx.fillStyle = color;
  rr(-34, -18, 68, 36, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(190,200,180,.14)'; ctx.lineWidth = 1;
  rr(-34, -18, 68, 36, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(10,18,20,.75)';
  rr(-13, -13, 27, 26, 4); ctx.fill();
  ctx.fillStyle = 'rgba(150,180,175,.14)';
  rr(-9, -10, 19, 9, 2); ctx.fill();
  ctx.fillStyle = 'rgba(8,12,10,.8)';
  rr(-28, -19, 12, 5, 2); ctx.fill();
  rr(20, -19, 12, 5, 2); ctx.fill();
  rr(-28, 14, 12, 5, 2); ctx.fill();
  rr(20, 14, 12, 5, 2); ctx.fill();
  ctx.fillStyle = 'rgba(70,78,68,.5)';
  ctx.fillRect(-30, -2, 4, 4);
  ctx.fillRect(26, -2, 4, 4);
  if (hazard && Math.sin(ambient * 5.5 + x) > 0.2) {
    ctx.fillStyle = 'rgba(240,170,60,.75)';
    ctx.fillRect(-27, -19, 5, 4);
    ctx.fillRect(22, -19, 5, 4);
  }
  ctx.restore();
}


function drawPoliceCar(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.36)'; rr(-40, -19, 84, 42, 8); ctx.fill();
  ctx.fillStyle = '#202b39'; rr(-42, -21, 84, 40, 7); ctx.fill();
  ctx.fillStyle = '#d9dbcf'; rr(-28, -21, 24, 40, 3); ctx.fill();
  ctx.fillStyle = '#202b39'; rr(-4, -21, 20, 40, 3); ctx.fill();
  ctx.fillStyle = 'rgba(8,16,22,.8)'; rr(-18, -15, 24, 30, 4); ctx.fill();
  ctx.fillStyle = 'rgba(160,190,200,.16)'; rr(-14, -11, 16, 10, 2); ctx.fill();
  ctx.fillStyle = '#101820'; rr(2, -19, 32, 7, 2); ctx.fill(); rr(2, 12, 32, 7, 2); ctx.fill();
  // barra de luces
  ctx.fillStyle = '#1a2027'; rr(-14, -4, 27, 8, 2); ctx.fill();
  ctx.fillStyle = Math.sin(ambient * 9) > 0 ? 'rgba(80,135,255,.95)' : 'rgba(40,60,100,.5)';
  ctx.fillRect(-12, -3, 10, 6);
  ctx.fillStyle = Math.sin(ambient * 9) < 0 ? 'rgba(255,80,68,.95)' : 'rgba(100,40,38,.5)';
  ctx.fillRect(0, -3, 10, 6);
  // puerta R.P.D.
  ctx.fillStyle = 'rgba(30,45,60,.9)'; ctx.font = '700 6px "DM Mono", monospace'; ctx.textAlign = 'center';
  ctx.fillText('R.P.D.', -16, 3);
  ctx.restore();
}

function drawCone(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(2, 5, 8, 4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#b8642f'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(235,220,180,.55)'; ctx.fillRect(-4, -3, 8, 2.5);
  ctx.fillStyle = '#6e4226'; ctx.fillRect(-7, 4, 14, 3);
  ctx.restore();
}

function drawDumpster(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(-22, -11, 46, 26, 3); ctx.fill();
  ctx.fillStyle = '#303d34'; rr(-24, -14, 48, 28, 3); ctx.fill();
  ctx.fillStyle = '#263229'; rr(-20, -11, 40, 22, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,170,150,.16)'; ctx.strokeRect(-24.5, -14.5, 49, 29);
  ctx.fillStyle = 'rgba(180,190,140,.18)'; ctx.fillRect(-24, -14, 48, 3);
  ctx.restore();
}

function drawBarricade(x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-32, 6, 68, 8);
  ctx.fillStyle = '#b7b49a'; ctx.fillRect(-34, -6, 68, 13);
  ctx.fillStyle = '#22261f';
  for (let i = -34; i < 34; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, -6); ctx.lineTo(i + 8, -6); ctx.lineTo(i + 2, 7); ctx.lineTo(i - 6, 7); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(243,92,75,.65)'; ctx.fillRect(-34, -8, 68, 2);
  ctx.restore();
}

function drawProps() {
  const cars = [
    [700, 650, 0, '#4a3230', 1], [1160, 1080, 1, '#2f4148', 0], [1470, 1180, 0, '#3d4438', 1],
    [1900, 1000, 1, '#4e4432', 0], [1280, 420, 0, '#363f41', 1], [100, 1100, 0, '#3f3830', 0],
    [960, 1230, 0, '#35423c', 0], [2050, 540, 1, '#493a33', 1]
  ];
  cars.forEach(([x, y, v, c, h]) => drawCar(x, y, v, c, h));
  drawPoliceCar(862, 1218);
  [[610, 1162], [648, 1188], [692, 1210], [742, 1246]].forEach(([x, y]) => drawCone(x, y));
  // ambulancia volcada
  ctx.save();
  ctx.translate(838, 690); ctx.rotate(0.44);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(-52, -24, 110, 54, 8); ctx.fill();
  ctx.fillStyle = '#b9b9a8'; rr(-54, -25, 108, 50, 7); ctx.fill();
  ctx.fillStyle = 'rgba(160,50,44,.65)'; ctx.fillRect(-54, -9, 108, 8);
  ctx.fillStyle = 'rgba(20,30,32,.8)'; rr(-6, -17, 30, 34, 4); ctx.fill();
  ctx.fillStyle = 'rgba(150,180,175,.16)'; rr(-2, -13, 20, 10, 2); ctx.fill();
  ctx.fillStyle = 'rgba(30,38,34,.8)'; ctx.fillRect(-46, -25, 16, 8);
  ctx.fillStyle = 'rgba(210,180,90,.25)'; ctx.fillRect(-54, 17, 108, 4);
  ctx.restore();

  [[560, 780], [980, 870], [1452, 566], [1852, 1022], [1180, 1248]].forEach(([x, y]) => drawDumpster(x, y));
  [[575, 782, 0.06], [1002, 770, -0.04], [1468, 1168, 0.2], [1820, 960, 1.35], [1200, 1222, -0.12], [2020, 930, 0.08]].forEach(([x, y, a]) => drawBarricade(x, y, a));

  // sacos de arena frente a la comisaría
  for (let i = 0; i < 5; i++) {
    ctx.save(); ctx.translate(520 + i * 24, 1188 + (i % 2) * 6); ctx.rotate(0.02 * i);
    ctx.fillStyle = 'rgba(94,88,62,.75)'; rr(-13, -7, 26, 15, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(160,150,110,.15)'; ctx.stroke();
    ctx.restore();
  }

  // cinta policial junto al coche
  ctx.save();
  ctx.strokeStyle = 'rgba(212,190,80,.55)'; ctx.lineWidth = 3; ctx.setLineDash([9, 6]);
  ctx.beginPath(); ctx.moveTo(582, 1172); ctx.lineTo(812, 1178); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // señales de cuarentena
  for (const [x, y] of [[548, 700], [1090, 1170]]) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(142,148,120,.55)'; ctx.fillRect(-1.5, -10, 3, 38);
    ctx.fillStyle = '#a8a88c'; rr(-17, -28, 34, 22, 2); ctx.fill();
    ctx.fillStyle = '#342f22'; ctx.font = '700 7px "DM Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText('CERRADO', 0, -17); ctx.fillText('ZONA 07', 0, -10);
    ctx.restore();
  }

  // luces de calle
  for (const [x, y] of [[450, 650], [950, 700], [1470, 780], [1960, 600], [1130, 1200], [500, 1280], [1250, 1000], [1700, 1180]]) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 4, 9, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3c4640';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(205,215,170,.18)';
    ctx.fillRect(x - 1, y - 28, 2, 28);
    ctx.fillStyle = Math.sin(ambient * 7 + x) > -0.85 ? 'rgba(220,230,180,.55)' : 'rgba(120,130,100,.2)';
    ctx.beginPath(); ctx.arc(x, y - 28, 3.5, 0, TAU); ctx.fill();
  }
}

function drawLights() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lamps = [[450, 650], [950, 700], [1470, 780], [1960, 600], [1130, 1200], [500, 1280], [1250, 1000], [1700, 1180]];
  for (const [x, y] of lamps) {
    const flick = 0.7 + 0.3 * (Math.sin(ambient * 6.3 + x * 0.13) > -0.88 ? 1 : 0.2);
    const g = ctx.createRadialGradient(x, y, 8, x, y, 180);
    g.addColorStop(0, 'rgba(220,228,170,' + 0.22 * flick + ')');
    g.addColorStop(0.5, 'rgba(190,205,150,' + 0.085 * flick + ')');
    g.addColorStop(1, 'rgba(180,200,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 180, 0, TAU); ctx.fill();
  }
  // luces del coche policial
  const pt = Math.sin(ambient * 9);
  const pg = ctx.createRadialGradient(862, 1218, 4, 862, 1218, 90);
  pg.addColorStop(0, pt > 0 ? 'rgba(70,120,255,.16)' : 'rgba(255,70,60,.16)');
  pg.addColorStop(1, 'rgba(80,120,255,0)');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(862, 1218, 90, 0, TAU); ctx.fill();

  // resplandor de la ambulancia
  const ag = ctx.createRadialGradient(838, 690, 4, 838, 690, 120);
  ag.addColorStop(0, 'rgba(200,70,50,.12)'); ag.addColorStop(1, 'rgba(200,70,50,0)');
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(838, 690, 120, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawTerminals() {
  for (const t of terminals) {
    const pulse = 0.5 + 0.5 * Math.sin(ambient * 2.8 + t.x * 0.02);
    if (!t.got) {
      const g = ctx.createRadialGradient(t.x, t.y, 2, t.x, t.y, 54 + pulse * 14);
      g.addColorStop(0, 'rgba(211,251,100,.30)');
      g.addColorStop(1, 'rgba(211,251,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(t.x, t.y, 70, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(t.x, t.y + 8, 19, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a342c'; rr(t.x - 15, t.y - 7, 30, 20, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(180,195,165,.25)'; ctx.strokeRect(t.x - 15, t.y - 7, 30, 20);
    ctx.fillStyle = '#1c241f'; rr(t.x - 11, t.y - 4, 22, 13, 1); ctx.fill();
    if (!t.got) {
      ctx.strokeStyle = 'rgba(211,251,100,' + (0.3 + pulse * 0.5) + ')';
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(t.x, t.y, 24 + pulse * 4, ambient, ambient + TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save(); ctx.translate(t.x, t.y - 13); ctx.rotate(0.2);
      ctx.fillStyle = 'rgba(211,251,100,.95)'; ctx.fillRect(-3, -7, 6, 14);
      ctx.fillStyle = 'rgba(255,255,230,.9)'; ctx.fillRect(-1, -5, 2, 10);
      ctx.restore();
      ctx.fillStyle = 'rgba(211,251,100,.85)';
      ctx.font = '500 9px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MUESTRA', t.x, t.y - 34);
    } else {
      ctx.strokeStyle = 'rgba(150,165,150,.2)'; ctx.lineWidth = 1;
      ctx.strokeRect(t.x - 15, t.y - 7, 30, 20);
      ctx.fillStyle = 'rgba(150,165,150,.35)';
      ctx.font = '500 9px "DM Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText('VACÍO', t.x, t.y - 20);
    }
  }
}

function drawPickups() {
  for (const p of pickups) {
    if (p.used) continue;
    const bob = Math.sin(ambient * 2.5 + p.x * 0.03) * 2;
    ctx.save(); ctx.translate(p.x, p.y + bob);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    glow.addColorStop(0, p.type === 'ammo' ? 'rgba(211,251,100,.24)' : 'rgba(243,110,100,.22)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(0, 8, 12, 5, 0, 0, TAU); ctx.fill();
    if (p.type === 'ammo') {
      ctx.fillStyle = '#3d4a31'; rr(-12, -8, 24, 15, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(211,251,100,.6)'; ctx.stroke();
      ctx.fillStyle = '#d3fb64'; ctx.fillRect(-9, -4, 18, 1.6);
      ctx.fillStyle = 'rgba(230,220,160,.8)';
      ctx.fillRect(-7, -6, 2, 5); ctx.fillRect(-2, -6, 2, 5); ctx.fillRect(3, -6, 2, 5);
    } else {
      ctx.fillStyle = '#cfd3c1'; rr(-12, -9, 24, 18, 2); ctx.fill();
      ctx.fillStyle = '#a83a31'; ctx.fillRect(-8, -2, 16, 5); ctx.fillRect(-2.5, -7, 5, 15);
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.stroke();
    }
    ctx.restore();
  }
}

function drawNotes() {
  for (const n of notes) {
    if (n.read) continue;
    const bob = Math.sin(ambient * 2.2 + n.y * 0.02) * 1.5;
    ctx.save(); ctx.translate(n.x, n.y + bob); ctx.rotate(-0.16);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    g.addColorStop(0, 'rgba(220,235,220,.16)'); g.addColorStop(1, 'rgba(220,235,220,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-6, 8, 18, 5);
    ctx.fillStyle = '#d9dccb'; ctx.fillRect(-8, -10, 16, 20);
    ctx.fillStyle = 'rgba(120,125,105,.5)';
    ctx.fillRect(-5, -6, 10, 1); ctx.fillRect(-5, -3, 10, 1); ctx.fillRect(-5, 0, 7, 1);
    ctx.fillStyle = 'rgba(211,251,100,.55)'; ctx.fillRect(-8, -10, 2, 20);
    ctx.restore();
  }
}

function drawExit() {
  const pulse = 0.5 + 0.5 * Math.sin(ambient * 3);
  const locked = boss && boss.alive;
  ctx.save();
  const col = locked ? '243,92,75' : exit.active ? '211,251,100' : '150,160,140';
  const g = ctx.createRadialGradient(exit.x, exit.y, 4, exit.x, exit.y, exit.active ? 100 : 60);
  g.addColorStop(0, 'rgba(' + col + ',' + (exit.active ? 0.22 : 0.08) + ')');
  g.addColorStop(1, 'rgba(' + col + ',0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(exit.x, exit.y, exit.active ? 100 : 60, 0, TAU); ctx.fill();

  ctx.strokeStyle = 'rgba(' + col + ',' + (exit.active ? 0.6 + pulse * 0.3 : 0.25) + ')';
  ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.arc(exit.x, exit.y, 42 + pulse * 3, ambient * 0.5, ambient * 0.5 + TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(' + col + ',.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(exit.x, exit.y, 30, 0, TAU); ctx.stroke();

  // chevrones
  ctx.fillStyle = 'rgba(' + col + ',' + (exit.active ? 0.8 : 0.35) + ')';
  for (let i = 0; i < 4; i++) {
    const a = ambient * 0.8 + i * Math.PI / 2;
    const x = exit.x + Math.cos(a) * 56, y = exit.y + Math.sin(a) * 56;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // haz vertical
  if (exit.active) {
    const bg = ctx.createLinearGradient(exit.x, exit.y, exit.x, exit.y - 220);
    bg.addColorStop(0, 'rgba(211,251,100,.12)'); bg.addColorStop(1, 'rgba(211,251,100,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(exit.x - 18, exit.y); ctx.lineTo(exit.x - 5, exit.y - 220); ctx.lineTo(exit.x + 5, exit.y - 220); ctx.lineTo(exit.x + 18, exit.y); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(' + col + ',.9)';
  ctx.font = '500 10px "DM Mono", monospace'; ctx.textAlign = 'center';
  ctx.fillText(locked ? 'BLOQUEADO · T-07' : exit.active ? 'EXTRACCIÓN' : 'PUNTO DE EXTRACCIÓN', exit.x, exit.y - 56);
  if (locked) {
    ctx.fillStyle = 'rgba(243,92,75,.7)'; ctx.fillRect(exit.x - 5, exit.y - 7, 10, 12);
    ctx.strokeStyle = 'rgba(243,92,75,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(exit.x, exit.y - 8, 5, Math.PI, 0); ctx.stroke();
  }
  ctx.restore();
}

function drawEnemies() {
  for (const z of enemies) {
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(0, 8, 17, 8, 0, 0, TAU); ctx.fill();
    ctx.rotate(z.angle);
    const wob = Math.sin(elapsed * 4.5 + z.wobble) * 2;
    const flash = z.hit > 0;
    // piernas
    ctx.strokeStyle = flash ? '#e8e8d8' : '#333d33';
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-18 + wob, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, 5); ctx.lineTo(-18 - wob, 9); ctx.stroke();
    // torso
    ctx.fillStyle = flash ? '#f1f2e4' : z.tint;
    ctx.beginPath(); ctx.ellipse(-2, 0, 14, 11, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(15,20,15,.55)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(5, -3); ctx.moveTo(-9, 5); ctx.lineTo(3, 6); ctx.stroke();
    // manchas
    ctx.fillStyle = 'rgba(92,20,18,.55)';
    ctx.beginPath(); ctx.arc(-3, 3, 4.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -4, 2.4, 0, TAU); ctx.fill();
    // brazos extendidos
    ctx.strokeStyle = flash ? '#e8e8d8' : (z.tint === '#61594c' ? '#5c5548' : '#4d5949');
    ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(20, -10 + wob * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(20, 10 - wob * 0.5); ctx.stroke();
    ctx.fillStyle = '#8e9280';
    ctx.beginPath(); ctx.arc(20, -10 + wob * 0.5, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(20, 10 - wob * 0.5, 3.2, 0, TAU); ctx.fill();
    // cabeza
    ctx.fillStyle = flash ? '#ffffff' : '#999b82';
    ctx.beginPath(); ctx.arc(10, 0, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(52,48,36,.7)';
    ctx.beginPath(); ctx.arc(8, 0, 5, 0.6, 5.2); ctx.fill();
    // ojos
    ctx.fillStyle = z.aggro ? 'rgba(255,92,70,.95)' : 'rgba(120,110,80,.5)';
    ctx.beginPath(); ctx.arc(14, -2.4, 1.1, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 2.4, 1.1, 0, TAU); ctx.fill();
    // mandíbula
    ctx.fillStyle = 'rgba(60,18,16,.85)';
    ctx.beginPath(); ctx.arc(15, 0, 2.6, -0.5, 0.5); ctx.fill();
    ctx.restore();
  }
}

function drawBoss() {
  if (!boss || !boss.alive) return;
  const flash = boss.hit > 0;
  ctx.save();
  ctx.translate(boss.x, boss.y);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.beginPath(); ctx.ellipse(0, 15, 38, 17, 0, 0, TAU); ctx.fill();
  ctx.rotate(boss.angle);
  const sway = Math.sin(elapsed * 3 + boss.phase) * 3;
  // piernas
  ctx.strokeStyle = '#2a302a'; ctx.lineWidth = 13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-14, -9); ctx.lineTo(-33 + sway, -14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, 9); ctx.lineTo(-33 - sway, 14); ctx.stroke();
  // abrigo
  ctx.fillStyle = flash ? '#f2f3e2' : '#3d423a';
  ctx.beginPath(); ctx.ellipse(-4, 0, 27, 22, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(20,24,20,.55)';
  ctx.beginPath(); ctx.ellipse(-10, 0, 20, 18, 0, 0, TAU); ctx.fill();
  // costuras y venas
  ctx.strokeStyle = 'rgba(160,40,34,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-20, -12); ctx.lineTo(-5, -4); ctx.lineTo(-18, 8); ctx.stroke();
  // brazos enormes
  ctx.strokeStyle = flash ? '#e8e8d8' : '#6b7263'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(4, -16); ctx.lineTo(34, -20 + sway); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(34, 20 - sway); ctx.stroke();
  ctx.fillStyle = '#8b8f77';
  ctx.beginPath(); ctx.arc(36, -20 + sway, 6.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(36, 20 - sway, 6.5, 0, TAU); ctx.fill();
  // cabeza pequeña
  ctx.fillStyle = flash ? '#ffffff' : '#a0a189';
  ctx.beginPath(); ctx.arc(20, 0, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(30,26,20,.85)';
  ctx.fillRect(25, -5, 5, 3); ctx.fillRect(25, 2, 5, 3);
  ctx.fillStyle = 'rgba(243,92,75,.95)';
  ctx.beginPath(); ctx.arc(28, -3.5, 1.3, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(28, 3.5, 1.3, 0, TAU); ctx.fill();
  ctx.restore();

  // aura roja
  const g = ctx.createRadialGradient(boss.x, boss.y, 10, boss.x, boss.y, 70);
  g.addColorStop(0, 'rgba(180,40,32,.10)'); g.addColorStop(1, 'rgba(180,40,32,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(boss.x, boss.y, 70, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(243,92,75,' + (0.25 + 0.15 * Math.sin(ambient * 3)) + ')';
  ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(boss.x, boss.y, 40, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(243,92,75,.85)';
  ctx.font = '500 9px "DM Mono", monospace'; ctx.textAlign = 'center';
  ctx.fillText('T-07', boss.x, boss.y - 48);
}

function drawPlayer() {
  const halo = ctx.createRadialGradient(player.x, player.y, 4, player.x, player.y, 44);
  halo.addColorStop(0, 'rgba(211,251,100,.10)');
  halo.addColorStop(1, 'rgba(211,251,100,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(player.x, player.y, 44, 0, TAU); ctx.fill();
  const bob = Math.sin(elapsed * 10) * (Math.hypot(player.x - (player._px || player.x), player.y - (player._py || player.y)) > 0.4 ? 1.2 : 0);
  player._px = player.x; player._py = player.y;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.scale(1.12, 1.12);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(0, 9, 16, 8, 0, 0, TAU); ctx.fill();
  ctx.rotate(player.angle);
  // contorno para despegar al personaje del fondo
  ctx.fillStyle = 'rgba(5,9,7,.55)';
  ctx.beginPath(); ctx.ellipse(-1, 0, 19, 15, 0, 0, TAU); ctx.fill();
  // piernas
  ctx.strokeStyle = '#26352b'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-15, -8 + bob); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-7, 5); ctx.lineTo(-15, 8 - bob); ctx.stroke();
  // mochila
  ctx.fillStyle = '#46584a';
  rr(-18, -8, 12, 16, 3); ctx.fill();
  ctx.fillStyle = 'rgba(211,251,100,.22)'; ctx.fillRect(-16, -2, 8, 2);
  // torso
  ctx.fillStyle = player.inv > 0 ? '#cfe7b6' : '#7a926a';
  ctx.beginPath(); ctx.ellipse(-1, 0, 13, 10, 0, 0, TAU); ctx.fill();
  // chaleco
  ctx.fillStyle = 'rgba(31,48,38,.92)';
  rr(-6, -8, 12, 16, 2); ctx.fill();
  ctx.fillStyle = 'rgba(211,251,100,.85)';
  ctx.fillRect(-2, -7, 3, 5);
  ctx.fillStyle = 'rgba(211,251,100,.35)';
  ctx.fillRect(-6, 3, 11, 1.5);
  // brazos
  ctx.strokeStyle = '#95a683'; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(3, -7); ctx.lineTo(14, -5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, 7); ctx.lineTo(14, 5); ctx.stroke();
  // pistola
  ctx.fillStyle = '#1b211d';
  rr(12, -3, 13, 6, 1); ctx.fill();
  ctx.fillStyle = '#0f1411'; rr(12, 1, 4, 5, 1); ctx.fill();
  ctx.fillStyle = 'rgba(211,251,100,.9)'; ctx.fillRect(22, -1.5, 2, 3);
  // cabeza
  ctx.fillStyle = '#d8c5a5';
  ctx.beginPath(); ctx.arc(6, 0, 6.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2b2a22';
  ctx.beginPath(); ctx.arc(5, 0, 6.2, 2.2, 4.6); ctx.fill();
  ctx.strokeStyle = 'rgba(211,251,100,' + (0.3 + 0.12 * Math.sin(ambient * 3)) + ')';
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,248,210,.95)';
  ctx.beginPath(); ctx.arc(25, 0, 1.8, 0, TAU); ctx.fill();
  ctx.restore();

  // gotas de sangre si está herida
  if (player.hp < player.maxHp * 0.45) {
    ctx.fillStyle = 'rgba(130,26,22,.4)';
    ctx.beginPath(); ctx.arc(player.x + rand(-8, 8), player.y + rand(4, 12), rand(1, 2.5), 0, TAU); ctx.fill();
  }
}

function drawBullets() {
  for (const b of bullets) {
    const l = Math.hypot(b.vx, b.vy) || 1;
    const nx = b.vx / l, ny = b.vy / l;
    ctx.strokeStyle = 'rgba(255,235,170,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - nx * 18, b.y - ny * 18); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,250,210,.3)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - nx * 10, b.y - ny * 10); ctx.stroke();
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = clamp(p.life / (p.max || 0.6), 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, (p.size || 2) * (0.5 + a * 0.6), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}


function drawNeon() {
  for (const s of neonSigns) {
    const flick = Math.sin(ambient * 5.1 + s.x * 0.11) > -0.92 ? 1 : 0.35;
    const g = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 64);
    g.addColorStop(0, 'rgba(' + s.color + ',' + 0.14 * flick + ')');
    g.addColorStop(1, 'rgba(' + s.color + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 64, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(8,11,10,.78)';
    rr(s.x - 34, s.y - 10, 68, 19, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(' + s.color + ',' + 0.5 * flick + ')';
    ctx.lineWidth = 1;
    rr(s.x - 34, s.y - 10, 68, 19, 2); ctx.stroke();
    ctx.fillStyle = 'rgba(' + s.color + ',' + 0.9 * flick + ')';
    ctx.font = '500 8px "DM Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.icon + ' ' + s.label, s.x, s.y, 62);
  }
}

function drawNeonGlow() {
  if (!started) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of neonSigns) {
    const sx = s.x - cam.x, sy = s.y - cam.y;
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
    const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 60);
    g.addColorStop(0, 'rgba(' + s.color + ',.07)');
    g.addColorStop(1, 'rgba(' + s.color + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 60, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawDarkness() {
  const px = player.x - cam.x, py = player.y - cam.y;
  const base = started ? (ended ? 0.58 : 0.72) : 0.42;
  const radius = Math.max(W, H) * 0.68;
  const mx = started ? px : W * 0.7, my = started ? py : H * 0.46;
  const g = ctx.createRadialGradient(mx, my, 55, mx, my, radius);
  g.addColorStop(0, 'rgba(3,8,7,0)');
  g.addColorStop(0.34, 'rgba(3,8,7,' + (base * 0.2) + ')');
  g.addColorStop(0.7, 'rgba(3,7,6,' + (base * 0.65) + ')');
  g.addColorStop(1, 'rgba(2,5,4,' + base + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // oscurecer aún más los bordes
  const e = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
  e.addColorStop(0, 'rgba(1,4,3,0)');
  e.addColorStop(1, 'rgba(1,4,3,.26)');
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, W, H);
}

function drawFlashlight() {
  if (!started) return;
  const px = player.x - cam.x, py = player.y - cam.y;
  const low = player.hp / player.maxHp < 0.35;
  const flick = low ? (0.75 + 0.25 * Math.sin(elapsed * 22) * Math.sin(elapsed * 7.3)) : 0.92;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(player.angle);
  ctx.translate(12, 0);
  ctx.globalCompositeOperation = 'lighter';
  const cg = ctx.createRadialGradient(0, 0, 12, 0, 0, 405);
  cg.addColorStop(0, 'rgba(255,246,205,' + 0.24 * flick + ')');
  cg.addColorStop(0.38, 'rgba(255,240,185,' + 0.12 * flick + ')');
  cg.addColorStop(0.8, 'rgba(255,232,165,' + 0.04 * flick + ')');
  cg.addColorStop(1, 'rgba(255,230,160,0)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 405, -0.33, 0.33); ctx.closePath(); ctx.fill();
  // núcleo
  const core = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
  core.addColorStop(0, 'rgba(255,245,205,' + 0.10 * flick + ')');
  core.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, 60, 0, TAU); ctx.fill();
  ctx.restore();

  if (flashTime > 0) {
    const fx = flashX - cam.x, fy = flashY - cam.y;
    const fg = ctx.createRadialGradient(fx, fy, 2, fx, fy, 120);
    fg.addColorStop(0, 'rgba(255,225,150,.55)');
    fg.addColorStop(1, 'rgba(255,210,120,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, 120, 0, TAU); ctx.fill();
  }
}

function drawRain() {
  ctx.save();
  ctx.strokeStyle = 'rgba(185,205,200,.11)';
  ctx.lineWidth = 1;
  for (const d of rain) {
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * 0.25, d.y + d.len); ctx.stroke();
  }
  ctx.restore();
}

function drawFog() {
  const t = ambient * 9;
  for (let i = 0; i < 3; i++) {
    const x = (W * 0.2 + Math.sin(t * 0.02 + i * 2.4) * W * 0.35 + i * W * 0.32) % (W + 400) - 200;
    const y = H * 0.55 + Math.cos(t * 0.016 + i) * H * 0.2;
    const g = ctx.createRadialGradient(x, y, 20, x, y, 260);
    g.addColorStop(0, 'rgba(190,210,200,.028)');
    g.addColorStop(1, 'rgba(190,210,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 260, 0, TAU); ctx.fill();
  }
}

function drawMinimap() {
  if (!started || ended || W < 780) return;
  const mw = 168, mh = 116, x = W - 24 - mw, y = 74;
  ctx.save();
  ctx.fillStyle = 'rgba(10,15,13,.89)';
  ctx.fillRect(x, y, mw, mh);
  ctx.strokeStyle = 'rgba(220,235,210,.18)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, mw - 1, mh - 1);
  ctx.fillStyle = 'rgba(211,251,100,.7)';
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('MAPA TÁCTICO · SECTOR 07', x + 7, y + 5);
  const pad = 7, top = 17;
  const sx = (mw - pad * 2) / WORLD.w, sy = (mh - top - pad) / WORLD.h;
  const mx = (wx) => x + pad + wx * sx;
  const my = (wy) => y + top + wy * sy;
  ctx.fillStyle = 'rgba(122,146,125,.55)';
  for (const b of buildings) ctx.fillRect(mx(b.x), my(b.y), b.w * sx, b.h * sy);
  // muestras no recuperadas
  for (const t of terminals) {
    if (t.got) continue;
    ctx.fillStyle = 'rgba(211,251,100,' + (0.5 + 0.5 * Math.sin(ambient * 4)) + ')';
    ctx.beginPath(); ctx.arc(mx(t.x), my(t.y), 2.4, 0, TAU); ctx.fill();
  }
  // enemigos
  for (const z of enemies) {
    ctx.fillStyle = z.aggro ? 'rgba(243,92,75,.8)' : 'rgba(160,110,100,.45)';
    ctx.fillRect(mx(z.x) - 1, my(z.y) - 1, 2, 2);
  }
  if (boss && boss.alive) {
    ctx.fillStyle = 'rgba(243,92,75,1)';
    ctx.beginPath(); ctx.arc(mx(boss.x), my(boss.y), 3.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(243,92,75,.4)';
    ctx.beginPath(); ctx.arc(mx(boss.x), my(boss.y), 6 + Math.sin(ambient * 4) * 2, 0, TAU); ctx.stroke();
  }
  // extracción
  ctx.strokeStyle = exit.active ? 'rgba(211,251,100,.9)' : 'rgba(170,180,160,.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(mx(exit.x), my(exit.y), 3.5, 0, TAU); ctx.stroke();
  // jugador
  const px = mx(player.x), py = my(player.y);
  ctx.fillStyle = '#d3fb64';
  ctx.beginPath(); ctx.arc(px, py, 2.6, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(211,251,100,.7)';
  ctx.beginPath(); ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(player.angle) * 7, py + Math.sin(player.angle) * 7); ctx.stroke();
  ctx.restore();
}

function drawBossBar() {
  if (!boss || !boss.alive || !started || ended) return;
  const w = Math.min(340, W - 90);
  const x = (W - w) / 2, y = W < 760 ? 120 : 122;
  const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,11,.85)';
  ctx.fillRect(x - 8, y - 17, w + 16, 34);
  ctx.strokeStyle = 'rgba(243,92,75,.3)';
  ctx.strokeRect(x - 7.5, y - 16.5, w + 15, 33);
  ctx.fillStyle = 'rgba(243,92,75,.9)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('T-07 · TIRANO', x, y - 7);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(220,228,215,.55)';
  ctx.fillText(Math.max(0, Math.ceil(boss.hp)) + ' / ' + boss.maxHp, x + w, y - 7);
  ctx.fillStyle = '#2a2624';
  ctx.fillRect(x, y + 1, w, 5);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#a52e27'); g.addColorStop(1, '#f35c4b');
  ctx.fillStyle = g;
  ctx.fillRect(x, y + 1, w * ratio, 5);
  ctx.restore();
}

function drawDamageFx() {
  const hp = player.hp / player.maxHp;
  let a = 0;
  if (player.inv > 0) a = 0.24;
  if (hp < 0.55) a = Math.max(a, (0.55 - hp) * 0.75);
  if (a <= 0.01) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.68);
  g.addColorStop(0, 'rgba(120,12,10,0)');
  g.addColorStop(1, 'rgba(160,20,16,' + clamp(a, 0, 0.55) + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (hp < 0.3) {
    ctx.fillStyle = 'rgba(243,92,75,' + (0.35 + 0.3 * Math.sin(elapsed * 8)) + ')';
    ctx.font = '500 9px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SANGRE CRÍTICA · BUSCA UN BOTIQUÍN [F]', W / 2, H - 130);
  }
}

function drawCrosshair() {
  if (isTouch || !started || ended || !mouseSeen) return;
  const x = mouse.x, y = mouse.y;
  ctx.save();
  ctx.strokeStyle = 'rgba(211,251,100,.75)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y);
  ctx.moveTo(x + 3, y); ctx.lineTo(x + 9, y);
  ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 3);
  ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9);
  ctx.stroke();
  ctx.fillStyle = 'rgba(211,251,100,.9)';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.restore();
}


function drawObjectiveMarkers() {
  if (!started || ended) return;
  const targets = [];
  for (const t of terminals) if (!t.got) targets.push({ x: t.x, y: t.y, label: 'MUESTRA', color: '211,251,100' });
  if (exit.active) {
    if (boss && boss.alive) targets.push({ x: boss.x, y: boss.y, label: 'T-07', color: '243,92,75' });
    else targets.push({ x: exit.x, y: exit.y, label: 'EXTRACCIÓN', color: '211,251,100' });
  }
  for (const t of targets) {
    const sx = t.x - cam.x, sy = t.y - cam.y;
    const d = Math.hypot(t.x - player.x, t.y - player.y);
    const on = sx > 44 && sx < W - 44 && sy > 118 && sy < H - 120;
    if (on) {
      const pulse = 0.5 + 0.5 * Math.sin(ambient * 4);
      ctx.save();
      ctx.translate(sx, sy - 34);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = 'rgba(' + t.color + ',' + (0.55 + pulse * 0.4) + ')';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
      ctx.fillStyle = 'rgba(' + t.color + ',.75)';
      ctx.font = '500 8px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label + ' · ' + Math.round(d / 10) + 'm', sx, sy - 46);
    } else {
      const cx = W / 2, cy = H / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      const rx = clamp(cx + Math.cos(a) * (W / 2 - 34), 30, W - 30);
      const ry = clamp(cy + Math.sin(a) * (H / 2 - 78), 136, H - 118);
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(' + t.color + ',.8)';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(' + t.color + ',.7)';
      ctx.font = '500 8px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label + ' ' + Math.round(d / 10) + 'm', rx, ry + 20);
    }
  }
}

function drawGlowEyes() {
  if (!started) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const z of enemies) {
    if (!z.aggro) continue;
    const sx = z.x - cam.x, sy = z.y - cam.y;
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
    const a = z.angle;
    const hx = z.x + Math.cos(a) * 14, hy = z.y + Math.sin(a) * 14;
    for (const off of [-2.4, 2.4]) {
      const ex = hx + Math.cos(a + Math.PI / 2) * off, ey = hy + Math.sin(a + Math.PI / 2) * off;
      const g = ctx.createRadialGradient(ex - cam.x, ey - cam.y, 0, ex - cam.x, ey - cam.y, 9);
      g.addColorStop(0, 'rgba(255,95,70,.85)'); g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex - cam.x, ey - cam.y, 9, 0, TAU); ctx.fill();
    }
  }
  if (boss && boss.alive) {
    const a = boss.angle, hx = boss.x + Math.cos(a) * 24, hy = boss.y + Math.sin(a) * 24;
    for (const off of [-4, 4]) {
      const ex = hx + Math.cos(a + Math.PI / 2) * off, ey = hy + Math.sin(a + Math.PI / 2) * off;
      const g = ctx.createRadialGradient(ex - cam.x, ey - cam.y, 0, ex - cam.x, ey - cam.y, 14);
      g.addColorStop(0, 'rgba(255,85,60,.9)'); g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex - cam.x, ey - cam.y, 14, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}


function drawLightingLayer() {
  drawDarkness();
  if (!lightCanvas) return;
  const main = ctx;
  ctx = lightCtx;
  const sc = lightCanvas.width / W;
  ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawNeonGlow();
  drawFlashlight();
  ctx = main;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(lightCanvas, 0, 0, W, H);
  ctx.restore();
  drawFog();
}

function drawScreenFx() {
  if (lightning > 0) {
    ctx.fillStyle = 'rgba(185,215,220,' + (lightning / 0.14) * 0.18 + ')';
    ctx.fillRect(0, 0, W, H);
  }
  drawDamageFx();
  drawObjectiveMarkers();
  drawGlowEyes();
  drawBossBar();
  drawMinimap();
  drawCrosshair();
}

/* ---------------- main ---------------- */
function updateRain(dt) {
  for (const d of rain) {
    d.y += d.spd * dt;
    d.x -= d.spd * 0.23 * dt;
    if (d.y > H + 20) { d.y = -20; d.x = rand(-80, W + 80); }
    if (d.x < -30) d.x = W + 20;
  }
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!started) {
    cam.x = clamp(800 - W / 2 + Math.sin(ambient * 0.06) * 55, 0, Math.max(0, WORLD.w - W));
    cam.y = clamp(1000 - H / 2 + Math.cos(ambient * 0.045) * 40, 0, Math.max(0, WORLD.h - H));
  }

  let shx = 0, shy = 0;
  if (shake > 0) { shx = rand(-shake, shake); shy = rand(-shake, shake); }

  ctx.save();
  ctx.translate(-cam.x + shx, -cam.y + shy);
  if (worldCache) {
    const vx = clamp(cam.x, 0, Math.max(0, WORLD.w - W));
    const vy = clamp(cam.y, 0, Math.max(0, WORLD.h - H));
    const vw = Math.min(W, WORLD.w - vx), vh = Math.min(H, WORLD.h - vy);
    ctx.drawImage(worldCache, vx, vy, vw, vh, vx, vy, vw, vh);
  } else { drawGround(); drawSidewalks(); drawBuildings(); drawProps(); }
  drawDecals();
  drawLights();
  drawNeon();
  drawTerminals();
  drawExit();
  drawPickups();
  drawNotes();
  drawEnemies();
  drawBoss();
  drawParticles();
  ctx.restore();

  drawLightingLayer();
  ctx.save();
  ctx.translate(-cam.x + shx, -cam.y + shy);
  drawBullets();
  drawPlayer();
  ctx.restore();
  drawRain();
  drawScreenFx();
}

function frame(t) {
  if (window.__ZC_STOP) { requestAnimationFrame(frame); return; }
  const raw = (t - last) / 1000;
  const dt = clamp(raw || 0, 0, 0.05);
  last = t;
  ambient += dt;
  frames++;
  updateRain(dt);
  if (started && !ended && !paused) update(dt);
  else if (lightning > 0) lightning -= dt;
  draw();
  requestAnimationFrame(frame);
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildGroundPattern();
  lightCanvas = document.createElement('canvas');
  lightCanvas.width = Math.max(160, Math.ceil(W * 0.5));
  lightCanvas.height = Math.max(120, Math.ceil(H * 0.5));
  lightCtx = lightCanvas.getContext('2d');
  rain = [];
  for (let i = 0; i < 135; i++) rain.push({ x: rand(-40, W + 40), y: rand(-40, H), len: rand(7, 22), spd: rand(520, 950) });
  hud.classList.toggle('mobile', W < 760 || isTouch);
}


window.__ZC = {
  state() {
    return {
      started, ended, paused, modalOpen,
      player: { x: Math.round(player.x), y: Math.round(player.y), hp: Math.round(player.hp), level: player.level, xp: player.xp, ammo: player.ammo, reserve: player.reserve, med: player.med, reloadT: Number(player.reload.toFixed(2)) },
      samples: samplesCount(), exitActive: exit.active, bossAlive: !!(boss && boss.alive), kills: stats.kills, frames
    };
  },
  enemies() { return enemies.map((z) => ({ x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, aggro: z.aggro, dist: Math.round(Math.hypot(z.x - player.x, z.y - player.y)) })); },
  aimAt(x, y) { player.angle = Math.atan2(y - player.y, x - player.x); },
  boss() { return boss ? { x: boss.x, y: boss.y, hp: boss.hp } : null; },
  teleport(x, y) { player.x = clamp(x, 30, WORLD.w - 30); player.y = clamp(y, 30, WORLD.h - 30); cam.x = clamp(player.x - W / 2, 0, Math.max(0, WORLD.w - W)); cam.y = clamp(player.y - H / 2, 0, Math.max(0, WORLD.h - H)); },
  hurt(n) { hurtPlayer(n); },
  xp(n) { gainXp(n); },
  interact, shoot, reload, finish,
  spawnBoss, killBoss
};

window.addEventListener('resize', resize);
resize();
initWorld();
buildWorldCache();
updateHud();
requestAnimationFrame(frame);
})();
