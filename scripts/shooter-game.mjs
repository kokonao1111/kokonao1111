// プロフィール上で遊べるターン制シューター。
// Issue のタイトル（shooter: left / right / fire / reset）を1手として受け取り、
// 盤面 SVG と状態 JSON を更新する。
import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "kokonao1111";
const STATE_FILE = "assets/shooter-state.json";
const BOARD_FILE = "assets/shooter-board.svg";
const README_FILE = "README.md";
const TIME_ZONE = "Asia/Tokyo";
const DAYS = 14; // 直近14日ぶんを敵にする

// --- レイアウト ---------------------------------------------------------
const COL_W = 38;
const BLOCK_W = 30;
const BLOCK_H = 16;
const BLOCK_GAP = 4;
const MAX_BLOCKS = 4;
const PAD = 22;
const HUD_H = 50;
const STACK_H = MAX_BLOCKS * (BLOCK_H + BLOCK_GAP);
const LABEL_H = 18;
const SHIP_GAP = 18;

const WIDTH = PAD * 2 + DAYS * COL_W;
const STACK_TOP = PAD + HUD_H;
const STACK_BOTTOM = STACK_TOP + STACK_H;
const LABEL_Y = STACK_BOTTOM + 14;
const SHIP_NOSE_Y = STACK_BOTTOM + LABEL_H + SHIP_GAP;
const HEIGHT = SHIP_NOSE_Y + 30 + PAD;

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
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// 期間内の最大値を基準にした相対しきい値。1日の貢献数が多い時期でも段差が出る
function blocksFor(count, max) {
  if (count <= 0) return 0;
  if (count <= max * 0.25) return 1;
  if (count <= max * 0.5) return 2;
  if (count <= max * 0.75) return 3;
  return 4;
}

async function fetchRecentDays() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }

  const to = new Date();
  const from = new Date(to.getTime() - (DAYS + 2) * 24 * 60 * 60 * 1000);
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
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
      "user-agent": `${USERNAME}-shooter`,
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

  const days = payload.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .filter((day) => day.date <= today);

  return days.slice(-DAYS);
}

function fallbackDays() {
  return Array.from({ length: DAYS }, (_, index) => ({
    date: `2026-07-${String(12 + index).padStart(2, "0")}`,
    contributionCount: [0, 3, 7, 1, 0, 12, 4, 2, 0, 6, 9, 1, 5, 8][index],
  }));
}

async function buildState() {
  const days = (await fetchRecentDays()) ?? fallbackDays();
  const max = Math.max(1, ...days.map((day) => day.contributionCount));
  const columns = days.map((day) => {
    const level = blocksFor(day.contributionCount, max);
    return { date: day.date, level, blocks: level };
  });

  return {
    columns,
    ship: Math.floor(DAYS / 2),
    shots: 0,
    total: columns.reduce((sum, column) => sum + column.blocks, 0),
    lastPlayer: null,
    lastAction: "reset",
    builtFor: today,
  };
}

async function loadState() {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (Array.isArray(state.columns) && state.columns.length === DAYS) {
      return state;
    }
  } catch {
    // 初回、または壊れていた場合は作り直す
  }
  return null;
}

function applyMove(state, action, player) {
  const next = { ...state, columns: state.columns.map((column) => ({ ...column })) };
  next.lastPlayer = player;
  next.lastAction = action;

  if (action === "left") {
    next.ship = Math.max(0, next.ship - 1);
  } else if (action === "right") {
    next.ship = Math.min(DAYS - 1, next.ship + 1);
  } else if (action === "fire") {
    next.shots += 1;
    const target = next.columns[next.ship];
    next.lastAction = target.blocks > 0 ? "hit" : "miss";
    if (target.blocks > 0) {
      target.blocks -= 1;
    }
  }

  return next;
}

function shipShape(y) {
  return (
    `<path class="hull" d="M0 ${y} L13 ${y + 30} L0 ${y + 22} L-13 ${y + 30} Z"/>` +
    `<circle class="cockpit" cx="0" cy="${y + 15}" r="2.8"/>` +
    `<rect class="flame" x="-6.5" y="${y + 22}" width="3.5" height="8" rx="1.75"/>` +
    `<rect class="flame" x="3" y="${y + 22}" width="3.5" height="8" rx="1.75"/>`
  );
}

