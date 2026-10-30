// Иконки-картинки вместо эмодзи: берём силуэты из game-icons.net (CC BY 3.0) и красим их в игре градиентами.
// Здесь — какому эмодзи какая картинка и какой цвет. Запуск: npm run icons  →  src/ui/iconData.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const set = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@iconify-json/game-icons/icons.json'), 'utf8'));

// свои простые значки, которых нет в наборе (поле 512×512)
const rot = (pts, deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [256 + (x - 256) * c - (y - 256) * s, 256 + (x - 256) * s + (y - 256) * c]);
};
const poly = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
const ARROW = [[256, 40], [456, 260], [336, 260], [336, 472], [176, 472], [176, 260], [56, 260]];
const CUSTOM = {
  'x-triangle': poly([[256, 36], [490, 452], [22, 452]]),
  'x-arrow-ne': poly(rot(ARROW, 45)),
  'x-arrow-se': poly(rot(ARROW, 135)),
  'x-trend-up': poly([[24, 404], [184, 236], [272, 316], [392, 184], [336, 136], [488, 96], [456, 248], [416, 208], [276, 372], [188, 292], [72, 452]]),
  'x-trend-down': poly([[24, 108], [184, 276], [272, 196], [392, 328], [336, 376], [488, 416], [456, 264], [416, 304], [276, 140], [188, 220], [72, 60]]),
  'x-play': poly([[112, 48], [464, 256], [112, 464]]),
};

