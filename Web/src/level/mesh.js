// Меш подхода из SDF-сетки: обрезка граней (под ландшафтом, внутри скалы, «лицо» массы стены) и атрибут aMark (протоптанность, наносы).
// Без THREE: общий код для игры (index.js) и node-проверок (tools/trail_check_node.mjs).
import { smooth, noise3 } from './sdf.js';
import { WALL_IN } from './scene.js';
import { ENTRY } from '../core/layout.js';

export const NOTCH_X_MAX = 652.4;       // дальше — внутренность сиетча (его коллизия/меш)

export function buildApproachMesh(S, vol, { base, wallX }) {
  const nz = ENTRY.cleft.z;
  const wxPlane = (z, y) => wallX(z, y) + WALL_IN;
  const cull = (x0, y0, z0, x1, y1, z1, x2, y2, z2, nxv) => {
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    // под землёй
    if (y0 < base(x0, z0) + 0.07 && y1 < base(x1, z1) + 0.07 && y2 < base(x2, z2) + 0.07) return true;
    // за входом (внутри скалы) — сиетч рисует свой интерьер
    if (cx > NOTCH_X_MAX && Math.abs(cz - nz) < 6 && cy > 24 && cy < 40) return true;
    const w0 = wxPlane(z0, y0), w1 = wxPlane(z1, y1), w2 = wxPlane(z2, y2);
    const nearNotch = Math.hypot(cz - nz, (cy - 32) * 0.7) < 6.5 || (Math.abs(cz - nz) < 5 && cy > 26 && cy < 40);
    // «лицо» массы стены (она целиком внутри скалы, на WALL_IN за гранью Когтя): его рисует сам Коготь
    if (nxv < -0.55 && !nearNotch && Math.abs(x0 - w0) < 0.4 && Math.abs(x1 - w1) < 0.4 && Math.abs(x2 - w2) < 0.4) return true;
    // всё, что целиком глубже грани Когтя (кроме ниши-тоннеля): невидимо снаружи, лишние треугольники
    if (!nearNotch && x0 > w0 + 0.1 && x1 > w1 + 0.1 && x2 > w2 + 0.1) return true;
    return false;
  };
  const mark = (x, y, z, nxv, nyv, nzv, out) => {
    const pd = S.pathDist(x, z);
    let worn = 0;
    if (nyv > 0.7 && Math.abs(y - pd.yp) < 0.55) worn = 1 - smooth(0.0, 1.1, pd.d);
    if (pd.leg && pd.leg.slot) worn *= 0.85;
    // наносы песка — во впадинах (вогнутость по SDF), на пологом; и у кромки ландшафта (мягкий стык со «слоем» песка пустыни)
    const r = 0.9;
    const open = vol.sample(x + nxv * r, y + nyv * r, z + nzv * r);
    const hollow = Math.min(1, Math.max(0, 1 - open / r));
    let drift = 0;
    if (nyv > 0.5) {
      const nz2 = 0.55 + 0.45 * noise3(x * 0.8, 1.7, z * 0.8);
      drift = smooth(0.12, 0.55, hollow) * smooth(0.5, 0.9, nyv) * nz2;
      const above = y - base(x, z);
      drift = Math.max(drift, (1 - smooth(0.05, 1.0, above)) * 0.9);
    }
    out[0] = worn; out[1] = Math.min(1, drift);
  };
  return vol.mesh({ cull, mark });
}
