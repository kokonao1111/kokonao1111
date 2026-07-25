// About セクションのターミナル風 SVG を生成する。
// 内容は静的なので、文面を変えたいときにこのファイルを編集して再実行する:
//   node scripts/build-about-terminal.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT_FILE = "assets/about-terminal.svg";
const README_FILE = "README.md";
const PROMPT = "naohiro@hal-tokyo ~ %";

// type: "cmd" は打ち込まれる演出、"out" は結果として一気に表示される
const LINES = [
  { type: "cmd", text: "whoami" },
  { type: "out", text: "naohiro — HAL東京 · 高度情報学科" },
  { type: "cmd", text: "cat profile.json" },
  { type: "out", text: '{ "location": "Japan", "focus": ["Web", "スクリプト", "体験設計"] }' },
  { type: "cmd", text: "ls ~/stack" },
  { type: "out", text: "html  css  js  swift  python  flutter  dart" },
  { type: "cmd", text: "./why.sh" },
  { type: "out", text: "UI の気持ちよさと、ちゃんと動く実装の両方を大事にしています。" },
];

// --- レイアウト ---------------------------------------------------------
const FONT_SIZE = 14;
const CHAR_W = FONT_SIZE * 0.6; // 等幅フォントの半角1文字ぶん
const LINE_H = 26;
const CMD_GAP = 12; // コマンド行の前に入れる余白
const PAD_X = 24;
const BAR_H = 36;
const PAD_TOP = 28;
const PAD_BOTTOM = 22;
const WIDTH = 720;

// --- タイミング（秒） ---------------------------------------------------
const TYPE_PER_UNIT = 0.05; // 1文字打つのにかかる時間
const AFTER_CMD = 0.35; // 打ち終わってから結果が出るまで
const AFTER_OUT = 0.5; // 結果を見せてから次のコマンドまで
const HOLD = 3.4; // 全部出したあと、消えるまで
const CLEAR = 0.4; // 消えてから最初に戻るまで

const BG = "#0d1117";
const BAR = "#161b22";
const BORDER = "#30363d";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// 全角は半角2つぶんの幅として数える
function widthUnits(text) {
  let units = 0;
  for (const char of text) {
    units += /[　-ヿ一-鿿！-｠—·]/.test(char) ? 2 : 1;
  }
  return units;
}

const promptW = widthUnits(PROMPT) * CHAR_W;

// 各行の縦位置とアニメーション開始時刻を先に決める
let y = BAR_H + PAD_TOP;
let clock = 0.4;
const layout = LINES.map((line, index) => {
  if (line.type === "cmd" && index > 0) {
    y += CMD_GAP;
  }
  const units = widthUnits(line.text);
  const typeDuration = line.type === "cmd" ? Math.max(0.35, units * TYPE_PER_UNIT) : 0;
  const item = {
    ...line,
    index,
    y,
    units,
    textW: units * CHAR_W,
    startAt: clock,
    typeDuration,
  };
  y += LINE_H;
  clock += line.type === "cmd" ? typeDuration + AFTER_CMD : AFTER_OUT;
  return item;
});

// ループ後の y は最終行の1行下を指しているので、1行ぶん戻してから余白を足す
const HEIGHT = y - LINE_H + PAD_BOTTOM;
const TOTAL = Number((clock + HOLD + CLEAR).toFixed(2));
const pct = (seconds) => Number(((seconds / TOTAL) * 100).toFixed(3));
const FADE_OUT = pct(clock + HOLD);
const GONE = pct(clock + HOLD + CLEAR * 0.6);

const keyframes = [];
const body = [];