// эмодзи → [картинка, цвет]; цвета — TINTS в src/ui/icons.tsx
const MAP = {
  // ресурсы и показатели
  '💰': ['two-coins', 'gold'], '🪙': ['crown-coin', 'gold'], '💵': ['banknote', 'green'], '💸': ['pay-money', 'green'],
  '🧠': ['brain', 'pink'], '👥': ['meeple-group', 'cyan'], '⚖': ['scales', 'gold'], '🔺': ['x-triangle', 'red'],
  '💪': ['biceps', 'orange'], '🌾': ['wheat', 'gold'], '🔫': ['pistol-gun', 'steel'], '🧑‍🔬': ['microscope', 'blue'],
  '💎': ['gems', 'cyan'], '🏦': ['bank', 'ivory'],
  // вкладки и интерфейс
  '🗺': ['treasure-map', 'parchment'], '📜': ['scroll-unfurled', 'parchment'], '🏗': ['crane', 'orange'],
  '⚔': ['crossed-swords', 'steel'], '🏪': ['shop', 'orange'], '📊': ['histogram', 'blue'], '📰': ['newspaper', 'ivory'],
  '🗞': ['newspaper', 'ivory'], '▶': ['x-play', 'green'], '⏸': ['pause-button', 'steel'], '⏩': ['fast-forward-button', 'ivory'],
  '💾': ['save', 'blue'], '🔄': ['clockwise-rotation', 'cyan'], '📋': ['checklist', 'parchment'], '📬': ['mailbox', 'blue'],
  '📭': ['mailbox', 'steel'], '📨': ['envelope', 'ivory'], '✉': ['envelope', 'ivory'], '📎': ['paper-clip', 'steel'],
  '✍': ['quill-ink', 'ivory'], '📖': ['open-book', 'brown'], '📚': ['book-pile', 'brown'], '🎵': ['musical-notes', 'purple'],
  '🔊': ['speaker', 'ivory'], '📲': ['smartphone', 'steel'], '⌨': ['keyboard', 'steel'], '🖱': ['arrow-cursor', 'ivory'],
  '⏱': ['stopwatch', 'ivory'], '🟢': ['plain-circle', 'green'], '❔': ['help', 'gold'], '✨': ['sparkles', 'yellow'],
  '✅': ['check-mark', 'green'], '❌': ['cross-mark', 'red'], '🚫': ['cancel', 'red'], '⚠': ['hazard-sign', 'yellow'],
  '🔒': ['padlock', 'gold'], '🗝': ['key', 'gold'], '⬆': ['upgrade', 'green'], '↗': ['x-arrow-ne', 'green'],
  '↘': ['x-arrow-se', 'red'], '📈': ['x-trend-up', 'green'], '📉': ['x-trend-down', 'red'], '♾': ['infinity', 'purple'],
  '⚙': ['gears', 'steel'], '🧭': ['compass', 'gold'], '🎯': ['archery-target', 'red'], '📅': ['calendar', 'red'],
  '🗓': ['calendar', 'red'], '⏳': ['hourglass', 'gold'], '🎁': ['present', 'red'], '🏆': ['trophy-cup', 'gold'],
  '🥇': ['podium-winner', 'gold'], '🏅': ['medal', 'gold'], '🎖': ['ribbon-medal', 'gold'], '🌟': ['polar-star', 'yellow'],
  '⭐': ['round-star', 'yellow'], '👑': ['crown', 'gold'], '📢': ['megaphone', 'orange'], '📣': ['megaphone', 'orange'],
  '🧨': ['dynamite', 'red'], '🔨': ['claw-hammer', 'steel'], '🔧': ['monkey-wrench', 'steel'], '📦': ['cardboard-box-closed', 'brown'],
  // здания, чудеса, места
  '🏛': ['greek-temple', 'ivory'], '🏢': ['modern-city', 'blue'], '🏙': ['modern-city', 'blue'], '🏭': ['factory', 'steel'],
  '🎓': ['graduate-cap', 'blue'], '🏥': ['hospital-cross', 'red'], '⛪': ['church', 'ivory'], '⚓': ['anchor', 'blue'],
  '🏰': ['castle', 'steel'], '🏡': ['house', 'orange'], '🏫': ['school-bag', 'orange'], '🏚': ['damaged-house', 'brown'],
  '🗿': ['moai', 'steel'], '🗽': ['torch', 'green'], '🏯': ['defensive-wall', 'brown'], '🏟': ['laurels-trophy', 'gold'],
  '🕍': ['saint-basil-cathedral', 'gold'], '🧱': ['brick-wall', 'red'], '🛣': ['road', 'steel'], '🗼': ['lighthouse', 'red'],
  '🏕': ['camping-tent', 'green'], '🎪': ['camping-tent', 'red'],
  // наука и техника
  '🔬': ['microscope', 'blue'], '🧪': ['test-tubes', 'green'], '🧬': ['dna1', 'cyan'], '💊': ['pill', 'red'],
  '🩺': ['stethoscope', 'cyan'], '⚛': ['atom', 'cyan'], '💻': ['laptop', 'steel'], '🖥': ['server-rack', 'blue'],
  '🌀': ['vortex', 'purple'], '📡': ['radar-dish', 'steel'], '🤖': ['vintage-robot', 'steel'], '🦾': ['battle-mech', 'steel'],
  '🚀': ['rocket', 'orange'], '🛰': ['satellite', 'steel'], '🛸': ['delivery-drone', 'steel'], '💡': ['light-bulb', 'yellow'],
  '⚡': ['focused-lightning', 'yellow'], '🔭': ['telescope', 'blue'], '🚗': ['city-car', 'red'], '🚂': ['steam-locomotive', 'steel'],
  '✈': ['airplane', 'steel'], '⛵': ['sailboat', 'ivory'], '🌽': ['corn', 'yellow'], '🚜': ['farm-tractor', 'green'],
  '🛢': ['oil-drum', 'steel'], '⛏': ['gold-mine', 'brown'], '📐': ['pencil-ruler', 'blue'], '⚒': ['anvil-impact', 'steel'],
  // война и мир
  '🛡': ['checked-shield', 'blue'], '🗡': ['plain-dagger', 'steel'], '💂': ['rally-the-troops', 'red'], '🪖': ['brodie-helmet', 'olive'],
  '☢': ['radioactive', 'yellow'], '💥': ['bright-explosion', 'orange'], '🔥': ['fire', 'orange'], '🚨': ['siren', 'red'],
  '💀': ['death-skull', 'ivory'], '🏳': ['flying-flag', 'ivory'], '🏴': ['black-flag', 'steel'], '🏴‍☠': ['pirate-flag', 'steel'],
  '🕊': ['dove', 'ivory'], '☮': ['peace-dove', 'ivory'], '🤝': ['shaking-hands', 'gold'], '🤜': ['mailed-fist', 'orange'],
  '✊': ['fist', 'red'], '✋': ['open-palm', 'gold'], '🤐': ['silence', 'steel'], '🙅': ['thumb-down', 'orange'],
  '😞': ['thumb-down', 'steel'], '🙏': ['prayer', 'ivory'], '🚧': ['barricade', 'orange'], '⛓': ['crossed-chains', 'steel'],
  '🗳': ['vote', 'blue'], '🕵': ['spy', 'steel'], '🕶': ['sunglasses', 'steel'], '🕴': ['hooded-figure', 'steel'],
  '🏃': ['run', 'orange'], '💼': ['briefcase', 'brown'], '🌐': ['globe', 'blue'], '🌍': ['earth-africa-europe', 'cyan'],
  '📛': ['wax-seal', 'red'], '💔': ['broken-heart', 'red'], '🧳': ['rolling-suitcase', 'brown'],
  // тайная ложа
  '👁': ['all-seeing-eye', 'purple'], '🕯': ['candle-light', 'yellow'], '🚪': ['exit-door', 'brown'], '🪜': ['ladder', 'brown'],
  '📿': ['prayer-beads', 'purple'], '🦉': ['barn-owl', 'brown'], '🌙': ['moon', 'yellow'],
  // природа и бедствия
  '🌊': ['big-wave', 'blue'], '❄': ['snowflake-2', 'cyan'], '🧊': ['ice-cube', 'cyan'], '🌿': ['grass', 'green'],
  '🌲': ['pine-tree', 'green'], '🎄': ['pine-tree', 'green'], '🌳': ['tree-growth', 'green'], '🏜': ['desert', 'orange'],
  '⛰': ['mountains', 'steel'], '☀': ['sun', 'yellow'], '🌋': ['volcano', 'red'], '🌪': ['tornado', 'steel'],
  '⛈': ['lightning-storm', 'blue'], '🌫': ['dust-cloud', 'steel'], '🦠': ['virus', 'green'], '😷': ['gas-mask', 'green'],
  '☄': ['comet-spark', 'orange'], '🌻': ['sunflower', 'yellow'], '💦': ['droplets', 'blue'],
  // люди и жизнь
  '👶': ['baby-face', 'pink'], '🧓': ['beard', 'ivory'], '👷': ['mining-helmet', 'yellow'], '👵': ['yarn', 'pink'],
  '👨‍🍳': ['chef-toque', 'ivory'], '🧑‍🚀': ['astronaut-helmet', 'steel'], '🎅': ['santa-hat', 'red'], '😤': ['shouting', 'red'],
  '👽': ['alien-stare', 'green'], '🤹': ['juggler', 'purple'], '🎉': ['party-popper', 'pink'], '🎆': ['firework-rocket', 'pink'],
  '🎈': ['balloons', 'red'], '🎨': ['palette', 'purple'], '🖍': ['pencil', 'orange'], '✏': ['pencil', 'yellow'],
  '🪶': ['feather', 'ivory'], '🎸': ['guitar', 'orange'], '⚽': ['soccer-ball', 'ivory'], '♟': ['chess-pawn', 'ivory'],
  '🎒': ['backpack', 'red'], '🎣': ['fishing-pole', 'blue'], '💍': ['diamond-ring', 'cyan'], '💐': ['flowers', 'pink'],
  '🏺': ['amphora', 'brown'], '🍞': ['bread', 'brown'], '🥖': ['sliced-bread', 'brown'], '🥐': ['croissant', 'brown'],
  '🥧': ['pie-slice', 'brown'], '🍲': ['cooking-pot', 'orange'], '🍯': ['honey-jar', 'gold'], '🍎': ['shiny-apple', 'red'],
  '❤': ['hearts', 'red'], '💛': ['hearts', 'yellow'], '💗': ['hearts', 'pink'], '💞': ['nested-hearts', 'pink'],
  '💌': ['love-letter', 'pink'],
  // поздняя игра: сырьё, климат, вызовы, мегапроекты
  '⛽': ['oil-drum', 'brown'], '🔋': ['battery-pack', 'green'], '🌡': ['thermometer-hot', 'red'], '👴': ['beard', 'ivory'],
  '🚄': ['subway-train', 'blue'], '🚝': ['subway-train', 'cyan'], '♻': ['recycle', 'green'], '🌱': ['sprout', 'green'],
  '🤲': ['receive-money', 'gold'], '🌕': ['moon', 'ivory'], '🔴': ['ringed-planet', 'red'], '🏘': ['family-house', 'orange'],
  '🧩': ['puzzle', 'purple'], '💠': ['cyborg-face', 'cyan'], '🎧': ['headphones', 'purple'], '🥩': ['steak', 'red'],
  '🌵': ['cactus', 'green'], '🔌': ['plug', 'steel'], '🌦': ['sun-cloud', 'cyan'], '👾': ['alien-stare', 'green'],
  '🌌': ['galaxy', 'purple'], '🌠': ['comet-spark', 'orange'], '🎭': ['carnival-mask', 'purple'], '🎼': ['musical-score', 'purple'],
  // звери
  '🐾': ['paw-print', 'brown'], '🐈': ['cat', 'orange'], '🐕': ['sitting-dog', 'brown'], '🦴': ['crossed-bones', 'ivory'],
  '🐼': ['panda', 'ivory'], '🐘': ['elephant', 'steel'], '🐧': ['penguin', 'blue'], '🐻‍❄': ['polar-bear', 'ivory'],
  '🐠': ['clownfish', 'orange'], '🐟': ['circling-fish', 'blue'], '🦆': ['duck', 'yellow'], '🐝': ['bee', 'yellow'],
  '🐫': ['camel', 'brown'],
};

