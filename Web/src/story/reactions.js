// Реакции спутников и бантер (в UE это делают компаньоны через IsConditionMet + PlayLine).
// Здесь — лёгкий планировщик: обучающие реплики (походка/поверхность), бантер по зонам, реплики на состояния червя.
// Играет только в «тишине»: нет кат-сцены, склейки, сюжетной реплики; каждая цепочка — один раз.
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

  // gap — мин. пауза после последней реплики; hold — сколько секунд условие должно держаться
  const RULES = [
    { id: 'DLG_TUT_001', gap: 5, hold: 4, test: () => game.zone?.startsWith('A') && reg() > 0.75 },
    { id: 'DLG_TUT_003', gap: 5, hold: 3, test: () => game.zone?.startsWith('A') && reg() >= 0 && reg() < 0.3 && story.isFired('SB_A1_04_Hint') },
    { id: 'DLG_TUT_004', gap: 8, hold: 2, test: () => game.space === 'desert' && surf('Rock') && story.isFired('SB_A1_04_Hint') },
    { id: 'DLG_TUT_006', gap: 8, hold: 2, test: () => game.space === 'desert' && surf('PackedSand') },
    { id: 'DLG_TUT_005', gap: 40, hold: 5, test: () => reg() > 0.75 && played.has('DLG_TUT_001') },
    // эрг: бантер до напряжения
    { id: 'DLG_A2_B01', gap: 22, hold: 0, test: () => inZone('A2_Erg', 26) && calm() },
    { id: 'DLG_A2_B03', gap: 24, hold: 0, test: () => inZone('A2_Erg', 40) && calm() && played.has('DLG_A2_B01') },
    { id: 'DLG_A2_B10', gap: 20, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && p()?.moisture < 0.5 },
    { id: 'DLG_A2_B12', gap: 20, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && surf('Rock') },
    { id: 'DLG_A2_B07', gap: 24, hold: 0, test: () => inZone('A2_Erg', 55) && calm() && played.has('DLG_A2_B03') },
    { id: 'DLG_A2_B14', gap: 20, hold: 2, test: () => inZone('A2_Erg', 20) && calm() && p()?.moisture < 0.35 },
    { id: 'DLG_A2_B15', gap: 24, hold: 0, test: () => inZone('A2_Erg', 70) && calm() && played.has('DLG_A2_B07') },
    // Коготь
    { id: 'DLG_A3_030', gap: 25, hold: 0, test: () => inZone('A3_Approach', 22) && (story.isCompleted('SB_A3_02_Ossana') || story.isCompleted('SB_A3_G1_Ossana')) },
    { id: 'DLG_A3_040', gap: 25, hold: 0, test: () => inZone('A3_Approach', 50) && played.has('DLG_A3_030') },
    // сиетч
    { id: 'DLG_B2_B01', gap: 18, hold: 0, test: () => inZone('B2_Gallery', 12) },
    { id: 'DLG_B2_B08', gap: 22, hold: 0, test: () => inZone('B2_Gallery', 30) && played.has('DLG_B2_B01') },
    { id: 'DLG_B2_B06', gap: 22, hold: 0, test: () => inZone('B2_Gallery', 55) && played.has('DLG_B2_B08') },
    { id: 'DLG_B2_B09', gap: 22, hold: 0, test: () => inZone('B2_Gallery', 80) && played.has('DLG_B2_B06') },
    { id: 'DLG_B2_C07', gap: 22, hold: 0, test: () => inZone('B2_Gallery', 100) && played.has('DLG_B2_B09') },
    // червь
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
      const phase = story.ellipsisPhase;
      if (!story.started || !d || d.isBusy || game.cinematic?.active || game.ui?.blocking || (phase !== 'none' && phase !== 'offer') || story.ended) {
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
