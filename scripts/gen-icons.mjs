// 生成 icons/ 下的扩展图标：node scripts/gen-icons.mjs
// 零依赖（只用 node:zlib 压 IDAT），4x 超采样抗锯齿，输出带 alpha 的圆角图标。
// 图形：靛蓝圆角方块 + 三道白色爪痕（OfferClaw 的“爪”）。16px 下笔画会糊，所以半径有按像素的下限。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "icons");
const BRAND = [79, 70, 229]; // #4f46e5，与 panel.css 的品牌色一致
const SS = 4; // 每个方向的超采样倍数

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// 圆角矩形的有向距离：负值在内部
const roundedRect = (x, y, half, radius) => {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
};
const bezier = (p, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
};
// 一条从粗到细的爪：沿三次贝塞尔取样，逐点算“到样点的距离 - 该点半径”
const talonDistance = (x, y, ctrl, r0, r1) => {
  let best = Infinity;
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const [bx, by] = bezier(ctrl, t);
    best = Math.min(best, Math.hypot(x - bx, y - by) - (r0 + (r1 - r0) * t));
  }
  return best;
};

// 三道爪痕：从左下到右上的平行斜笔，起端粗、尖端收细。
// 用爪痕而不是画一只完整的爪——16px 只有十几个像素，任何解剖细节都会糊成一团，粗斜笔在任何尺寸都读得出来。
// spacing 按尺寸放大：小图里笔画被半径下限撑到 2px 宽，沿用大图间距三道会粘成一团。
function clawDistance(x, y, minRadius, spacing) {
  const r = (v) => Math.max(v, minRadius);
  const th = (62 * Math.PI) / 180;
  const dir = [Math.cos(th), -Math.sin(th)];
  const perp = [Math.sin(th), Math.cos(th)];
  const cx = 0.5;
  const cy = 0.52;
  const bow = 0.05; // 轻微外弧，避免看起来像三条机械横杠
  let d = Infinity;
  for (const [off, len] of [[-spacing, 0.5], [0, 0.6], [spacing, 0.5]]) {
    const bx = cx + perp[0] * off;
    const by = cy + perp[1] * off;
    const p0 = [bx - (dir[0] * len) / 2, by - (dir[1] * len) / 2];
    const p3 = [bx + (dir[0] * len) / 2, by + (dir[1] * len) / 2];
    const p1 = [p0[0] + (dir[0] * len) / 3 + perp[0] * bow, p0[1] + (dir[1] * len) / 3 + perp[1] * bow];
    const p2 = [p3[0] - (dir[0] * len) / 3 + perp[0] * bow, p3[1] - (dir[1] * len) / 3 + perp[1] * bow];
    d = Math.min(d, talonDistance(x, y, [p0, p1, p2, p3], r(0.058), r(0.016)));
  }
  return d;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const minRadius = 1.0 / size; // 笔画至少 ~2px 宽，不然小图上的尖端会整段消失
  const spacing = size <= 32 ? 0.27 : 0.185; // 小图靠加大间距保住三道之间的缝
  const total = SS * SS;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (pxi + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          if (roundedRect(u - 0.5, v - 0.5, 0.5, 0.22) <= 0) bg++;
          if (clawDistance(u, v, minRadius, spacing) <= 0) fg++;
        }
      }
      const alpha = bg / total;
      const white = Math.min(fg / total, alpha);
      const i = (py * size + pxi) * 4;
      // 白爪叠在品牌色底上，两者都是覆盖率，按比例混出直不透明色
      for (let c = 0; c < 3; c++) px[i + c] = Math.round((BRAND[c] * (alpha - white) + 255 * white) / Math.max(alpha, 1e-6));
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 位、RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`icon${size}.png ${fs.statSync(file).size} bytes`);
}
