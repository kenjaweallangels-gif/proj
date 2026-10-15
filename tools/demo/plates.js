'use strict';
// Background plates for the playable demo, painted in WORLD coordinates (hero = 180 px tall).
// Each plate: { origin:[x,y], size:[w,h], scale, alpha, draw(ctx) }.
const PLATES = {};

/* ---------- helpers ---------- */
const SEC = '#07060a';
function sectionTexture(ctx, x, y, w, h, seed) {
  ctx.save(); ctx.fillStyle = SEC; ctx.fillRect(x, y, w, h);
  const r = rng(seed); ctx.fillStyle = 'rgba(150,135,120,.06)';
  for (let i = 0; i < w * h / 900; i++) ctx.fillRect(x + r() * w, y + r() * h, 3 + r() * 14, 1.2);
  ctx.strokeStyle = 'rgba(170,160,150,.12)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.restore();
}
function room(ctx, x0, y0, x1, y1, base, motif, a) { wallpaper(ctx, x0, y0, x1 - x0, y1 - y0, base, motif, a); }
function boards(ctx, x0, x1, y, col) { vgrad(ctx, x0, y, x1 - x0, 40, [[0, col], [1, '#050405']]); ctx.save(); ctx.strokeStyle = 'rgba(210,190,150,.07)'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0, y + 4 + i * 9); ctx.lineTo(x1, y + 4 + i * 9); ctx.stroke(); } ctx.restore(); }
function wainscotR(ctx, x0, x1, y0, y1, col) { ctx.save(); ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x0, y0, x1 - x0, 4); ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1.5; for (let x = x0 + 10; x < x1 - 50; x += 80) ctx.strokeRect(x, y0 + 12, 64, y1 - y0 - 24); ctx.restore(); }
function shade(ctx, x0, y0, x1, y1, col, a) { ctx.fillStyle = rgba(col, a); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
function pool(ctx, x, y, rx, ry, col, a) { lightPool(ctx, x, y, rx, ry, col, a); }
function portrait(ctx, x, y, w, h, seed) { ctx.fillStyle = '#1a140c'; ctx.fillRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10); ctx.fillStyle = '#0b0a08'; ctx.fillRect(x - w / 2, y - h / 2, w, h); crepe(ctx, x - w / 2 - 6, y - h / 2 - 8, w + 12, h * .9, seed); }
function sconceFixture(ctx, x, y) { ctx.fillStyle = '#0d0b08'; ctx.fillRect(x - 2, y, 4, 26); ctx.beginPath(); ctx.ellipse(x, y + 26, 7, 3, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(160,140,100,.25)'; ctx.fillRect(x - 1, y, 1, 26); }

/* ================= house in cross-section ================= */
PLATES.house = {
  origin: [200, 120], size: [2420, 1300], scale: 1.5, alpha: true,
  draw(ctx) {
    // ---------- nursery (260–680, 560–940) ----------
    room(ctx, 260, 560, 680, 940, '#141a24', [150, 170, 210], .05);
    wainscotR(ctx, 260, 680, 860, 940, '#0d1018');
    ctx.fillStyle = '#0b0e16'; ctx.fillRect(430, 640, 70, 110); vgrad(ctx, 436, 646, 58, 98, [[0, '#1c2638'], [1, '#2a3550']]); ctx.fillStyle = '#0b0e16'; ctx.fillRect(463, 646, 4, 98); ctx.fillRect(436, 690, 58, 4);
    shaft(ctx, [[436, 700], [494, 700], [600, 940], [470, 940]], [150, 175, 230], .14, .03, [465, 700], [535, 940], 10);
    // cradle under black cloth, paper stars
    ctx.fillStyle = '#0a0a0e'; ctx.beginPath(); ctx.ellipse(560, 935, 46, 6, 0, Math.PI, 0); ctx.fill();
    fillSpline(ctx, [[515, 935], [508, 892], [530, 868], [590, 866], [612, 890], [606, 935]], '#050507', .8);
    ctx.strokeStyle = 'rgba(140,150,180,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(560, 560); ctx.lineTo(560, 760); ctx.stroke(); ctx.beginPath(); ctx.moveTo(520, 760); ctx.lineTo(600, 760); ctx.stroke();
    [[520, 790], [545, 800], [575, 798], [600, 786]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x, 760); ctx.lineTo(x, y - 8); ctx.stroke(); ctx.save(); ctx.translate(x, y); ctx.fillStyle = 'rgba(220,214,196,.55)'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 3.4 : 8; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.restore(); });
    boards(ctx, 260, 680, 940, '#141218');
    shade(ctx, 260, 560, 680, 940, [8, 10, 18], .35);
    // ---------- bedroom (700–1560, 560–940) ----------
    room(ctx, 700, 560, 1560, 940, '#121722', [140, 160, 200], .055);
    wainscotR(ctx, 700, 1560, 846, 940, '#0c0e15');
    vgrad(ctx, 700, 560, 860, 26, [[0, '#06070b'], [1, 'rgba(6,7,11,0)']]);
    pool(ctx, 820, 760, 150, 130, [120, 140, 190], .12);
    // bed: headboard left, canopy, curtain, mattress, pillow (bloodstain), footboard
    fillSpline(ctx, [[716, 940], [716, 742], [730, 726], [752, 722], [762, 740], [762, 940]], '#0b0a0f', .8);
    ctx.fillStyle = '#08080c'; ctx.fillRect(724, 680, 9, 260); ctx.fillRect(922, 680, 9, 260); ctx.fillRect(718, 676, 220, 10); ctx.beginPath(); ctx.ellipse(728, 672, 7, 7, 0, 0, 7); ctx.ellipse(926, 672, 7, 7, 0, 0, 7); ctx.fill();
    curtain(ctx, 730, 684, 46, 170, [18, 19, 28], 3, 4);
    ctx.fillStyle = '#0d0d13'; ctx.fillRect(740, 882, 190, 34); vgrad(ctx, 740, 872, 190, 14, [[0, '#9aa1b2'], [1, '#585f70']]);
    ctx.fillStyle = 'rgba(14,16,24,.5)'; ctx.fillRect(740, 872, 190, 14);
    fillSpline(ctx, [[752, 868], [784, 860], [806, 872], [782, 884], [754, 884]], '#8a91a3', .9);
    ctx.fillStyle = 'rgba(90,8,12,.85)'; ctx.beginPath(); ctx.ellipse(788, 873, 7, 3.4, .2, 0, 7); ctx.fill();
    ctx.fillStyle = '#0b0a0f'; ctx.fillRect(920, 846, 14, 94);
    // fireplace (1040–1180), mantel, clock 17:42, laudanum
    ctx.fillStyle = '#0e0d13'; ctx.fillRect(1040, 820, 140, 120); ctx.fillStyle = '#040406'; ctx.fillRect(1072, 862, 76, 78); ctx.fillStyle = '#14131a'; ctx.fillRect(1030, 812, 160, 10);
    vgrad(ctx, 1072, 908, 76, 32, [[0, [120, 40, 10], 0], [1, [170, 60, 18], .7]]);
    ctx.fillStyle = '#0e0b08'; poly(ctx, [[1094, 812], [1098, 782], [1112, 774], [1126, 782], [1130, 812]]); ctx.fill(); clockFace(ctx, 1112, 796, 11, 17, 42);
    ctx.fillStyle = '#2a1408'; ctx.fillRect(1160, 798, 8, 14); ctx.fillRect(1162, 794, 4, 4); ctx.fillStyle = '#0b0b10'; ctx.fillRect(1046, 790, 4, 22); ctx.fillRect(1172, 794, 3, 18);
    pool(ctx, 1110, 930, 180, 40, [255, 110, 40], .2);
    // window (1240–1360, 640–880): glass cut out later; frame, curtains, sill
    curtain(ctx, 1210, 610, 36, 300, [18, 20, 30], 3, 2); curtain(ctx, 1354, 610, 36, 300, [18, 20, 30], 3, 3);
    ctx.fillStyle = '#06070b'; ctx.fillRect(1232, 632, 136, 8); ctx.fillRect(1232, 880, 136, 10); ctx.fillRect(1232, 640, 8, 240); ctx.fillRect(1360, 640, 8, 240); ctx.fillRect(1297, 640, 6, 240); ctx.fillRect(1240, 752, 120, 5);
    ctx.fillStyle = 'rgba(160,180,225,.2)'; ctx.fillRect(1232, 889, 136, 1.5);
    pool(ctx, 1290, 935, 220, 26, [150, 175, 230], .25);
    // cheval mirror under crepe (1420–1490)
    ctx.fillStyle = '#0d0c10'; ctx.fillRect(1424, 770, 62, 166); fillSpline(ctx, [[1420, 772], [1436, 758], [1455, 752], [1474, 758], [1490, 772]], '#0d0c10', .8); ctx.fillRect(1414, 934, 82, 6);
    crepe(ctx, 1419, 762, 72, 160, 5);
    // ---------- corridor (1580–2540, 560–940) ----------
    room(ctx, 1580, 560, 2540, 940, '#17150f', [190, 170, 120], .05);
    wainscotR(ctx, 1580, 2440, 850, 940, '#0e0d0b');
    // stair-down balustrade at the back (1590–1650)
    ctx.fillStyle = '#0b0a08'; ctx.fillRect(1590, 862, 70, 6); for (let x = 1592; x < 1660; x += 9) ctx.fillRect(x, 868, 3, 72);
    // arches into the back lane
    [[1690, 1830], [1890, 2030]].forEach(([a, b], i) => {
      ctx.save(); ctx.beginPath(); ctx.moveTo(a, 940); ctx.lineTo(a, 740); ctx.quadraticCurveTo((a + b) / 2, 680, b, 740); ctx.lineTo(b, 940); ctx.closePath(); ctx.clip();
      room(ctx, a, 660, b, 940, '#1d1a12', [200, 180, 130], .05); shade(ctx, a, 660, b, 940, [30, 26, 18], .35);
      portrait(ctx, (a + b) / 2, 790, 50, 64, 30 + i); ctx.fillStyle = '#0e0c09'; ctx.fillRect(a, 916, b - a, 24);
      if (i === 1) { ctx.fillStyle = '#0b0907'; ctx.fillRect(1935, 878, 60, 6); ctx.fillRect(1940, 884, 4, 32); ctx.fillRect(1986, 884, 4, 32); }
      ctx.restore();
      ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(a, 940); ctx.lineTo(a, 740); ctx.quadraticCurveTo((a + b) / 2, 680, b, 740); ctx.lineTo(b, 940); ctx.stroke();
    });
    portrait(ctx, 1860, 760, 26, 36, 41); portrait(ctx, 2090, 760, 40, 54, 42);
    [1665, 1860, 2060].forEach(x => sconceFixture(ctx, x, 700));
    [1665, 1860, 2060].forEach(x => pool(ctx, x, 760, 70, 90, [80, 120, 255], .1));
    // round window above the stairs: the lit window across the street shows through it at runtime
    ctx.fillStyle = '#0b0907'; ctx.beginPath(); ctx.arc(2250, 640, 36, 0, 7); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(2250, 640, 28, 0, 7); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#0b0907'; ctx.fillRect(2248, 612, 4, 56); ctx.fillRect(2222, 638, 56, 4); ctx.strokeStyle = 'rgba(220,190,140,.14)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(2250, 640, 33, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
    // stair structure: ledge (2190–2310, top 840), flight to (2430,700), broken gap, landing (2480–2540, 700)
    ctx.fillStyle = '#100e0b'; ctx.fillRect(2190, 840, 120, 100); ctx.strokeStyle = 'rgba(210,190,150,.1)'; ctx.strokeRect(2196, 850, 108, 82);
    ctx.fillStyle = 'rgba(210,190,150,.16)'; ctx.fillRect(2190, 840, 120, 2.5);
    // six steps up to 760, a gap with fallen treads at 820, the landing at 760
    for (let i = 0; i < 6; i++) { const x = 2310 + i * 20, y = 840 - (i + 1) * 13.33; ctx.fillStyle = '#100e0b'; ctx.fillRect(x, y, 21, 940 - y); ctx.fillStyle = 'rgba(210,190,150,.14)'; ctx.fillRect(x, y, 21, 2); }
    ctx.fillStyle = '#100e0b'; poly(ctx, [[2430, 760], [2440, 766], [2446, 776], [2436, 800], [2430, 940]]); ctx.fill();
    ctx.fillStyle = '#0b0a08'; ctx.fillRect(2430, 764, 4, 176); poly(ctx, [[2474, 762], [2468, 772], [2476, 790], [2480, 940], [2480, 762]]); ctx.fill();
    ctx.fillStyle = '#0d0b09'; poly(ctx, [[2432, 940], [2432, 826], [2446, 818], [2458, 824], [2470, 816], [2478, 822], [2478, 940]]); ctx.fill();
    ctx.save(); ctx.translate(2452, 818); ctx.rotate(-.3); ctx.fillStyle = '#16120d'; ctx.fillRect(-18, -4, 36, 6); ctx.restore(); ctx.fillStyle = 'rgba(210,190,150,.1)'; ctx.fillRect(2436, 820, 40, 1.5);
    ctx.fillStyle = '#100e0b'; ctx.fillRect(2480, 760, 60, 180); ctx.fillStyle = 'rgba(210,190,150,.16)'; ctx.fillRect(2480, 760, 60, 2.5);
    ctx.strokeStyle = '#0b0907'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(2300, 784); ctx.lineTo(2428, 700); ctx.stroke(); for (let i = 0; i < 6; i++) { const x = 2316 + i * 20, y = 830 - i * 13.3; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 52); ctx.stroke(); }
    // ---------- attic (1580–2540, 200–520) ----------
    room(ctx, 1580, 200, 2540, 520, '#100f0e', [120, 110, 100], .03); shade(ctx, 1580, 200, 2540, 520, [10, 9, 8], .3);
    ctx.fillStyle = '#0a0907'; for (let x = 1640; x < 2440; x += 180) { ctx.fillRect(x, 200, 14, 320); ctx.save(); ctx.translate(x + 7, 360); ctx.rotate(.6); ctx.fillRect(-4, -120, 8, 240); ctx.restore(); }
    // furniture under dust sheets, lit faintly from the hatch on the right
    [[1700, 520, 90, 70], [1830, 520, 60, 110], [2010, 520, 120, 60], [2200, 520, 70, 90]].forEach(([x, y, w, h], i) => {
      const pts = [[x - 6, y], [x - 2, y - h * .7], [x + w * .3, y - h - 6], [x + w * .8, y - h], [x + w + 4, y - h * .6], [x + w + 8, y]];
      const g = ctx.createLinearGradient(x, y - h, x + w, y); g.addColorStop(0, '#15161c'); g.addColorStop(.7, '#2a2c35'); g.addColorStop(1, '#3a3d48');
      fillSpline(ctx, pts, g, .8);
      ctx.save(); ctx.beginPath(); spline(ctx, pts, true, .8); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
      for (let f = 1; f < 4; f++) { ctx.beginPath(); ctx.moveTo(x + w * f / 4, y - h * .9); ctx.quadraticCurveTo(x + w * f / 4 + 8, y - h * .4, x + w * f / 4 - 4, y); ctx.stroke(); }
      ctx.restore(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 8, y - 4, w + 18, 4);
    });
    [[2300, 520], [2300, 470]].forEach(([x, y]) => { ctx.fillStyle = '#1a140d'; ctx.fillRect(x, y - 48, 110, 48); ctx.strokeStyle = '#0a0705'; ctx.lineWidth = 3; ctx.strokeRect(x, y - 48, 110, 48); label(ctx, x + 55, y - 24, 64, 22, -.03, [['СОЛМАР', '600 11px "Cormorant SC", Georgia, serif', 11]], { paper: '#8f8066' }); });
    ctx.fillStyle = '#0b0a08'; ctx.beginPath(); ctx.arc(1600, 330, 34, 0, 7); ctx.fill(); ctx.fillStyle = '#1a2436'; ctx.beginPath(); ctx.arc(1600, 330, 26, 0, 7); ctx.fill(); ctx.fillStyle = '#0b0a08'; ctx.fillRect(1598, 304, 4, 52); ctx.fillRect(1574, 328, 52, 4);
    pool(ctx, 2505, 260, 120, 140, [150, 175, 230], .18);
    boards(ctx, 1580, 2470, 520, '#121010');
    // ---------- parlour (700–1560, 980–1340): the coffin ----------
    room(ctx, 700, 980, 1560, 1340, '#17130f', [190, 160, 120], .045); wainscotR(ctx, 700, 1560, 1250, 1340, '#0f0c0a');
    ctx.fillStyle = '#0d0b09'; ctx.fillRect(1300, 1100, 60, 90); crepe(ctx, 1294, 1092, 72, 90, 51);
    ctx.fillStyle = '#0c0a08'; [[1060, 1340], [1220, 1340]].forEach(([x]) => { ctx.fillRect(x - 3, 1250, 6, 90); ctx.fillRect(x - 24, 1250, 48, 5); });
    fillSpline(ctx, [[1010, 1250], [1040, 1224], [1230, 1224], [1262, 1236], [1262, 1250]], '#0a0807', .6);
    ctx.fillStyle = '#0a0807'; ctx.fillRect(1010, 1236, 252, 16); ctx.fillStyle = 'rgba(220,180,120,.18)'; ctx.fillRect(1040, 1224, 190, 2); [1060, 1130, 1200].forEach(x => { ctx.fillStyle = '#6b5530'; ctx.fillRect(x, 1240, 10, 5); });
    ctx.fillStyle = 'rgba(160,190,220,.35)'; ctx.beginPath(); ctx.ellipse(1136, 1334, 40, 5, 0, 0, 7); ctx.fill();
    [[985, 1180], [1290, 1180]].forEach(([x, y]) => { ctx.fillStyle = '#0c0a08'; ctx.fillRect(x - 2, y, 4, 160); ctx.beginPath(); ctx.ellipse(x, 1338, 16, 3, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#e6dcc4'; ctx.fillRect(x - 3, y - 26, 6, 26); pool(ctx, x, y - 40, 160, 180, [255, 180, 100], .2); });
    // the open coffin: satin ruffle and a pale profile above the rim
    ctx.fillStyle = '#d8d2c4'; for (let x = 1040; x < 1230; x += 7) { ctx.beginPath(); ctx.arc(x, 1223, 4.2, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(1036, 1219, 196, 6);
    fillSpline(ctx, [[1046, 1224], [1046, 1214], [1052, 1209], [1060, 1209], [1064, 1205], [1067, 1210], [1072, 1211], [1076, 1214], [1084, 1215], [1094, 1217], [1100, 1224]], '#b9b4a8', .7);
    ctx.fillStyle = 'rgba(30,26,22,.35)'; ctx.fillRect(1046, 1218, 54, 6);
    fillSpline(ctx, [[1150, 1224], [1156, 1217], [1176, 1216], [1182, 1224]], '#a8a296', .7);
    // tall vases of white lilies at either end
    [[935, 1340], [1335, 1340]].forEach(([x, fy], k) => {
      ctx.fillStyle = '#0c0a09'; fillSpline(ctx, [[x - 12, fy], [x - 16, fy - 40], [x - 8, fy - 70], [x - 12, fy - 86], [x + 12, fy - 86], [x + 8, fy - 70], [x + 16, fy - 40], [x + 12, fy]], '#0c0a09', .8);
      const r = rng(60 + k); ctx.strokeStyle = '#141a10'; ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (r() - .5) * 1.3, l = 50 + r() * 60, ex = x + Math.cos(a) * l, ey = fy - 86 + Math.sin(a) * l; ctx.beginPath(); ctx.moveTo(x, fy - 84); ctx.quadraticCurveTo(x + (ex - x) * .3, ey + 20, ex, ey); ctx.stroke();
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = 'rgba(226,220,204,.75)'; [-1, 0, 1].forEach(j => { ctx.beginPath(); ctx.ellipse(j * 5, -6, 3, 9, j * .5, 0, 7); ctx.fill(); }); ctx.restore(); }
    });
    boards(ctx, 700, 1560, 1340, '#141110');
    // ---------- scullery under the nursery (260–680, 980–1340): sheets drying, a tub ----------
    room(ctx, 260, 980, 680, 1340, '#121315', [140, 140, 150], .025); wainscotR(ctx, 260, 680, 1270, 1340, '#0c0c0e');
    ctx.strokeStyle = '#0a0a0c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(270, 1060); ctx.lineTo(670, 1060); ctx.stroke();
    [[300, 90, 150], [410, 70, 120], [500, 110, 170]].forEach(([x, w, h], i) => { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#3d3f45'); g.addColorStop(.5, '#5a5c63'); g.addColorStop(1, '#2c2e33'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, 1060); ctx.lineTo(x + w, 1060); ctx.lineTo(x + w + 3, 1060 + h); ctx.quadraticCurveTo(x + w * .5, 1060 + h + 14, x - 2, 1060 + h - 6); ctx.closePath(); ctx.fill(); });
    ctx.fillStyle = '#1a120a'; fillSpline(ctx, [[560, 1340], [548, 1300], [552, 1288], [650, 1288], [654, 1300], [642, 1340]], '#1a120a', .8); ctx.fillStyle = 'rgba(200,140,80,.25)'; ctx.fillRect(552, 1288, 98, 2);
    shade(ctx, 260, 980, 680, 1340, [6, 6, 9], .55);
    boards(ctx, 260, 680, 1340, '#121112');
    // ---------- hall (1580–2540, 980–1340): stairs down into ink ----------
    room(ctx, 1580, 980, 2540, 1340, '#0f1015', [140, 150, 180], .035); shade(ctx, 1580, 980, 2540, 1340, [6, 7, 12], .45);
    for (let i = 0; i < 16; i++) { const x = 1600 + i * 18, y = 990 + i * 16; ctx.fillStyle = '#0d0c0c'; ctx.fillRect(x, y, 20, 1340 - y); ctx.fillStyle = 'rgba(200,190,170,.10)'; ctx.fillRect(x, y, 20, 2); }
    ctx.strokeStyle = '#090807'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(1600, 940); ctx.lineTo(1890, 1200); ctx.stroke();
    ctx.fillStyle = '#0c0b0a'; ctx.fillRect(2300, 1100, 90, 220); ctx.strokeStyle = 'rgba(200,180,140,.08)'; ctx.strokeRect(2308, 1110, 74, 200);
    ctx.strokeStyle = '#050506'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(2345, 1160, 22, 0, 7); ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(2345, 1182); ctx.lineTo(2338, 1214); ctx.moveTo(2345, 1182); ctx.lineTo(2353, 1214); ctx.stroke();
    vgrad(ctx, 1580, 1222, 960, 118, [[0, '#020206'], [1, '#000002']]);
    ctx.fillStyle = 'rgba(150,170,215,.22)'; ctx.fillRect(1580, 1222, 960, 1.5);
    // ---------- structure: walls, slabs, roof, chimney ----------
    sectionTexture(ctx, 240, 540, 20, 820, 1); sectionTexture(ctx, 2540, 160, 20, 1200, 2);
    sectionTexture(ctx, 680, 560, 20, 380, 3); sectionTexture(ctx, 1560, 560, 20, 380, 4); sectionTexture(ctx, 680, 980, 20, 360, 5); sectionTexture(ctx, 1560, 980, 20, 360, 6);
    // doorway bedroom→corridor
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fillRect(1560, 720, 20, 220); ctx.restore(); ctx.fillStyle = '#070609'; ctx.fillRect(1560, 720, 20, 220);
    sectionTexture(ctx, 240, 940, 2320, 40, 7); sectionTexture(ctx, 240, 1340, 2320, 50, 8); sectionTexture(ctx, 680, 520, 1790, 40, 9);
    ctx.fillStyle = '#0b0a09'; ctx.fillRect(2470, 520, 70, 40);
    sectionTexture(ctx, 1560, 160, 1000, 40, 10); ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fillRect(2470, 160, 70, 40); ctx.restore();
    sectionTexture(ctx, 1560, 200, 20, 320, 11); sectionTexture(ctx, 2470, 200, 0.1, 1, 12);
    // pitched roof over nursery + bedroom, with tiles and chimney
    ctx.fillStyle = SEC; poly(ctx, [[220, 560], [260, 560], [1580, 200], [1580, 158], [1540, 158]]); ctx.fill();
    ctx.save(); ctx.strokeStyle = 'rgba(150,135,120,.12)'; for (let i = 0; i < 40; i++) { const t = i / 40, x = lerp(240, 1560, t), y = lerp(552, 172, t); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 14); ctx.stroke(); } ctx.restore();
    ctx.fillStyle = '#0a0809'; poly(ctx, [[260, 560], [680, 560], [680, 520], [1560, 520], [1560, 210]]); ctx.fill();
    ctx.strokeStyle = SEC; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(250, 562); ctx.lineTo(1566, 196); ctx.stroke();
    ctx.fillStyle = SEC; ctx.fillRect(1090, 250, 56, 290); ctx.fillRect(1082, 244, 72, 12); ctx.fillStyle = '#120f0d'; ctx.fillRect(1100, 236, 12, 10); ctx.fillRect(1124, 236, 12, 10);
    ctx.fillStyle = 'rgba(150,135,120,.1)'; for (let y = 262; y < 520; y += 12) ctx.fillRect(1090, y, 56, 1);
    // ladder (2505) from 700 up through the attic to the roof hatch (180)
    ctx.fillStyle = '#1a140c'; ctx.fillRect(2490, 175, 5, 585); ctx.fillRect(2522, 175, 5, 585); for (let y = 750; y > 180; y -= 26) ctx.fillRect(2490, y, 37, 4);
    ctx.fillStyle = 'rgba(220,190,140,.12)'; ctx.fillRect(2490, 175, 1.5, 585);
    // window glass hole (filled at runtime by the street view)
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fillRect(1240, 640, 57, 112); ctx.fillRect(1303, 640, 57, 112); ctx.fillRect(1240, 757, 57, 123); ctx.fillRect(1303, 757, 57, 123); ctx.restore();
    // soft room fog
    fog(ctx, noiseCanvas(W, 400, { scale: 120, seed: 77, lo: .35, hi: .85, stretchX: 2.5 }), 760, 950, [110, 125, 160], .06);
  }
};

/* ================= the street seen through the bedroom window ================= */
PLATES.street = {
  origin: [1200, 600], size: [200, 320], scale: 2.5, alpha: false,
  draw(ctx) {
    vgrad(ctx, 1200, 600, 200, 320, [[0, '#0b1222'], [.55, '#141c2c'], [1, '#1b2232']]);
    const r = rng(5); const sy = 860;
    ctx.fillStyle = '#080b13';
    [[1196, 70, 190], [1262, 60, 230], [1318, 90, 170]].forEach(([x, w, h]) => { ctx.fillRect(x, sy - h, w, h); poly(ctx, [[x - 3, sy - h], [x + w / 2, sy - h - 22], [x + w + 3, sy - h]]); ctx.fill();
      for (let wy = sy - h + 20; wy < sy - 24; wy += 34) for (let wx = x + 8; wx < x + w - 14; wx += 22) { const lit = r() < .14; ctx.fillStyle = lit ? 'rgba(255,196,120,.85)' : 'rgba(30,38,56,.8)'; ctx.fillRect(wx, wy, 8, 14); } ctx.fillStyle = '#080b13'; });
    ctx.fillStyle = 'rgba(255,190,110,.75)'; ctx.fillRect(1342, 700, 12, 18); glow(ctx, 1348, 709, 22, [255, 180, 100], .3);
    vgrad(ctx, 1200, sy, 200, 60, [[0, '#121722'], [1, '#0b0e15']]);
    // lamp posts; their flames are lit (and put out) at runtime
    [[1281, 740], [1236, 752], [1338, 746]].forEach(([x, y]) => { ctx.fillStyle = '#05070b'; ctx.fillRect(x - 1.2, y, 2.4, sy - y); ctx.fillStyle = '#16181e'; ctx.fillRect(x - 4, y - 9, 8, 9); ctx.fillStyle = '#05070b'; ctx.fillRect(x - 5, y - 11, 10, 2.4); });
  }
};

/* ================= rainy exterior around the house ================= */
PLATES.outside = {
  origin: [-600, -300], size: [3800, 1900], scale: .6, alpha: false,
  draw(ctx) {
    vgrad(ctx, -600, -300, 3800, 1900, [[0, '#04060b'], [.5, '#0b1120'], [.8, '#141a28'], [1, '#0a0c12']]);
    const cl = noiseCanvas(3800, 900, { scale: 260, seed: 7, lo: .35, hi: .85, stretchX: 2 });
    layer(ctx, x => { const g = x.createLinearGradient(0, -300, 0, 600); g.addColorStop(0, 'rgba(60,70,95,.6)'); g.addColorStop(.8, 'rgba(90,90,110,.12)'); g.addColorStop(1, 'rgba(90,90,110,0)'); x.fillStyle = g; x.fillRect(-600, -300, 3800, 900); x.globalCompositeOperation = 'destination-in'; x.drawImage(cl, -600, -300, 3800, 900); }, { comp: 'screen' });
    const r = rng(9);
    layer(ctx, x => { x.fillStyle = '#080a11'; let px = -620; while (px < 3220) { const w = 120 + r() * 200, h = 400 + r() * 500, top = 1400 - h; x.fillRect(px, top, w, h + 200); poly(x, [[px - 6, top], [px + w * .5, top - 50 - r() * 40], [px + w + 6, top]]); x.fill(); if (r() < .6) { const cx = px + w * (.2 + r() * .5); x.fillRect(cx, top - 70, 16, 70); }
      for (let wy = top + 40; wy < 1380; wy += 70) for (let wx = px + 16; wx < px + w - 30; wx += 44) if (r() < .1) { x.fillStyle = rgba([255, 190 + r() * 30, 110], .5 + r() * .4); x.fillRect(wx, wy, 14, 24); x.fillStyle = '#080a11'; }
      px += w + 20; } }, { fog: [[40, 52, 78], .2], blur: 1 });
    vgrad(ctx, -600, 1380, 3800, 220, [[0, '#0d1018'], [1, '#07080c']]);
    [-200, 400, 2900].forEach(x => { ctx.fillStyle = '#05070b'; ctx.fillRect(x - 3, 1180, 6, 210); ctx.fillStyle = 'rgba(255,214,150,.9)'; ctx.fillRect(x - 9, 1166, 18, 16); glow(ctx, x, 1172, 200, [255, 190, 110], .45); lightPool(ctx, x, 1400, 220, 20, [255, 190, 120], .4); });
    fog(ctx, noiseCanvas(3800, 500, { scale: 200, seed: 21, lo: .35, hi: .85, stretchX: 3 }), 1100, 1500, [90, 100, 130], .2);
  }
};

/* ================= observatory (world x 1300–4700, y −1340…200) ================= */
const DOME = { cx: 3000, cy: 160, rx: 1720, ry: 1440 };
const LAMPS_X = [1560, 1860, 2180, 2620, 2960, 3340, 3860, 4220, 4560];
function dPt(k, v) { return [DOME.cx + DOME.rx * k * Math.sqrt(Math.max(0, 1 - v * v)), DOME.cy - DOME.ry * v]; }
PLATES.obs_sky = {
  origin: [1100, -1500], size: [3800, 1800], scale: .6, alpha: false,
  draw(ctx) {
    vgrad(ctx, 1100, -1500, 3800, 1800, [[0, '#02040a'], [.5, '#081020'], [.8, '#121b2f'], [1, '#1b2236']]);
    const mw = noiseCanvas(3800, 1800, { scale: 260, seed: 3, lo: .42, hi: .9, stretchX: 1.6 });
    layer(ctx, x => { x.save(); x.translate(3000, -700); x.rotate(-.42); x.translate(-3000, 700); const g = x.createLinearGradient(0, -1250, 0, -150); g.addColorStop(0, 'rgba(120,140,200,0)'); g.addColorStop(.5, 'rgba(140,160,215,.55)'); g.addColorStop(1, 'rgba(120,140,200,0)'); x.fillStyle = g; x.fillRect(500, -2200, 5000, 3000); x.restore(); x.globalCompositeOperation = 'destination-in'; x.drawImage(mw, 1100, -1500, 3800, 1800); }, { comp: 'screen', alpha: .5 });
    stars(ctx, 3600, [1100, -1500, 3800, 1500], 7, { a: .95 });
    // city far below, smog lit from beneath
    vgrad(ctx, 1100, -60, 3800, 360, [[0, [60, 52, 50], 0], [.6, [92, 70, 52], .3], [1, [110, 80, 55], .45]]);
    const r = rng(21);
    layer(ctx, x => { x.fillStyle = '#0a0c12'; let px = 1080; x.beginPath(); x.moveTo(1080, 400); while (px < 4920) { const w = 40 + r() * 100, h = 30 + r() * 90; x.lineTo(px, 160 - h + 14); x.lineTo(px + w * .5, 160 - h); x.lineTo(px + w, 160 - h + 14); if (r() < .5) { const cx = px + w * (.2 + r() * .5); x.lineTo(cx, 160 - h + 6); x.lineTo(cx, 160 - h - 30); x.lineTo(cx + 10, 160 - h - 30); x.lineTo(cx + 10, 160 - h + 6); } px += w; } x.lineTo(4920, 400); x.closePath(); x.fill();
      poly(x, [[3700, 170], [3716, -40], [3722, -120], [3728, -40], [3744, 170]]); x.fill();
      for (let i = 0; i < 140; i++) { x.fillStyle = rgba([255, 190 + r() * 30, 110], .35 + r() * .5); x.fillRect(1100 + r() * 3800, 60 + r() * 100, 3 + r() * 3, 4 + r() * 3); } }, { fog: [[40, 52, 78], .4], blur: 1 });
  }
};
PLATES.obs_dome = {
  origin: [1250, -1340], size: [3500, 1560], scale: .75, alpha: true,
  draw(ctx) {
    const ks = []; for (let k = -1; k <= 1.0001; k += .1) ks.push(+k.toFixed(3));
    const vs = [0, .14, .28, .42, .55, .66, .76, .85, .92, .97, 1];
    const r = rng(31), slit = k => k >= .8 && k <= .9;
    for (let i = 0; i < ks.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
      if (slit(ks[i]) && vs[j] >= .14 && vs[j] < .76) continue;
      const a = dPt(ks[i], vs[j]), b = dPt(ks[i + 1], vs[j]), c = dPt(ks[i + 1], vs[j + 1]), d = dPt(ks[i], vs[j + 1]), t = r();
      poly(ctx, [a, b, c, d], rgba([90 + t * 40, 120 + t * 30, 170], .04 + t * .06));
      if (r() < .2) { const g = ctx.createLinearGradient(a[0], a[1], c[0], c[1]); g.addColorStop(.3, 'rgba(190,210,255,0)'); g.addColorStop(.5, 'rgba(190,210,255,.08)'); g.addColorStop(.7, 'rgba(190,210,255,0)'); poly(ctx, [a, b, c, d], g); }
    }
    const grime = noiseCanvas(3500, 1560, { scale: 160, seed: 44, lo: .5, hi: .95 });
    layer(ctx, x => { x.save(); x.beginPath(); x.moveTo(DOME.cx - DOME.rx, DOME.cy); x.ellipse(DOME.cx, DOME.cy, DOME.rx, DOME.ry, 0, Math.PI, 2 * Math.PI); x.closePath(); x.clip(); x.fillStyle = 'rgba(30,34,44,.35)'; x.fillRect(1250, -1340, 3500, 1560); x.restore(); x.globalCompositeOperation = 'destination-in'; x.drawImage(grime, 1250, -1340, 3500, 1560); }, {});
    ctx.save(); ctx.beginPath(); ctx.rect(1250, -1340, 3500, 1560); ctx.moveTo(DOME.cx - DOME.rx, DOME.cy); ctx.ellipse(DOME.cx, DOME.cy, DOME.rx, DOME.ry, 0, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fillStyle = '#05060a'; ctx.fill('evenodd'); ctx.restore();
    const iron = '#04050a', hi = 'rgba(150,170,215,.24)';
    ks.forEach(k => { const pts = []; for (let v = 0; v <= 1.0001; v += .02) pts.push(dPt(k, v)); ctx.lineWidth = Math.abs(k) > .99 ? 34 : 9; ctx.strokeStyle = iron; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.lineWidth = 1.6; ctx.strokeStyle = hi; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0] - 4, p[1]) : ctx.moveTo(p[0] - 4, p[1])); ctx.stroke(); });
    vs.slice(1, -1).forEach(v => { const a = dPt(-1, v), b = dPt(1, v); ctx.lineWidth = 6; ctx.strokeStyle = iron; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(DOME.cx, a[1] + 18, b[0], b[1]); ctx.stroke(); ctx.lineWidth = 1.3; ctx.strokeStyle = hi; ctx.beginPath(); ctx.moveTo(a[0], a[1] - 3); ctx.quadraticCurveTo(DOME.cx, a[1] + 15, b[0], b[1] - 3); ctx.stroke(); });
    ks.forEach(k => vs.forEach(v => { const p = dPt(k, v); ctx.fillStyle = iron; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(170,190,230,.3)'; ctx.beginPath(); ctx.arc(p[0] - 2, p[1] - 2, 1.8, 0, 7); ctx.fill(); }));
  }
};
PLATES.obs_mid = {
  origin: [1250, -560], size: [3500, 800], scale: 1, alpha: true,
  draw(ctx) {
    // warm haze from the lamps
    vgrad(ctx, 1250, -360, 3500, 520, [[0, [120, 90, 60], 0], [1, [150, 105, 60], .14]]);
    // left doorway where the Extinguisher enters
    ctx.fillStyle = '#020203'; ctx.beginPath(); ctx.moveTo(1400, 160); ctx.lineTo(1400, -40); ctx.quadraticCurveTo(1460, -110, 1520, -40); ctx.lineTo(1520, 160); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#0b0b10'; ctx.lineWidth = 12; ctx.stroke();
    // gallery railing at the back of the floor
    layer(ctx, x => railing(x, 70, 1300, 4700, { h: 90, step: 26 }), { fog: [[40, 40, 52], .22] });
    LAMPS_X.forEach(x => { ctx.fillStyle = '#05060a'; ctx.fillRect(x - 3, -10, 6, 80); ctx.beginPath(); ctx.moveTo(x - 10, -10); ctx.lineTo(x + 10, -10); ctx.lineTo(x + 5, 0); ctx.lineTo(x - 5, 0); ctx.fill(); ctx.fillRect(x - 9, -44, 18, 5); });
    celestialGlobe(ctx, 1660, 160, 52);
    // crank stand (2750; the wheel turns at runtime) and lever base (3050)
    ctx.fillStyle = '#07070b'; ctx.fillRect(2743, 40, 14, 120); ctx.fillRect(2716, 150, 68, 10); poly(ctx, [[2730, 160], [2743, 70], [2757, 70], [2770, 160]]); ctx.fill();
    ctx.fillStyle = '#07070b'; poly(ctx, [[3032, 160], [3068, 160], [3060, 120], [3040, 120]]); ctx.fill(); ctx.beginPath(); ctx.arc(3050, 118, 9, 0, 7); ctx.fill();
    // desk with star chart (3150–3320)
    ctx.fillStyle = '#060608'; ctx.fillRect(3150, 88, 170, 8); ctx.fillRect(3156, 96, 7, 64); ctx.fillRect(3307, 96, 7, 64); ctx.fillRect(3170, 96, 130, 20);
    ctx.save(); ctx.translate(3210, 86); ctx.rotate(-.05); ctx.fillStyle = 'rgba(200,184,148,.7)'; ctx.fillRect(-40, -3, 80, 4); ctx.restore();
    ctx.fillStyle = '#0a0806'; ctx.fillRect(3282, 66, 8, 22); ctx.fillStyle = '#0b0a0c'; ctx.beginPath(); ctx.ellipse(3250, 84, 8, 3.6, 0, 0, 7); ctx.fill();
    // observing platform with a step (3420–3640) under the eyepiece
    [[3420, 160, 40, 30], [3460, 160, 180, 60]].forEach(([x, y, w, h]) => { ctx.fillStyle = '#0c0a08'; ctx.fillRect(x, y - h, w, h); ctx.fillStyle = 'rgba(220,190,140,.16)'; ctx.fillRect(x, y - h, w, 2); ctx.strokeStyle = 'rgba(220,190,140,.06)'; ctx.lineWidth = 1; ctx.strokeRect(x + 5, y - h + 6, w - 10, h - 10); });
    ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3466, 100); ctx.lineTo(3466, 34); ctx.lineTo(3540, 34); ctx.stroke();
    // telescope pier (3700) and mount; the tube is drawn live
    poly(ctx, [[3676, -110], [3724, -110], [3760, 160], [3640, 160]], '#06070b'); hgrad(ctx, 3640, 140, 120, 20, [[0, '#06070b'], [.5, '#1a1712'], [1, '#06070b']]);
    ctx.fillStyle = 'rgba(160,180,220,.12)'; poly(ctx, [[3676, -110], [3680, -110], [3646, 160], [3640, 160]]); ctx.fill();
    ctx.fillStyle = '#0b0b0e'; ctx.fillRect(3664, -136, 72, 28);
    // toppled bookcase (3990–4080) where the lowered tube rests
    ctx.save(); ctx.translate(4035, 160); ctx.fillStyle = '#0b0907'; ctx.fillRect(-45, -40, 90, 40); ctx.strokeStyle = 'rgba(210,180,130,.12)'; ctx.strokeRect(-41, -36, 82, 32); const br = rng(3); for (let i = 0; i < 8; i++) { ctx.fillStyle = rgba([60 + br() * 40, 30 + br() * 20, 20], .9); ctx.fillRect(-38 + i * 10, -16 + br() * 8, 8, 14); } ctx.restore();
    [[4110, 160], [4150, 160]].forEach(([x, y], i) => { ctx.save(); ctx.translate(x, y); ctx.rotate(i ? .5 : -.2); ctx.fillStyle = rgba([70, 40, 24], .9); ctx.fillRect(-12, -5, 24, 5); ctx.restore(); });
    // spiral stair and catwalk at the right
    spiralStair(ctx, 4420, -440, 160, { r: 70 }); ctx.fillStyle = '#04050a'; ctx.fillRect(4300, -446, 360, 10); railing(ctx, -496, 4310, 4660, { h: 50, step: 20 });
    // floor slab with the roof hatch
    vgrad(ctx, 1300, 160, 3400, 40, [[0, '#121218'], [1, '#050506']]);
    ctx.save(); ctx.globalAlpha = .06; ctx.strokeStyle = '#c9b48c'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(1300, 164 + i * 9); ctx.lineTo(4700, 164 + i * 9); ctx.stroke(); } ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fillRect(2470, 160, 70, 40); ctx.restore();
    ctx.fillStyle = '#1a140c'; ctx.fillRect(2462, 156, 86, 6);
    ctx.fillStyle = SEC; ctx.fillRect(4660, -560, 90, 760); ctx.fillRect(1250, -560, 50, 760);
  }
};

/* ================= theatre from row seven (screen space) ================= */
PLATES.theatre = {
  origin: [0, 0], size: [1920, 1080], scale: 1, alpha: false,
  draw(ctx) {
    SCENES.K8(ctx, { noWoman: true }); // reuses the concept frame; the woman is drawn live so she can turn
  }
};
