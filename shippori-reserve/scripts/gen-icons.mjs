/**
 * ホーム画面用のアイコンを作る。
 *
 *   node scripts/gen-icons.mjs
 *
 * 公式サイトと同じ濃紺の地に、木目色の「予」を置いただけのもの。
 * 写真を使わないのは、小さくしたときに何のアイコンか分からなくなるため。
 * デザインを差し替えるときは下の SVG を書き換えて、もう一度流せばよい。
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const BG = "#111726";
const GOLD = "#d2a25c";

/** padding は maskable 用。iOS が角を切っても文字が欠けないように内側へ寄せる。 */
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}"
        rx="${size * 0.06}" fill="none" stroke="${GOLD}" stroke-opacity="0.45"
        stroke-width="${Math.max(2, size * 0.012)}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Hiragino Mincho ProN, Yu Mincho, Noto Serif JP, serif"
        font-size="${size * (pad > size * 0.12 ? 0.42 : 0.52)}" font-weight="600" fill="${GOLD}">予</text>
</svg>`;

const targets = [
  { name: "icon-192.png", size: 192, pad: 192 * 0.08 },
  { name: "icon-512.png", size: 512, pad: 512 * 0.08 },
  { name: "apple-touch-icon.png", size: 180, pad: 180 * 0.08 },
  // maskable は外周 10% 前後が切り落とされうるので、中身を内側へ寄せる
  { name: "maskable-512.png", size: 512, pad: 512 * 0.18 },
];

for (const t of targets) {
  await sharp(Buffer.from(svg(t.size, t.pad)))
    .png()
    .toFile(path.join(OUT, t.name));
  console.log(`generated ${t.name}`);
}
