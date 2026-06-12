// プレースホルダー画像（差し替え前提）を生成するスクリプト。
// 実行: node scripts/gen-placeholders.mjs
// 本番では public/images/ の各ファイルを実写真に差し替えてください（README参照）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'images');
mkdirSync(outDir, { recursive: true });

const BG = '#1b1611', BG2 = '#251e17', GOLD = '#d4a857', EMBER = '#c2603a', TEXT = '#c4b6a4';

function placeholderSVG(w, h, label, sub = '写真を差し替え') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG2}"/><stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="1.5" rx="8"/>
  <g fill="none" stroke="${EMBER}" stroke-opacity="0.5" stroke-width="2">
    <circle cx="${w / 2}" cy="${h / 2 - 16}" r="22"/>
    <path d="M${w / 2 - 30} ${h / 2 + 20} l18 -18 14 12 12 -10 16 16" stroke="${GOLD}" stroke-opacity="0.5"/>
  </g>
  <text x="${w / 2}" y="${h / 2 + 44}" fill="${GOLD}" font-family="serif" font-size="18" text-anchor="middle" letter-spacing="2">${label}</text>
  <text x="${w / 2}" y="${h / 2 + 68}" fill="${TEXT}" font-family="sans-serif" font-size="12" text-anchor="middle" letter-spacing="1">${sub}</text>
</svg>`;
}

// オンページ用 SVG（軽量・ブラウザ表示はOK）
const svgFiles = [
  ['menu-01.svg', 'おばんざい盛り合わせ'],
  ['menu-02.svg', '海鮮丼'],
  ['menu-03.svg', '本日の刺身'],
  ['menu-04.svg', '家庭料理'],
  ['gallery-01.svg', '店内・カウンター'],
  ['gallery-02.svg', '個室・座敷'],
  ['gallery-03.svg', 'おばんざいと酒'],
  ['gallery-04.svg', '宴会の様子'],
  ['gallery-05.svg', '海鮮の盛り合わせ'],
  ['gallery-06.svg', '店内の照明'],
];
for (const [name, label] of svgFiles) {
  writeFileSync(join(outDir, name), placeholderSVG(800, 600, label));
}

// OGP は SNS が PNG/JPG を要求するため PNG で出力（1200x630）
const ogpSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="24" y="24" width="1152" height="582" fill="none" stroke="${GOLD}" stroke-opacity="0.4" stroke-width="2" rx="14"/>
  <text x="600" y="280" fill="#f2ebe0" font-family="serif" font-size="108" text-anchor="middle" letter-spacing="14">しっぽり亭</text>
  <text x="600" y="350" fill="${GOLD}" font-family="serif" font-size="34" text-anchor="middle" letter-spacing="8">新居浜の夜を、しっぽりと。</text>
  <text x="600" y="420" fill="${TEXT}" font-family="sans-serif" font-size="24" text-anchor="middle" letter-spacing="3">居酒屋 ・ 個室 ・ 宴会コース ／ 愛媛県新居浜市</text>
</svg>`;
await sharp(Buffer.from(ogpSVG)).png().toFile(join(outDir, 'ogp.png'));

// apple-touch-icon (180x180) と favicon 代替 PNG
const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" rx="38" fill="${BG}"/>
  <rect x="14" y="14" width="152" height="152" rx="30" fill="none" stroke="${GOLD}" stroke-width="3"/>
  <text x="90" y="118" fill="${GOLD}" font-family="serif" font-size="96" text-anchor="middle">志</text>
</svg>`;
await sharp(Buffer.from(iconSVG)).png().toFile(join(__dirname, '..', 'public', 'apple-touch-icon.png'));

console.log('placeholders generated -> public/images, public/apple-touch-icon.png');
