import sharp from 'sharp';
const [fa, fb] = process.argv.slice(2, 4);
const boxes = { IlvaRobe: [270, 440, 340, 500], RaynTunic: [435, 400, 495, 460], PriestRobe: [1045, 400, 1140, 500], HarmatCloak: [870, 400, 1000, 520], OssCape: [590, 300, 660, 400] };
const rd = async (f) => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width }; };
const A = await rd(fa), B = await rd(fb);
const mean = (I, [x0, y0, x1, y1]) => { let r = 0, g = 0, b = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * I.w + x) * 3; r += I.data[o]; g += I.data[o + 1]; b += I.data[o + 2]; n++; } return [r / n, g / n, b / n].map((v) => Math.round(v)); };
for (const [k, b] of Object.entries(boxes)) console.log(k.padEnd(12), mean(A, b), mean(B, b));
