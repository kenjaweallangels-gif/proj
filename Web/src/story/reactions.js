// Реакции спутников и бантер (в UE это делают компаньоны через IsConditionMet + PlayLine).
// Здесь — лёгкий планировщик: обучающие реплики (походка/поверхность), бантер по зонам, реплики на состояния червя.
// Играет только в «тишине»: нет сюжетной реплики; каждая цепочка — один раз.
export function createReactions(game, story) {
  const { bus } = game;
  const played = new Set();
  const sustain = {};
  let sinceEnd = 99, zoneTime = 0, lastZone = '', acc = 0;

  bus.on('chain:end', ({ id } = {}) => { if (id) played.add(id); sinceEnd = 0; });
  bus.on('interact', ({ tag } = {}) => { if (tag === 'Rakis.Thumper') game.dialogue?.tryPlay('DLG_THM_001'); });

  const p = () => game.player;
  const reg = () => (p()?.sandWalking ? p().regularity ?? 0 : -1);
  const inZone = (z, after) => game.zone === z && zoneTime >= after;
  const calm = () => (game.worm?.state ?? 'Dormant') === 'Dormant' && !story.isFired('SB_A2_10_Tension');
  const surf = (name) => game.dialogue?.isConditionMet(`Surface:${name}`);
  const ws = (s) => game.worm?.state === s;

  const prevPlayed = (id) => played.has(id);
  // gap — мин. пауза после последней реплики; hold — сколько секунд условие должно держаться.
  // Порядок в списке = приоритет. Сцены-разговоры (3–6 реплик) играют по цепочке NextID и не накладываются друг на друга.
  const RULES = [
    { id: 'DLG_TUT_001', gap: 5, hold: 4, test: () => game.zone?.startsWith('A') && reg() > 0.75 },
    { id: 'DLG_TUT_003', gap: 5, hold: 3, test: () => game.zone?.startsWith('A') && reg() >= 0 && reg() < 0.3 && story.isFired('SB_A1_04_Hint') },
    { id: 'DLG_TUT_004', gap: 8, hold: 2, test: () => game.space === 'desert' && surf('Rock') && story.isFired('SB_A1_04_Hint') },
    { id: 'DLG_TUT_006', gap: 8, hold: 2, test: () => game.space === 'desert' && surf('PackedSand') },
    { id: 'DLG_TUT_005', gap: 40, hold: 5, test: () => reg() > 0.75 && played.has('DLG_TUT_001') },
    // эрг до появления наездников: религия (Бог в черве), семья (свадьба или мешок), жалобы на костюм
    { id: 'DLG_A2_B01', gap: 6, hold: 0, test: () => inZone('A2_Erg', 18) && calm() },
    { id: 'DLG_A2_B40', gap: 10, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && p()?.moisture < 0.5 },
    { id: 'DLG_A2_B30', gap: 6, hold: 0, test: () => inZone('A2_Erg', 30) && calm() && prevPlayed('DLG_A2_B01') },
    { id: 'DLG_A2_B42', gap: 20, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && surf('Rock') },
    { id: 'DLG_A2_B45', gap: 20, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && p()?.moisture < 0.35 },
    // Коготь: вести Оссаны, вера, десятина, шутки про песок, обычаи мёртвых
    { id: 'DLG_A3_030', gap: 20, hold: 0, test: () => inZone('A3_Approach', 22) && story.isCompleted('SB_A3_02_Ossana') },
    { id: 'DLG_A3_040', gap: 22, hold: 0, test: () => inZone('A3_Approach', 45) && played.has('DLG_A3_030') },
    { id: 'DLG_A3_050', gap: 22, hold: 0, test: () => inZone('A3_Approach', 60) && played.has('DLG_A3_040') },
    { id: 'DLG_A2_B20', gap: 20, hold: 0, test: () => inZone('A3_Approach', 80) && played.has('DLG_A3_050') },
    { id: 'DLG_A2_B50', gap: 20, hold: 0, test: () => inZone('A3_Approach', 105) && played.has('DLG_A2_B20') },
    // тропа по скале
    { id: 'DLG_A5_010', gap: 12, hold: 0, test: () => inZone('A5_Trail', 26) && story.isCompleted('SB_A5_03_Hidden') },
    // сиетч: галерея (рынок) — разговоры спутников и подслушанные сцены
    { id: 'DLG_B2_B01', gap: 14, hold: 0, test: () => inZone('B2_Gallery', 12) },
    { id: 'DLG_B2_K10', gap: 14, hold: 0, test: () => inZone('B2_Gallery', 24) },
    { id: 'DLG_B2_M10', gap: 14, hold: 0, test: () => inZone('B2_Gallery', 38) },
    { id: 'DLG_B2_M30', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 52) },
    { id: 'DLG_B2_R10', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 66) },
    { id: 'DLG_B2_M40', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 80) },
    { id: 'DLG_B2_B06', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 92) && played.has('DLG_B2_B01') },
    { id: 'DLG_B2_P10', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 104) },
    { id: 'DLG_B2_M20', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 116) },
    { id: 'DLG_B2_F10', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 128) },
    { id: 'DLG_B2_G10', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 140) },
    { id: 'DLG_B2_B08', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 150) && played.has('DLG_B2_B06') },
    { id: 'DLG_B2_B09', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 162) && played.has('DLG_B2_B08') },
    { id: 'DLG_B2_C20', gap: 16, hold: 0, test: () => inZone('B2_Gallery', 176) && played.has('DLG_B2_B09') },
    // проходы и цистерна
    { id: 'DLG_B3_S01', gap: 10, hold: 0, test: () => inZone('B3_Passages', 16) },
    { id: 'DLG_B4_C01', gap: 10, hold: 0, test: () => inZone('B4_Cistern', 14) },
    // после зала: жизнь продолжается
    { id: 'DLG_PH_001', gap: 8, hold: 6, test: () => story.isCompleted('SB_B5_08_Ossana') },
    // сад
    { id: 'DLG_C1_G10', gap: 10, hold: 0, test: () => inZone('C1_Garden', 28) && story.isCompleted('SB_C1_04_Birds') },
    { id: 'DLG_C1_010', gap: 14, hold: 0, test: () => inZone('C1_Garden', 52) && played.has('DLG_C1_G10') },
    { id: 'DLG_C1_020', gap: 14, hold: 0, test: () => inZone('C1_Garden', 76) && played.has('DLG_C1_010') },
    // червь
    { id: 'DLG_WRM_L02', gap: 0, hold: 3, test: () => ws('Listening') && played.has('DLG_WRM_L01') },
    { id: 'DLG_WRM_L03', gap: 0, hold: 5, test: () => ws('Listening') },
    { id: 'DLG_WRM_A02', gap: 0, hold: 2, test: () => ws('Approach') },
    { id: 'DLG_WRM_A03', gap: 0, hold: 7, test: () => ws('Approach') && played.has('DLG_WRM_A02') },
    { id: 'DLG_WRM_S01', gap: 0, hold: 0.3, test: () => ws('Surface') },
    { id: 'DLG_WRM_S02', gap: 0, hold: 3, test: () => ws('Surface') && played.has('DLG_WRM_S01') },
  ];

  return {
    played,
    update(dt) {
      sinceEnd += dt;
      if (game.zone === lastZone) zoneTime += dt; else { lastZone = game.zone; zoneTime = 0; }
      acc += dt;
      if (acc < 0.5) return;
      const step = acc; acc = 0;
      const d = game.dialogue;
      if (!story.started || !d || d.isBusy || game.cinematic?.active || game.ui?.blocking) {
        for (const k in sustain) sustain[k] = 0;
        return;
      }
      for (const r of RULES) {
        if (played.has(r.id) || sinceEnd < r.gap) continue;
        let want = false;
        try { want = !!r.test(); } catch { want = false; }
        if (!want) { sustain[r.id] = 0; continue; }
        sustain[r.id] = (sustain[r.id] || 0) + step;
        if (sustain[r.id] >= r.hold) {
          played.add(r.id);
          d.tryPlay(r.id);
          return; // одна реплика за опрос
        }
      }
    },
  };
}
