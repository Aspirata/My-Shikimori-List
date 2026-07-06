function generatePixelNoise() {
  const canvas = document.getElementById('pixelNoise');
  if (!canvas) return;

  const PIXEL = 20;
  const cols = Math.ceil(window.innerWidth  / PIXEL) + 1;
  const rows = Math.ceil(window.innerHeight / PIXEL) + 1;

  canvas.width  = cols;
  canvas.height = rows;
  canvas.style.width  = (cols * PIXEL) + 'px';
  canvas.style.height = (rows * PIXEL) + 'px';

  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);

  function gauss(mean, std) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const raw = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = gauss(238, 32);
  }

  const BLUR = 0.45;
  const smoothed = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
            sum += raw[ny * cols + nx];
            count++;
          }
        }
      }
      smoothed[i] = raw[i] * (1 - BLUR) + (sum / count) * BLUR;
    }
  }

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] < min) min = smoothed[i];
    if (smoothed[i] > max) max = smoothed[i];
  }
  const range = max - min || 1;

  const OUT_MIN = 150; // ← было 180, теперь тёмные пятна заметно темнее
  const OUT_MAX = 255;

  for (let i = 0; i < cols * rows; i++) {
    const t = (smoothed[i] - min) / range;
    const v = Math.round(OUT_MIN + t * (OUT_MAX - OUT_MIN));
    img.data[i * 4 + 0] = Math.min(255, v + 2);
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = Math.max(0, v - 3);
    img.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
}

// ── CONSTANTS ──
const STATUS_RU = {
  watching:   'Смотрю',
  completed:  'Просмотрено',
  planned:    'Запланировано',
  rewatching: 'Пересматриваю',
  on_hold:    'Отложено',
  dropped:    'Брошено',
};
const STATUS_ORDER = ['planned', 'watching', 'rewatching', 'completed', 'on_hold', 'dropped'];
const KIND_RU = {
  tv: 'Сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA',
  special: 'Special', tv_special: 'TV Special', music: 'Music',
};
const ANIME_STATUS_LABEL = {
  anons:   '[Анонс]',
  ongoing: '[Онгоинг]',
};

let allRates = [];
let activeStatus = 'all';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function goHome() {
  document.getElementById('landing').style.display = 'flex';
  document.getElementById('resultsPage').style.display = 'none';
  document.getElementById('headerSearch').style.display = 'none';
  allRates = [];
  activeStatus = 'all';
}

function loadFromHeader() {
  const val = document.getElementById('nickInputHeader').value.trim();
  if (!val) return;
  document.getElementById('nickInput').value = val;
  loadUser();
}

async function loadUser() {
  const nick = document.getElementById('nickInput').value.trim()
             || document.getElementById('nickInputHeader').value.trim();
  if (!nick) return;

  allRates = [];
  activeStatus = 'all';

  document.getElementById('landing').style.display = 'none';
  document.getElementById('resultsPage').style.display = 'flex';
  document.getElementById('headerSearch').style.display = 'flex';
  document.getElementById('nickInputHeader').value = nick;

  localStorage.setItem('shiki_last_nick', nick);

  const output = document.getElementById('output');
  output.value = '';
  output.placeholder = 'Загружаем данные…';

  try {
    const userRes = await fetch(
      `https://shikimori.io/api/users/${encodeURIComponent(nick)}`,
      { headers: { 'User-Agent': 'ShikimoriListExport/1.0' } }
    );
    if (!userRes.ok) throw new Error(userRes.status === 404
      ? `Пользователь «${nick}» не найден`
      : `Ошибка HTTP ${userRes.status}`);

    const user = await userRes.json();

    const avatarEl = document.getElementById('userAvatar');
    const avatarUrl = user.avatar
      ? (user.avatar.startsWith('http') ? user.avatar : 'https://shikimori.io' + user.avatar)
      : '';
    avatarEl.style.display = '';
    avatarEl.src = avatarUrl;
    avatarEl.onerror = () => { avatarEl.style.display = 'none'; };
    avatarEl.onload  = () => { avatarEl.style.display = ''; };

    document.getElementById('userName').textContent = user.nickname;
    document.getElementById('userProfileLink').href = `https://shikimori.io/${encodeURIComponent(user.nickname)}`;

    let page = 1;
    while (true) {
      const r = await fetch(
        `https://shikimori.io/api/users/${user.id}/anime_rates?limit=1000&page=${page}`,
        { headers: { 'User-Agent': 'ShikimoriListExport/1.0' } }
      );
      if (!r.ok) throw new Error(`Ошибка HTTP ${r.status}`);
      const chunk = await r.json();
      if (!chunk.length) break;
      allRates = allRates.concat(chunk);
      output.placeholder = `Загружено ${allRates.length} аниме…`;
      if (chunk.length < 1000) break;
      page++;
      await sleep(700);
    }

    output.placeholder = '';

    buildStatusNav();
    renderOutput();

  } catch (e) {
    output.placeholder = '';
    output.value = 'Ошибка: ' + e.message;
  }
}

function buildStatusNav() {
  const nav = document.getElementById('statusNav');
  nav.innerHTML = '';
  const statuses = [['all', 'Все'], ...STATUS_ORDER.map(s => [s, STATUS_RU[s]])];
  let first = true;
  statuses.forEach(([status, label]) => {
    const count = status === 'all'
      ? allRates.length
      : allRates.filter(r => r.status === status).length;
    if (count === 0 && status !== 'all') return;
    if (!first) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      nav.appendChild(sep);
    }
    first = false;
    const a = document.createElement('a');
    a.textContent = `${label} (${count})`;
    a.href = '#';
    a.dataset.status = status;
    if (status === activeStatus) a.className = 'active';
    a.onclick = (e) => { e.preventDefault(); switchTab(status); };
    nav.appendChild(a);
  });
}

