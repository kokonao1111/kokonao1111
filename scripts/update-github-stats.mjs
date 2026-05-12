import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "kokonao1111";
const OUT_FILE = "assets/github-stats.svg";
const README_FILE = "README.md";
const TIME_ZONE = "Asia/Tokyo";

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

function formatDate(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return `${month}.${day}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function streakStats(days) {
  const activeDays = days.filter((day) => day.date <= tokyoToday);
  let current = 0;
  let currentStart = null;
  let currentEnd = null;

  for (let index = activeDays.length - 1; index >= 0; index -= 1) {
    if (activeDays[index].contributionCount <= 0) {
      if (activeDays[index].date === tokyoToday) {
        continue;
      }
      break;
    }

    current += 1;
    currentStart = activeDays[index].date;
    currentEnd ??= activeDays[index].date;
  }

  let longest = 0;
  let longestStart = null;
  let longestEnd = null;
  let run = 0;
  let runStart = null;

  for (const day of activeDays) {
    if (day.contributionCount > 0) {
      run += 1;
      runStart ??= day.date;

      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = day.date;
      }
      continue;
    }

    run = 0;
    runStart = null;
  }

  return {
    current,
    currentRange: current > 0 ? `${formatDate(currentStart)} - ${formatDate(currentEnd)}` : "-",
    longest,
    longestRange: longest > 0 ? `${formatDate(longestStart)} - ${formatDate(longestEnd)}` : "-",
  };
}

async function updateReadmeCacheKey() {
  const readme = await readFile(README_FILE, "utf8");
  const nextReadme = readme.replace(
    /src="(?:https:\/\/raw\.githubusercontent\.com\/kokonao1111\/kokonao1111\/main\/)?\.?\/?assets\/github-stats\.svg(?:\?v=[^"]*)?"/,
    `src="./assets/github-stats.svg?v=${cacheKey}"`,
  );

  if (nextReadme === readme) {
    throw new Error("Could not find github-stats.svg image in README.md");
  }

  await writeFile(README_FILE, nextReadme);
}

async function fetchContributionDays() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }

  const start = `${tokyoYear}-01-01T00:00:00+09:00`;
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
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
      "user-agent": `${USERNAME}-profile-stats`,
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USERNAME,
        from: start,
        to: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  const calendar = payload.data.user.contributionsCollection.contributionCalendar;
  return {
    total: calendar.totalContributions,
    days: calendar.weeks.flatMap((week) => week.contributionDays),
  };
}

function renderSvg({ total, current, currentRange, longest, longestRange }) {
  const yearRange = `${tokyoYear}.1.1 - 今`;
  const updatedAt = `${tokyoYear}.${Number(tokyoMonth)}.${Number(tokyoDay)} ${tokyoHour}:${tokyoMinute} JST`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 990 390" width="495" height="195" role="img" aria-label="GitHub contributions stats">
  <title>GitHub contributions stats</title>
  <style>
    .border { fill: #0d1117; stroke: #e4e2e2; stroke-width: 2; }
    .divider { stroke: #e4e2e2; stroke-width: 2; }
    .number { fill: #006aff; font: 700 58px "Segoe UI", Ubuntu, sans-serif; }
    .label { fill: #0587d8; font: 700 28px "Segoe UI", Ubuntu, sans-serif; }
    .range { fill: #4b9aa4; font: 600 23px "Segoe UI", Ubuntu, sans-serif; }
    .small { fill: #4b9aa4; font: 500 16px "Segoe UI", Ubuntu, sans-serif; }
  </style>
  <rect class="border" x="1" y="1" width="988" height="388" rx="20" />
  <line class="divider" x1="330" y1="55" x2="330" y2="310" />
  <line class="divider" x1="660" y1="55" x2="660" y2="310" />

  <g text-anchor="middle">
    <text class="number" x="165" y="128">${escapeXml(total)}</text>
    <text class="label" x="165" y="200">総コントリビューション数</text>
    <text class="range" x="165" y="262">${escapeXml(yearRange)}</text>
    <text class="small" x="165" y="306">30分ごとに自動更新</text>

    <circle cx="495" cy="143" r="80" fill="none" stroke="#006aff" stroke-width="10" />
    <text class="number" x="495" y="165">${escapeXml(current)}</text>
    <text class="label" x="495" y="258">現在のストリーク</text>
    <text class="range" x="495" y="310">${escapeXml(currentRange)}</text>

    <text class="number" x="825" y="128">${escapeXml(longest)}</text>
    <text class="label" x="825" y="200">最長のストリーク</text>
    <text class="range" x="825" y="262">${escapeXml(longestRange)}</text>
    <text class="small" x="825" y="306">Updated ${escapeXml(updatedAt)}</text>
  </g>
</svg>
`;
}

const {
  year: tokyoYear,
  month: tokyoMonth,
  day: tokyoDay,
  hour: tokyoHour,
  minute: tokyoMinute,
} = tokyoParts();
const tokyoToday = `${tokyoYear}-${tokyoMonth}-${tokyoDay}`;
const cacheKey = `${tokyoToday.replaceAll("-", "")}${tokyoHour}${tokyoMinute}`;
const fallback = {
  total: 106,
  current: 4,
  currentRange: "5.9 - 5.12",
  longest: 4,
  longestRange: "5.9 - 5.12",
};

const contributions = await fetchContributionDays();
const stats = contributions
  ? { total: contributions.total, ...streakStats(contributions.days) }
  : fallback;

await mkdir("assets", { recursive: true });
await writeFile(OUT_FILE, renderSvg(stats));
await updateReadmeCacheKey();
console.log(`Updated ${OUT_FILE} and ${README_FILE}`);