for (const line of layout) {
  const appear = `a${line.index}`;
  keyframes.push(
    `@keyframes ${appear}{0%,${pct(line.startAt) - 0.001}%{opacity:0}` +
      `${pct(line.startAt)}%,${FADE_OUT}%{opacity:1}` +
      `${GONE}%,100%{opacity:0}}`,
  );

  if (line.type === "out") {
    body.push(
      `<text class="out ${appear}" x="${PAD_X}" y="${line.y}">${escapeXml(line.text)}</text>`,
    );
    continue;
  }

  // コマンド行：文字の上に背景色の板を重ね、右へ動かして「打っている」ように見せる
  const cover = `c${line.index}`;
  const caret = `k${line.index}`;
  const textX = PAD_X + promptW + CHAR_W;
  const endAt = line.startAt + line.typeDuration;
  const nextStart = layout[line.index + 1]?.startAt ?? clock;

  keyframes.push(
    `@keyframes ${cover}{0%,${pct(line.startAt)}%{transform:translateX(0)}` +
      `${pct(endAt)}%,100%{transform:translateX(${Math.ceil(line.textW) + 4}px)}}`,
  );
  keyframes.push(
    `@keyframes ${caret}{0%,${pct(line.startAt) - 0.001}%{opacity:0;transform:translateX(0)}` +
      `${pct(line.startAt)}%{opacity:1;transform:translateX(0)}` +
      `${pct(endAt)}%{opacity:1;transform:translateX(${Math.ceil(line.textW)}px)}` +
      `${pct(nextStart)}%{opacity:1}` +
      `${pct(nextStart) + 0.001}%,100%{opacity:0}}`,
  );

  body.push(
    `<g class="${appear}">` +
      `<text class="prompt" x="${PAD_X}" y="${line.y}">${escapeXml(PROMPT)}</text>` +
      `<text class="cmd" x="${textX}" y="${line.y}">${escapeXml(line.text)}</text>` +
      `<rect class="cover ${cover}" x="${textX - 2}" y="${line.y - FONT_SIZE}" width="${Math.ceil(line.textW) + 8}" height="${FONT_SIZE + 8}"/>` +
      `</g>`,
    `<rect class="caret ${caret}" x="${textX}" y="${line.y - FONT_SIZE}" width="${CHAR_W}" height="${FONT_SIZE + 4}"/>`,
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="naohiro — HAL東京 高度情報学科。Web・スクリプト・体験設計を中心に、Swift や Python も使い分けています。">
  <title>About naohiro</title>
  <style>
    text { font-family: "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: ${FONT_SIZE}px; }
    .prompt { fill: #7ee787; }
    .cmd { fill: #e6edf3; }
    .out { fill: #8b949e; }
    .cover { fill: ${BG}; }
    .caret { fill: #ffd166; animation: blink .9s steps(2, end) infinite; }
    .title { fill: #6e7681; font-size: 12px; }
    @keyframes blink { 0% { fill-opacity: 1 } 100% { fill-opacity: 0 } }
    ${layout.map((line) => `.a${line.index}{animation:a${line.index} ${TOTAL}s linear infinite}`).join("")}
    ${layout
      .filter((line) => line.type === "cmd")
      .map(
        (line) =>
          `.c${line.index}{animation:c${line.index} ${TOTAL}s linear infinite}` +
          `.k${line.index}{animation:k${line.index} ${TOTAL}s linear infinite,blink .9s steps(2,end) infinite}`,
      )
      .join("")}
    ${keyframes.join("\n    ")}
  </style>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <path d="M0 12a12 12 0 0 1 12-12h${WIDTH - 24}a12 12 0 0 1 12 12v${BAR_H - 12}H0Z" fill="${BAR}"/>
  <line x1="0" y1="${BAR_H}" x2="${WIDTH}" y2="${BAR_H}" stroke="${BORDER}"/>
  <circle cx="22" cy="${BAR_H / 2}" r="6" fill="#ff5f57"/>
  <circle cx="42" cy="${BAR_H / 2}" r="6" fill="#febc2e"/>
  <circle cx="62" cy="${BAR_H / 2}" r="6" fill="#28c840"/>
  <text class="title" x="${WIDTH / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle">about — naohiro</text>
  ${body.join("\n  ")}
</svg>
`;

// 作り直しても GitHub 側の画像キャッシュが残らないよう、README の ?v= を更新する
async function updateReadmeCacheKey() {
  const readme = await readFile(README_FILE, "utf8");
  const pattern = /src="\.?\/?assets\/about-terminal\.svg(?:\?v=[^"]*)?"/;

  if (!pattern.test(readme)) {
    throw new Error("Could not find about-terminal.svg image in README.md");
  }

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  await writeFile(
    README_FILE,
    readme.replace(pattern, `src="./assets/about-terminal.svg?v=${stamp}"`),
  );
}

await mkdir("assets", { recursive: true });
await writeFile(OUT_FILE, svg);
await updateReadmeCacheKey();
console.log(`Wrote ${OUT_FILE} (${LINES.length} lines, loop ${TOTAL}s)`);