function switchTab(status) {
  activeStatus = status;
  buildStatusNav();
  renderOutput();
}

function getFiltered() {
  let list = activeStatus === 'all'
    ? [...allRates]
    : allRates.filter(r => r.status === activeStatus);
  const sort = document.getElementById('sortSelect').value;
  const byName = (a, b) =>
    (a.anime.russian || a.anime.name).localeCompare(b.anime.russian || b.anime.name, 'ru');
  if (sort === 'score_desc') {
    list.sort((a, b) => {
      if (a.score && b.score) return b.score - a.score;
      if (a.score) return -1;  // a scored → a first
      if (b.score) return 1;   // b scored → b first
      return byName(a, b);     // both unscored → alphabetical
    });
  } else if (sort === 'score_asc') {
    list.sort((a, b) => {
      if (a.score && b.score) return a.score - b.score;
      if (a.score) return -1;
      if (b.score) return 1;
      return byName(a, b);
    });
  } else {
    list.sort(byName);
  }
  return list;
}

function renderOutput() {
  const output = document.getElementById('output');
  output.placeholder = '';

  const format    = document.getElementById('fmtSelect').value;
  const animeList = getFiltered();

  if (!animeList.length) {
    output.value = '(Список пуст)';
    return;
  }

  const formatters = {
    short:  formatShort,
    normal: formatNormal,
    full:   formatFull,
  };

  const sections = activeStatus === 'all'
    ? STATUS_ORDER
        .map(status => ({ label: STATUS_RU[status], items: animeList.filter(r => r.status === status) }))
        .filter(({ items }) => items.length > 0)
    : [{ label: STATUS_RU[activeStatus], items: animeList }];

  output.value = sections
    .map(({ label, items }, index) => {
      const header = label ? `${index > 0 ? '\n' : ''}== ${label} (${items.length}) ==\n` : '';
      const body   = items.map((rate, i) => formatters[format](rate, i + 1)).join('\n');
      return header + body;
    })
    .join('\n');
}

function formatShort(rate, index) {
  const { anime } = rate;
  const title = anime.russian || anime.name;
  const animeStatusTag = ANIME_STATUS_LABEL[anime.status] || '';

  const scoreStr = rate.score ? `оценка: ${rate.score}` : '';
  const rewatchStr = rate.rewatches > 0 ? `повторных просмотров: ${rate.rewatches}` : '';

  const extras = [scoreStr, rewatchStr].filter(Boolean).join(', ');
  const extrasStr = extras ? ` | ${extras}` : '';
  const statusTagStr = animeStatusTag ? ` ${animeStatusTag}` : '';

  return `${index}. ${title}${statusTagStr}${extrasStr}`;
}


function formatNormal(rate, index) {
  const { anime }  = rate;
  const title      = anime.russian || anime.name;
  const titleEn    = anime.name;
  const animeStatusTag = ANIME_STATUS_LABEL[anime.status] || '';

  const episodeStr = `эпизоды: ${rate.episodes || 0}/${anime.episodes || '?'}`;
  const scoreStr = rate.score ? `оценка: ${rate.score}` : '';
  const rewatchStr = rate.rewatches > 0 ? `повторных просмотров: ${rate.rewatches}` : '';

  const extras = [scoreStr, episodeStr, rewatchStr].filter(Boolean).join(', ');
  const extrasStr = extras ? ` | ${extras}` : '';
  const statusTagStr = animeStatusTag ? ` ${animeStatusTag}` : '';

  return `${index}. ${title} (${titleEn})${statusTagStr}${extrasStr}`;
}

function formatFull(rate, index) {
  const { anime }  = rate;
  const title      = anime.russian || anime.name;
  const titleEn    = anime.name;
  const animeStatusTag = ANIME_STATUS_LABEL[anime.status] || '';

  const kindStr    =  `Тип: ${KIND_RU[anime.kind] || anime.kind || '—'}`;
  const episodeStr = `Эпизоды: ${rate.episodes || 0}/${anime.episodes || '?'}`;
  const scoreStr   = rate.score ? `Оценка: ${rate.score}/10` : 'Оценка: -';
  const rewatchStr = rate.rewatches > 0 ? `Повторных просмотров: ${rate.rewatches}` : '';

  const extras = [kindStr, scoreStr, episodeStr, rewatchStr].filter(Boolean).join(' | ');
  const extrasStr = extras ? `${extras}` : '';

  const lines = [
    `${index}. ${title} (${titleEn}) ${animeStatusTag}`,
    `   ${extrasStr}`,
  ];

  lines.push(`   Ссылка: https://shikimori.io${anime.url}`, '');
  return lines.join('\n');
}

function copyOutput() {
  const val = document.getElementById('output').value;
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    const btn = document.querySelector('.btn-copy');
    const orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    btn.style.background = '#1b9a4e';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1800);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  let _noiseResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_noiseResizeTimer);
    _noiseResizeTimer = setTimeout(generatePixelNoise, 150);
  });
  generatePixelNoise();

  const savedNick = localStorage.getItem('shiki_last_nick');
  if (savedNick) {
    document.getElementById('nickInput').value = savedNick;
  }

  document.getElementById('nickInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUser();
  });
  document.getElementById('nickInputHeader').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadFromHeader();
  });
});