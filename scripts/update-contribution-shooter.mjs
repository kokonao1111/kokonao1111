import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "kokonao1111";
const OUT_FILE = "assets/contribution-shooter.svg";
const README_FILE = "README.md";
const TIME_ZONE = "Asia/Tokyo";

// --- レイアウト ---------------------------------------------------------
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;
const ROWS = 7;
const PAD_X = 18;
const PAD_TOP = 14;
const GRID_H = ROWS * PITCH - GAP;
const SHIP_NOSE_Y = GRID_H + 20; // 自機の先端（グリッド座標系）
const BULLET_Y = SHIP_NOSE_Y - 4; // 弾の初期位置
const BULLET_H = 11;
const BULLET_TRAVEL = BULLET_Y + BULLET_H + 1; // 画面上端を抜けきる距離

// --- タイミング（秒） ---------------------------------------------------
const COLUMN_INTERVAL = 0.2; // 1列進むのにかかる時間
const BULLET_TIME = 0.4; // 弾が上端に達するまで
const TAIL = 1.8; // 全滅後、リセットするまでの間

const LEVEL_COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const BG = "#0d1117";
const BORDER = "#21262d";

function tokyoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

async function fetchWeeks() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }

  const to = new Date();
  const from = new Date(to.getTime() - 364 * 24 * 60 * 60 * 1000);
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": `${USERNAME}-contribution-shooter`,
    },
    body: JSON.stringify({
      query,
      variables: { login: USERNAME, from: from.toISOString(), to: to.toISOString() },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data.user.contributionsCollection.contributionCalendar.weeks;
}

// トークンが無いローカル実行でもレイアウト確認ができるよう、決定的なダミーを返す
function fallbackWeeks() {
  let seed = 20260725;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  return Array.from({ length: 53 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => ({
      date: `w${week}d${weekday}`,
      contributionCount: random() < 0.45 ? Math.ceil(random() * 9) : 0,
      weekday,
    })),
  );
}

function toGrid(weeks) {
  const counts = weeks.flatMap((week) =>
    week.contributionDays.map((day) => day.contributionCount),
  );
  const max = Math.max(1, ...counts);

  const level = (count) => {
    if (count <= 0) return 0;
    if (count <= max * 0.25) return 1;
    if (count <= max * 0.5) return 2;
    if (count <= max * 0.75) return 3;
    return 4;
  };

  return weeks.map((week) => {
    const column = Array.from({ length: ROWS }, () => 0);
    for (const day of week.contributionDays) {
      column[day.weekday] = level(day.contributionCount);
    }
    return column;
  });
}

function renderSvg(grid) {
  const columns = grid.length;
  const gridW = columns * PITCH - GAP;
  const svgW = gridW + PAD_X * 2;
  const svgH = PAD_TOP + SHIP_NOSE_Y + 42;

  const sweep = (columns - 1) * COLUMN_INTERVAL;
  const total = Number((sweep + BULLET_TIME + TAIL).toFixed(2));
  const speed = BULLET_TRAVEL / BULLET_TIME;
  const pct = (seconds) => Number(((seconds / total) * 100).toFixed(3));
  const RESET = 99.2; // ここから全マスが復活する

  const cells = [];
  const bullets = [];
  const keyframes = [];
  const names = [];

  grid.forEach((column, c) => {
    const x = c * PITCH;
    const fireAt = c * COLUMN_INTERVAL;
    let hasTarget = false;

    column.forEach((lv, r) => {
      const y = r * PITCH;
      if (lv === 0) {
        cells.push(
          `<rect class="cell" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${LEVEL_COLORS[0]}"/>`,
        );
        return;
      }

      hasTarget = true;
      const color = LEVEL_COLORS[lv];
      const hitAt = fireAt + (BULLET_Y - (y + CELL / 2)) / speed;
      const name = `h${c}_${r}`;
      const p0 = pct(hitAt);
      const p1 = pct(hitAt + 0.06);
      const p2 = pct(hitAt + 0.26);

      keyframes.push(
        `@keyframes ${name}{0%,${p0}%{opacity:1;fill:${color};transform:scale(1)}` +
          `${p1}%{opacity:1;fill:#ffffff;transform:scale(1.4)}` +
          `${p2}%,${RESET}%{opacity:0;fill:#ffffff;transform:scale(.2)}` +
          `100%{opacity:1;fill:${color};transform:scale(1)}}`,
      );
      names.push(`.${name}{animation-name:${name}}`);
      cells.push(
        `<rect class="cell hit ${name}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${color}"/>`,
      );
    });

    if (!hasTarget) {
      return;
    }

    const name = `b${c}`;
    const f0 = pct(fireAt);
    const f1 = pct(fireAt + 0.02);
    const f2 = pct(fireAt + BULLET_TIME - 0.02);
    const f3 = pct(fireAt + BULLET_TIME);

    keyframes.push(
      `@keyframes ${name}{0%,${f0}%{opacity:0;transform:translateY(0)}` +
        `${f1}%{opacity:1}${f2}%{opacity:1}` +
        `${f3}%,100%{opacity:0;transform:translateY(-${BULLET_TRAVEL}px)}}`,
    );
    names.push(`.${name}{animation-name:${name}}`);
    bullets.push(
      `<rect class="bullet ${name}" x="${x + CELL / 2 - 1.5}" y="${BULLET_Y}" width="3" height="${BULLET_H}" rx="1.5"/>`,
    );
  });

  const shipStart = CELL / 2;
  const shipEnd = (columns - 1) * PITCH + CELL / 2;
  keyframes.push(
    `@keyframes fly{0%{transform:translateX(${shipStart}px);opacity:0}` +
      `${pct(0.3)}%{opacity:1}` +
      `${pct(sweep)}%{transform:translateX(${shipEnd}px);opacity:1}` +
      `${pct(sweep + 0.9)}%,100%{transform:translateX(${shipEnd + 80}px);opacity:0}}`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" role="img" aria-label="GitHub contribution shooting game">
  <title>Contribution shooter</title>
  <style>
    .cell { transform-box: fill-box; transform-origin: 50% 50%; }
    .hit, .bullet {
      animation-duration: ${total}s;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
    }
    .bullet { fill: #ffd166; }
    .ship {
      animation: fly ${total}s linear infinite;
    }
    .hull { fill: #58a6ff; }
    .cockpit { fill: #0d1117; }
    .flame { fill: #ff7b52; animation: burn .28s steps(2, end) infinite; }
    @keyframes burn { 0% { opacity: 1 } 100% { opacity: .35 } }
    ${keyframes.join("\n    ")}
    ${names.join("")}
  </style>
  <rect width="${svgW}" height="${svgH}" rx="10" fill="${BG}" stroke="${BORDER}"/>
  <g transform="translate(${PAD_X} ${PAD_TOP})">
    ${cells.join("\n    ")}
    ${bullets.join("\n    ")}
    <g class="ship">
      <path class="hull" d="M0 ${SHIP_NOSE_Y} L14 ${SHIP_NOSE_Y + 32} L0 ${SHIP_NOSE_Y + 23} L-14 ${SHIP_NOSE_Y + 32} Z"/>
      <circle class="cockpit" cx="0" cy="${SHIP_NOSE_Y + 16}" r="3"/>
      <rect class="flame" x="-7" y="${SHIP_NOSE_Y + 24}" width="3.5" height="9" rx="1.75"/>
      <rect class="flame" x="3.5" y="${SHIP_NOSE_Y + 24}" width="3.5" height="9" rx="1.75"/>
    </g>
  </g>
</svg>
`;
}

async function updateReadmeCacheKey(cacheKey) {
  const readme = await readFile(README_FILE, "utf8");
  const nextReadme = readme.replace(
    /src="\.?\/?assets\/contribution-shooter\.svg(?:\?v=[^"]*)?"/,
    `src="./assets/contribution-shooter.svg?v=${cacheKey}"`,
  );

  if (nextReadme === readme) {
    throw new Error("Could not find contribution-shooter.svg image in README.md");
  }

  await writeFile(README_FILE, nextReadme);
}

const { year, month, day, hour, minute } = tokyoParts();
const cacheKey = `${year}${month}${day}${hour}${minute}`;

const weeks = (await fetchWeeks()) ?? fallbackWeeks();
const grid = toGrid(
  weeks.map((week) => (Array.isArray(week) ? { contributionDays: week } : week)),
);

await mkdir("assets", { recursive: true });
await writeFile(OUT_FILE, renderSvg(grid));
await updateReadmeCacheKey(cacheKey);
console.log(`Updated ${OUT_FILE} and ${README_FILE}`);
