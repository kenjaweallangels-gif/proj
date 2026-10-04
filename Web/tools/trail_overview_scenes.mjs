// Обзорные кадры тропы (сверху, с запада, из пустыни): node tools/level_shots.mjs --file=X.html --scenes=trail_overview_scenes.mjs --tag=trail_ov
export async function run({ hours, cam, shot }) {
  await hours(9.5);
  await cam(622, 120, 275.1, 622, 10, 275, 42, 900); await shot('ov_top');
  await cam(560, 40, 275, 640, 22, 272, 60, 900); await shot('ov_west');
  await cam(585, 30, 330, 630, 20, 280, 55, 900); await shot('ov_sw');
  await cam(600, 36, 252, 640, 27, 262, 55, 900); await shot('ov_nw');
}
