// Схема входа с улицы (трап, площадка, ограждения, стена корпуса у двери) для интерьера и для node-аудита.
import { GANG, LANDING, DOOR, FA, SINK, CONSOLE_POS } from './layout.js';
import { rampY } from './hull.js';

/** Схема входа с улицы: трап, посадочная площадка, порог двери, ограждения, стена корпуса вокруг двери. */
export function exteriorPlan(plan) {
  const zc = GANG.zc, hw = GANG.w / 2;
  plan.addFloor(GANG.xTop, zc - hw, GANG.xFoot, zc + hw, FA, GANG.yFoot, 'x', 'metal');
  plan.addFloor(LANDING.x0, LANDING.z0, LANDING.x1, LANDING.z1, FA, FA, 'x', 'metal');
  plan.addFloor(DOOR.x0, 19.0, DOOR.x1, LANDING.z0 + 0.02, FA, FA, 'x', 'metal');
  for (let x = GANG.xTop; x < GANG.xFoot; x += 1.0) {
    const xm = x + 0.5, y = rampY(xm);
    for (const z of [zc - hw, zc + hw]) plan.addBlock(x, y - 0.15, z - 0.1, x + 1.0, y + 1.2, z + 0.1);
  }
  plan.addBlock(LANDING.x0 - 0.1, FA - 0.05, LANDING.z1 - 0.1, LANDING.x1, FA + 1.2, LANDING.z1 + 0.1);
  plan.addBlock(LANDING.x0 - 0.1, FA - 0.05, LANDING.z0 + 0.4, LANDING.x0 + 0.1, FA + 1.2, LANDING.z1);
  plan.addBlock(LANDING.x1 - 0.1, FA - 0.05, LANDING.z0 + 0.4, LANDING.x1 + 0.1, FA + 1.2, zc - hw);
  // борт корпуса справа и слева от двери (стена 19.4..20.2) и перемычка над дверью
  plan.addBlock(4, FA - 1, 19.4, DOOR.x0, FA + 9, 20.2);
  plan.addBlock(DOOR.x1, FA - 1, 19.4, 18, FA + 9, 20.2);
  plan.addBlock(DOOR.x0, DOOR.y1, 19.4, DOOR.x1, FA + 9, 20.2);
  // створка шлюза (опускающаяся шторка): твёрдая, пока закрыта; index.js сдвигает y0/y1 в «пустоту», когда шторка поднята
  plan.addBlock(DOOR.x0, FA, 19.4, DOOR.x1, DOOR.y1, 20.2);
  plan.doorBlock = plan.blockers[plan.blockers.length - 1];
  plan.doorBlock.home = { y0: plan.doorBlock.y0, y1: plan.doorBlock.y1 };
  // боковые стойки жёлтой рамы двери (выступают из борта на 0.5 м)
  plan.addBlock(DOOR.x0 - 0.55, FA, 20.15, DOOR.x0 - 0.05, DOOR.y1 + 0.9, 20.7);
  plan.addBlock(DOOR.x1 + 0.05, FA, 20.15, DOOR.x1 + 0.55, DOOR.y1 + 0.9, 20.7);
}


/**
 * Твёрдые элементы СНАРУЖИ корпуса (для игрока на грунте): локальные координаты, {x0,x1,z0,z1,y0,y1}; y — по шкале модели (песок = SINK).
 * Пульт у подножия, опоры и поперечины под трапом, ноги посадочной площадки, фонарные столбы, сам пандус там, где под ним нет головы.
 */
export const EXT_SOLIDS = (() => {
  const out = [], zc = GANG.zc, hw = GANG.w / 2;
  const box = (cx, cz, sx, sz, y0, y1) => out.push({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2, y0, y1 });
  box(CONSOLE_POS.x, CONSOLE_POS.z, 1.9, 1.4, SINK - 1, SINK + 2.0);                                  // пульт запуска
  for (const x of [18.5, 25.5, 32.5]) {                                                                // опоры пандуса + поперечина
    const y = rampY(x);
    for (const s of [-1, 1]) box(x, zc + s * (hw - 0.1), 0.4, 0.4, SINK - 1, y);
    box(x, zc, 0.3, GANG.w, y - 1.95, y - 1.65);
  }
  for (const [x, z] of [[LANDING.x0 + 0.5, LANDING.z1 - 0.5], [LANDING.x1 - 0.5, LANDING.z1 - 0.5], [LANDING.x0 + 0.5, LANDING.z0 + 0.5]]) box(x, z, 0.55, 0.55, SINK - 1, FA);
  for (const x of [GANG.xFoot - 2, 29, 22]) box(x, zc + hw + 0.25, 0.22, 0.22, SINK - 1, rampY(x) + 4.4);   // фонарные столбы
  // настил пандуса с бортами: кусками по 1 м (голову не просунуть под низким настилом у подножия)
  for (let x = GANG.xTop; x < GANG.xFoot; x += 1.0) {
    const lo = rampY(Math.min(x + 1.0, GANG.xFoot));
    out.push({ x0: x, x1: x + 1.0, z0: zc - hw, z1: zc + hw, y0: lo - 0.8, y1: rampY(x) });
  }
  return out;
})();
