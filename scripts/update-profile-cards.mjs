// 外部サービス（github-profile-summary-cards）が落ちていたので、同等のカードを自前で生成する。
// プロフィール概要と使用言語の内訳を GitHub API から直接取得して SVG にする。
import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "kokonao1111";
const SUMMARY_FILE = "assets/profile-summary.svg";
const LANGUAGES_FILE = "assets/top-languages.svg";
const README_FILE = "README.md";

// viewBox は 2 倍で作り、表示は 1/2 にして高解像度で描く（github-stats.svg と同じ方針）
const W = 700;
const H = 440;
const PAD = 30;

const BG = "#0d1117";
const BORDER = "#e4e2e2";
const ACCENT = "#006aff";
const LABEL = "#7d8590";
const VALUE = "#e6edf3";
const OTHER_COLOR = "#6e7681";

// 5 + Other で2列3行にきれいに収まる
const TOP_LANGUAGES = 5;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchProfile() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const query = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          totalRepositoriesWithContributedCommits
        }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name color } }
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
      "user-agent": `${USERNAME}-profile-cards`,
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data.user;
}

function summarize(user) {
  const repos = user.repositories.nodes;
  const contributions = user.contributionsCollection;
  const [year, month, day] = user.createdAt.slice(0, 10).split("-").map(Number);

  return {
    stars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
    commits: contributions.totalCommitContributions,
    pullRequests: contributions.totalPullRequestContributions,
    reviews: contributions.totalPullRequestReviewContributions,
    contributedTo: contributions.totalRepositoriesWithContributedCommits,
    repoCount: user.repositories.totalCount,
    followers: user.followers.totalCount,
    since: `${year}.${month}.${day}`,
  };
}

function languageShares(user) {
  const totals = new Map();

  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const current = totals.get(edge.node.name) ?? { size: 0, color: edge.node.color };
      current.size += edge.size;
      totals.set(edge.node.name, current);
    }
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1].size - a[1].size);
  const grand = sorted.reduce((sum, [, item]) => sum + item.size, 0) || 1;
  const top = sorted.slice(0, TOP_LANGUAGES).map(([name, item]) => ({
    name,
    color: item.color ?? OTHER_COLOR,
    share: (item.size / grand) * 100,
  }));

  const rest = sorted.slice(TOP_LANGUAGES).reduce((sum, [, item]) => sum + item.size, 0);
  if (rest > 0) {
    top.push({ name: "Other", color: OTHER_COLOR, share: (rest / grand) * 100 });
  }

  return top;
}

const CARD_STYLE = `
    .frame { fill: ${BG}; stroke: ${BORDER}; stroke-width: 2; }
    text { font-family: "Segoe UI", Ubuntu, sans-serif; }
    .title { fill: ${ACCENT}; font-size: 23px; font-weight: 700; letter-spacing: 1.5px; }
    .label { fill: ${LABEL}; font-size: 19px; font-weight: 600; }
    .value { fill: ${VALUE}; font-size: 30px; font-weight: 700; }
    .pct { fill: ${LABEL}; font-size: 19px; font-weight: 600; }
    .lang { fill: ${VALUE}; font-size: 20px; font-weight: 600; }`;

function renderSummary(stats) {
  const cells = [
    ["Total stars", stats.stars],
    ["Commits (1年)", stats.commits],
    ["Pull requests", stats.pullRequests],
    ["Reviews", stats.reviews],
    ["Contributed to", stats.contributedTo],
    ["Public repos", stats.repoCount],
    ["Followers", stats.followers],
    ["Since", stats.since],
  ];

  const colX = [PAD + 4, W / 2 + 14];
  const rowY = [140, 216, 292, 368];

  const body = cells
    .map((cell, index) => {
      const x = colX[index % 2];
      const y = rowY[Math.floor(index / 2)];
      return (
        `<text class="label" x="${x}" y="${y - 26}">${escapeXml(cell[0])}</text>` +
        `<text class="value" x="${x}" y="${y}">${escapeXml(cell[1])}</text>`
      );
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}" role="img" aria-label="GitHub プロフィール概要">
  <title>Profile summary</title>
  <style>${CARD_STYLE}</style>
  <rect class="frame" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20"/>
  <text class="title" x="${PAD}" y="66">PROFILE</text>
  <line x1="${PAD}" y1="90" x2="${W - PAD}" y2="90" stroke="${BORDER}" stroke-width="1" opacity=".35"/>
  ${body}
</svg>
`;
}

function renderLanguages(languages) {
  const barX = PAD;
  const barY = 112;
  const barW = W - PAD * 2;
  const barH = 26;

  let offset = 0;
  const segments = languages
    .map((language) => {
      const width = (language.share / 100) * barW;
      const rect = `<rect x="${(barX + offset).toFixed(2)}" y="${barY}" width="${width.toFixed(2)}" height="${barH}" fill="${escapeXml(language.color)}"/>`;
      offset += width;
      return rect;
    })
    .join("");

  // 言語の数が変わっても、バーの下の余白に凡例が縦中央で収まるようにする
  const rowH = 62;
  const rows = Math.ceil(languages.length / 2);
  const areaTop = barY + barH + 20;
  const areaBottom = H - 26;
  const firstBaseline = areaTop + (areaBottom - areaTop - ((rows - 1) * rowH + 22)) / 2 + 16;

  const colX = [PAD + 2, W / 2 + 10];
  const legend = languages
    .map((language, index) => {
      const x = colX[index % 2];
      const y = firstBaseline + Math.floor(index / 2) * rowH;
      return (
        `<circle cx="${x + 9}" cy="${y - 7}" r="9" fill="${escapeXml(language.color)}"/>` +
        `<text class="lang" x="${x + 30}" y="${y}">${escapeXml(language.name)}</text>` +
        `<text class="pct" x="${x + 300}" y="${y}" text-anchor="end">${language.share.toFixed(1)}%</text>`
      );
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}" role="img" aria-label="使用言語の内訳: ${escapeXml(languages.map((l) => `${l.name} ${l.share.toFixed(1)}%`).join(", "))}">
  <title>Top languages</title>
  <style>${CARD_STYLE}</style>
  <defs><clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="13"/></clipPath></defs>
  <rect class="frame" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20"/>
  <text class="title" x="${PAD}" y="66">TOP LANGUAGES</text>
  <g clip-path="url(#bar)">${segments}</g>
  ${legend}
</svg>
`;
}

async function updateReadme(stamp) {
  let readme = await readFile(README_FILE, "utf8");

  for (const file of ["profile-summary", "top-languages"]) {
    const pattern = new RegExp(`src="\\.?/?assets/${file}\\.svg(?:\\?v=[^"]*)?"`);
    if (!pattern.test(readme)) {
      throw new Error(`Could not find ${file}.svg image in README.md`);
    }
    readme = readme.replace(pattern, `src="./assets/${file}.svg?v=${stamp}"`);
  }

  await writeFile(README_FILE, readme);
}

const user = await fetchProfile();
const stats = summarize(user);
const languages = languageShares(user);
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);

await mkdir("assets", { recursive: true });
await writeFile(SUMMARY_FILE, renderSummary(stats));
await writeFile(LANGUAGES_FILE, renderLanguages(languages));
await updateReadme(stamp);
console.log(
  `Updated ${SUMMARY_FILE} and ${LANGUAGES_FILE} (${languages.length} languages, ${stats.stars} stars)`,
);