function renderBoard(state) {
  const remaining = state.columns.reduce((sum, column) => sum + column.blocks, 0);
  const cleared = remaining === 0;
  const shipX = PAD + state.ship * COL_W + COL_W / 2;

  const blocks = state.columns
    .flatMap((column, c) => {
      const x = PAD + c * COL_W + (COL_W - BLOCK_W) / 2;
      return Array.from({ length: column.blocks }, (_, i) => {
        const y = STACK_TOP + i * (BLOCK_H + BLOCK_GAP);
        return `<rect x="${x}" y="${y}" width="${BLOCK_W}" height="${BLOCK_H}" rx="3" fill="${LEVEL_COLORS[column.level]}"/>`;
      });
    })
    .join("\n    ");

  const labels = state.columns
    .map((column, c) => {
      const x = PAD + c * COL_W + COL_W / 2;
      const [, month, day] = column.date.split("-");
      const active = c === state.ship;
      return `<text class="label${active ? " label-on" : ""}" x="${x}" y="${LABEL_Y}">${Number(month)}/${Number(day)}</text>`;
    })
    .join("\n    ");

  const status = cleared
    ? "ALL CLEAR!"
    : state.lastAction === "hit"
      ? "HIT!"
      : state.lastAction === "miss"
        ? "MISS"
        : state.lastAction === "reset"
          ? "READY"
          : "MOVE";

  const player = state.lastPlayer ? `@${state.lastPlayer}` : "-";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Playable contribution shooter board">
  <title>Contribution shooter — playable board</title>
  <style>
    .title { fill: #58a6ff; font: 700 15px "Segoe UI", Ubuntu, sans-serif; }
    .hud { fill: #7d8590; font: 600 12px "Segoe UI", Ubuntu, sans-serif; }
    .status { fill: ${cleared ? "#39d353" : "#e3b341"}; font: 700 13px "Segoe UI", Ubuntu, sans-serif; }
    .label { fill: #484f58; font: 500 9px "Segoe UI", Ubuntu, sans-serif; text-anchor: middle; }
    .label-on { fill: #ffd166; font-weight: 700; }
    .hull { fill: #58a6ff; }
    .cockpit { fill: #0d1117; }
    .flame { fill: #ff7b52; }
    .aim { stroke: #ffd166; stroke-width: 1.5; stroke-dasharray: 3 5; opacity: .35; }
    .clear { fill: #39d353; font: 700 26px "Segoe UI", Ubuntu, sans-serif; text-anchor: middle; }
  </style>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <text class="title" x="${PAD}" y="${PAD + 16}">CONTRIBUTION SHOOTER</text>
  <text class="hud" x="${PAD}" y="${PAD + 34}">SHOTS ${state.shots} · REMAINING ${remaining}/${state.total} · LAST ${escapeXml(player)}</text>
  <text class="status" x="${WIDTH - PAD}" y="${PAD + 16}" text-anchor="end">${status}</text>
  <line class="aim" x1="${shipX}" y1="${SHIP_NOSE_Y - 4}" x2="${shipX}" y2="${STACK_TOP}"/>
    ${blocks}
    ${labels}
  ${cleared ? `<text class="clear" x="${WIDTH / 2}" y="${STACK_TOP + STACK_H / 2 + 9}">ALL CLEAR!</text>` : ""}
  <g transform="translate(${shipX} 0)">
    ${shipShape(SHIP_NOSE_Y)}
  </g>
</svg>
`;
}

async function updateReadmeCacheKey(cacheKey) {
  const readme = await readFile(README_FILE, "utf8");
  const pattern = /src="\.?\/?assets\/shooter-board\.svg(?:\?v=[^"]*)?"/;

  // 置換前後が同じでも「見つからなかった」とは限らないので、有無は正規表現で判定する
  if (!pattern.test(readme)) {
    throw new Error("Could not find shooter-board.svg image in README.md");
  }

  await writeFile(
    README_FILE,
    readme.replace(pattern, `src="./assets/shooter-board.svg?v=${cacheKey}"`),
  );
}

const { year, month, day, hour, minute, second } = tokyoParts();
const today = `${year}-${month}-${day}`;
// 連続で手を指しても必ず変わるよう、秒まで含める
const cacheKey = `${year}${month}${day}${hour}${minute}${second}`;

// Issue タイトルは信用できない入力なので、既知のコマンドだけを取り出す
const rawTitle = (process.env.ISSUE_TITLE ?? "").toLowerCase();
const matched = rawTitle.match(/shooter\s*:\s*(left|right|fire|reset)/);
const action = matched ? matched[1] : "none"; // 知らないコマンドは黙って無視する
const player = (process.env.ISSUE_ACTOR ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 39);

let state = await loadState();
if (!state || action === "reset") {
  state = await buildState();
  state.lastPlayer = player || null;
} else if (action !== "none") {
  state = applyMove(state, action, player || state.lastPlayer);
}

await mkdir("assets", { recursive: true });
await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
await writeFile(BOARD_FILE, renderBoard(state));
await updateReadmeCacheKey(cacheKey);
console.log(`action=${action} ship=${state.ship} shots=${state.shots}`);
