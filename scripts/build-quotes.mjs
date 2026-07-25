// 名言カード（英語＋日本語訳）の SVG を生成する。
// 名言を足したり文面を変えたいときは QUOTES を編集して再実行:
//   node scripts/build-quotes.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT_FILE = "assets/quote-card.svg";
const README_FILE = "README.md";

const QUOTES = [
  {
    en: "The only way to learn a new programming language is by writing programs in it.",
    ja: "新しいプログラミング言語を学ぶ唯一の方法は、その言語でプログラムを書くことだ。",
    by: "Kernighan & Ritchie",
  },
  {
    en: "Programs must be written for people to read, and only incidentally for machines to execute.",
    ja: "プログラムは人が読むために書かれるべきであり、機械が実行するのはついでにすぎない。",
    by: "Harold Abelson",
  },
  {
    en: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
    ja: "コンピュータが理解できるコードは誰にでも書ける。優れたプログラマは、人間が理解できるコードを書く。",
    by: "Martin Fowler",
  },
  {
    en: "Simplicity is prerequisite for reliability.",
    ja: "単純であることは、信頼性の前提条件である。",
    by: "Edsger W. Dijkstra",
  },
  {
    en: "Talk is cheap. Show me the code.",
    ja: "口で言うのは簡単だ。コードを見せてくれ。",
    by: "Linus Torvalds",
  },
  {
    en: "Make it work, make it right, make it fast.",
    ja: "まず動かす。次に正しくする。それから速くする。",
    by: "Kent Beck",
  },
];

// --- レイアウト ---------------------------------------------------------
const WIDTH = 780;
const PAD_X = 40;
const EN_SIZE = 17;
const JA_SIZE = 14;
const BY_SIZE = 13;
const EN_LH = 26;
const JA_LH = 23;
const GAP_EN_JA = 14;
const GAP_JA_BY = 18;
const TEXT_W = WIDTH - PAD_X * 2 - 24;

// --- タイミング（秒） ---------------------------------------------------
const HOLD = 6; // 1つの名言を見せる時間
const FADE = 0.6; // 切り替わりの長さ

const BG = "#0d1117";
const BORDER = "#30363d";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const isWide = (char) => /[　-ヿ一-鿿！-｠]/.test(char);

// SVG は自動改行しないので、幅を見積もって自前で折り返す
function wrapLatin(text, size) {
  const charW = size * 0.53;
  // 最終行に単語が1つだけ残るのを避けるため、必要な行数で幅を割って均等に配分する
  const rows = Math.max(1, Math.ceil((text.length * charW) / TEXT_W));
  const limit = rows > 1 ? Math.min(TEXT_W, ((text.length * charW) / rows) * 1.12) : TEXT_W;
  const lines = [];
  let line = "";

  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length * charW > limit && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapJapanese(text, size) {
  const lines = [];
  let line = "";
  let width = 0;

  for (const char of text) {
    const w = isWide(char) ? size : size * 0.5;
    // 行頭に句読点や閉じ括弧が来ないようにする
    if (width + w > TEXT_W && !"、。」）".includes(char)) {
      lines.push(line);
      line = "";
      width = 0;
    }
    line += char;
    width += w;
  }
  if (line) lines.push(line);
  return lines;
}

const laid = QUOTES.map((quote) => {
  const en = wrapLatin(quote.en, EN_SIZE);
  const ja = wrapJapanese(quote.ja, JA_SIZE);
  const height =
    en.length * EN_LH + GAP_EN_JA + ja.length * JA_LH + GAP_JA_BY + BY_SIZE;
  return { ...quote, en, ja, height };
});

const BODY_TOP = 34;
const BODY_H = Math.max(...laid.map((quote) => quote.height));
const HEIGHT = BODY_TOP + BODY_H + 34;

const TOTAL = Number((QUOTES.length * HOLD).toFixed(2));
const pct = (seconds) => Number(((seconds / TOTAL) * 100).toFixed(3));

const keyframes = [];
const groups = [];

laid.forEach((quote, index) => {
  // 高さが違うので、それぞれをカード内で縦中央に置く
  let y = BODY_TOP + (BODY_H - quote.height) / 2 + EN_SIZE;

  const enLines = quote.en
    .map((line, i) => `<text class="en" x="${PAD_X + 24}" y="${y + i * EN_LH}">${escapeXml(line)}</text>`)
    .join("");
  y += quote.en.length * EN_LH + GAP_EN_JA;

  const jaLines = quote.ja
    .map((line, i) => `<text class="ja" x="${PAD_X + 24}" y="${y + i * JA_LH}">${escapeXml(line)}</text>`)
    .join("");
  y += quote.ja.length * JA_LH + GAP_JA_BY;

  const by = `<text class="by" x="${WIDTH - PAD_X}" y="${y}" text-anchor="end">— ${escapeXml(quote.by)}</text>`;
  const mark = `<text class="mark" x="${PAD_X - 6}" y="${BODY_TOP + (BODY_H - quote.height) / 2 + EN_SIZE + 8}">“</text>`;

  const start = index * HOLD;
  const stops = [
    index === 0 ? "0%{opacity:0}" : `0%,${pct(start)}%{opacity:0}`,
    `${pct(start + FADE)}%{opacity:1}`,
    `${pct(start + HOLD - FADE)}%{opacity:1}`,
    `${pct(start + HOLD)}%,100%{opacity:0}`,
  ];
  keyframes.push(`@keyframes q${index}{${stops.join("")}}`);
  groups.push(`<g class="q q${index}">${mark}${enLines}${jaLines}${by}</g>`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${escapeXml(laid.map((quote) => `${quote.en} — ${quote.by}`).join(" / "))}">
  <title>Programming quotes with Japanese translation</title>
  <style>
    text { font-family: -apple-system, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif; }
    .en { fill: #e6edf3; font-size: ${EN_SIZE}px; font-style: italic; font-weight: 500; }
    .ja { fill: #8b949e; font-size: ${JA_SIZE}px; }
    .by { fill: #58a6ff; font-size: ${BY_SIZE}px; font-weight: 600; }
    .mark { fill: #1f6feb; font-size: 46px; font-weight: 700; opacity: .55; }
    .q { animation-duration: ${TOTAL}s; animation-timing-function: linear; animation-iteration-count: infinite; }
    ${laid.map((_, index) => `.q${index}{animation-name:q${index}}`).join("")}
    ${keyframes.join("\n    ")}
  </style>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  ${groups.join("\n  ")}
</svg>
`;

async function updateReadmeCacheKey() {
  const readme = await readFile(README_FILE, "utf8");
  const pattern = /src="\.?\/?assets\/quote-card\.svg(?:\?v=[^"]*)?"/;

  if (!pattern.test(readme)) {
    throw new Error("Could not find quote-card.svg image in README.md");
  }

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  await writeFile(README_FILE, readme.replace(pattern, `src="./assets/quote-card.svg?v=${stamp}"`));
}

await mkdir("assets", { recursive: true });
await writeFile(OUT_FILE, svg);
await updateReadmeCacheKey();
console.log(`Wrote ${OUT_FILE} (${QUOTES.length} quotes, loop ${TOTAL}s)`);