const paths = {};
const emoji = {};
for (const [e, [name, tint]] of Object.entries(MAP)) {
  if (!paths[name]) {
    if (CUSTOM[name]) paths[name] = CUSTOM[name];
    else {
      const ic = set.icons[name];
      if (!ic) throw new Error(`нет иконки ${name} (${e})`);
      if ((ic.width ?? set.width) !== 512 || (ic.height ?? set.height) !== 512) throw new Error(`${name}: не 512×512`);
      // в наборе только залитые контуры — склеиваем их в один путь
      const rest = ic.body.replace(/<path fill="currentColor" d="[^"]+"\/>/g, '');
      if (rest.trim()) throw new Error(`${name}: неожиданная разметка ${rest.slice(0, 80)}`);
      paths[name] = [...ic.body.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join('');
    }
  }
  emoji[e.replace(/️/g, '')] = [name, tint];
}

const out = `// Сгенерировано scripts/build-icons.mjs (npm run icons) — не править вручную.
// Силуэты: game-icons.net, CC BY 3.0 (авторы: Lorc, Delapouite и другие).
export const PATHS: Record<string, string> = ${JSON.stringify(paths, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, ',\n}')};

export const EMOJI: Record<string, [icon: string, tint: string]> = ${JSON.stringify(emoji).replace(/\],"/g, '],\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, ',\n}')};
`;
fs.writeFileSync(path.join(root, 'src/ui/iconData.ts'), out);
console.log(`иконок: ${Object.keys(paths).length}, эмодзи: ${Object.keys(emoji).length}, ${(out.length / 1024).toFixed(0)} КБ`);
