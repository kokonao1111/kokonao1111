// 外部サービス（github-readme-activity-graph）がデプロイ停止したので、同等のグラフを自前で生成する。
// 直近1年のコントリビューションを週ごとに集計して折れ線＋エリアで描く。
import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "kokonao1111";
const OUT_FILE = "assets/activity-graph.svg";
const README_FILE = "README.md";

// viewBox は 2 倍で作り、表示は 1/2 にして高解像度で描く
const W = 1720;
const H = 560;
const PAD_L = 96;
const PAD_R = 44;
const PAD_T = 118;
const PAD_B = 92;

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const BG = "#0d1117";
const BORDER = "#e4e2e2";
const LINE = "#58a6ff";
const GRID = "#30363d";
const MUTED = "#7d8590";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchCalendar() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const to = new Date();
  const from = new Date(to.getTime() - 364 * 24 * 60 * 60 * 1000);
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks { firstDay contributionDays { contributionCount } }
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
      "user-agent": `${USERNAME}-activity-graph`,
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

  return payload.data.user.contributionsCollection.contributionCalendar;
}

// 目盛りが半端な数にならないよう、切りのいい上限に丸める
function niceMax(value) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function renderSvg(calendar) {
  const weeks = calendar.weeks.map((week) => ({
    firstDay: week.firstDay,
    total: week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0),
  }));

  const max = niceMax(Math.max(1, ...weeks.map((week) => week.total)));
  const stepX = PLOT_W / Math.max(1, weeks.length - 1);
  const pointX = (index) => PAD_L + index * stepX;
  const pointY = (value) => PAD_T + PLOT_H - (value / max) * PLOT_H;

  const line = weeks
    .map((week, index) => `${index === 0 ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(week.total).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pointX(weeks.length - 1).toFixed(1)} ${PAD_T + PLOT_H} L${PAD_L} ${PAD_T + PLOT_H} Z`;

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = PAD_T + PLOT_H - ratio * PLOT_H;
      return (
        `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1.5"/>` +
        `<text class="axis" x="${PAD_L - 20}" y="${(y + 8).toFixed(1)}" text-anchor="end">${Math.round(ratio * max)}</text>`
      );
    })
    .join("\n  ");

  // 月が変わる週にだけラベルを置く
  let lastMonth = null;
  const monthLabels = weeks
    .map((week, index) => {
      const month = Number(week.firstDay.slice(5, 7));
      if (month === lastMonth) return "";
      lastMonth = month;
      const year = week.firstDay.slice(2, 4);
      return `<text class="axis" x="${pointX(index).toFixed(1)}" y="${H - PAD_B + 44}" text-anchor="middle">${year}/${String(month).padStart(2, "0")}</text>`;
    })
    .filter(Boolean)
    .join("\n  ");

  const dots = weeks
    .map((week) => week.total)
    .map((total, index) => `<circle cx="${pointX(index).toFixed(1)}" cy="${pointY(total).toFixed(1)}" r="5" fill="${LINE}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}" role="img" aria-label="直近1年のコントリビューション推移（合計 ${calendar.totalContributions} 件）">
  <title>Contribution Activity</title>
  <style>
    text { font-family: "Segoe UI", Ubuntu, sans-serif; }
    .title { fill: ${LINE}; font-size: 32px; font-weight: 700; }
    .sub { fill: ${MUTED}; font-size: 22px; font-weight: 600; }
    .axis { fill: ${MUTED}; font-size: 20px; font-weight: 500; }
  </style>
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${LINE}" stop-opacity=".45"/>
      <stop offset="100%" stop-color="${LINE}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="${BG}" stroke="${BORDER}" stroke-width="2"/>
  <text class="title" x="${PAD_L}" y="62">Contribution Activity</text>
  <text class="sub" x="${W - PAD_R}" y="62" text-anchor="end">${calendar.totalContributions} contributions · 直近1年</text>
  ${gridLines}
  <path d="${area}" fill="url(#fade)"/>
  <path d="${line}" fill="none" stroke="${LINE}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${monthLabels}
</svg>
`;
}

async function updateReadme(stamp) {
  const readme = await readFile(README_FILE, "utf8");
  const pattern = /src="(?:https:\/\/github-readme-activity-graph[^"]*|\.?\/?assets\/activity-graph\.svg(?:\?v=[^"]*)?)"/;

  if (!pattern.test(readme)) {
    throw new Error("Could not find activity graph image in README.md");
  }

  await writeFile(README_FILE, readme.replace(pattern, `src="./assets/activity-graph.svg?v=${stamp}"`));
}

const calendar = await fetchCalendar();
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);

await mkdir("assets", { recursive: true });
await writeFile(OUT_FILE, renderSvg(calendar));
await updateReadme(stamp);
console.log(`Updated ${OUT_FILE} (${calendar.weeks.length} weeks, ${calendar.totalContributions} contributions)`);
