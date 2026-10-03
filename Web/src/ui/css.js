// Стили интерфейса. Опорный кадр 1080p: все размеры — в «единицах» --u (= высота окна / 1080).
// Тонкие линии, тёплый свет, никаких плашек (кроме необязательной подложки субтитров).
const U = (n) => `calc(${n} * var(--u))`;
const SERIF = '"Cormorant Garamond","Cormorant","EB Garamond",Garamond,"Palatino Linotype","Book Antiqua",Georgia,serif';
const SANS = 'Inter,"Segoe UI",Roboto,"Helvetica Neue",system-ui,sans-serif';
const SHADOW = `1px 1.5px 1px rgba(11,8,5,.7), 0 0 ${U(3)} rgba(11,8,5,.5), 0 0 ${U(14)} rgba(11,8,5,.5)`;

export const CSS = `
#ui { --u: 1px; --ochre:#C8A165; --ochre-red:#B5462C; --warm:#EFE6D8; --cold:#DCE4EC; --ibad:#6E9BC4; --ink:#0B0805;
  font-family:${SANS}; color:var(--warm); user-select:none; -webkit-user-select:none; }
#ui * { box-sizing:border-box; }
#ui .rk { position:absolute; inset:0; overflow:hidden; }
#ui .rk > * { position:absolute; }
#ui .rk.photo > :not(.photo-legend):not(.fade) { opacity:0 !important; visibility:hidden; }
#ui .txt { text-shadow:${SHADOW}; }

/* ---- HUD ---- */
#ui .ripple { left:50%; bottom:${U(64)}; width:${U(200)}; height:${U(72)}; margin-left:${U(-100)}; opacity:0; }
#ui .ripple svg, #ui .ticks svg { width:100%; height:100%; overflow:visible; filter:drop-shadow(0 0 ${U(1.5)} rgba(11,8,5,.85)) drop-shadow(0 0 ${U(6)} rgba(11,8,5,.35)); }
#ui .mode { left:50%; bottom:${U(70)}; width:${U(66)}; height:${U(39)}; margin-left:${U(-200)}; opacity:0; }
#ui .mode svg { width:100%; height:100%; overflow:visible; filter:drop-shadow(0 0 ${U(1.5)} rgba(11,8,5,.85)) drop-shadow(0 0 ${U(6)} rgba(11,8,5,.35)); }
#ui .ticks { left:50%; bottom:${U(40)}; width:${U(96)}; height:${U(12)}; margin-left:${U(-48)}; opacity:0; }
#ui .drop { right:${U(56)}; bottom:${U(56)}; width:${U(26)}; height:${U(30)}; opacity:0; }
#ui .drop svg { width:100%; height:100%; overflow:visible; filter:drop-shadow(0 0 ${U(1.5)} rgba(11,8,5,.85)) drop-shadow(0 0 ${U(6)} rgba(11,8,5,.35)); }
#ui .prompt { left:50%; top:50%; width:0; height:0; opacity:0; }
#ui .prompt .dot { position:absolute; left:${U(-1)}; top:${U(-1)}; width:${U(2)}; height:${U(2)}; border-radius:50%; background:rgba(239,230,216,.9); box-shadow:0 0 ${U(4)} rgba(11,8,5,.8); }
#ui .prompt .row { position:absolute; left:${U(22)}; top:0; transform:translateY(-50%); display:flex; align-items:center; gap:${U(10)}; white-space:nowrap; }
#ui .glyph { width:${U(18)}; height:${U(18)}; border:${U(1)} solid rgba(239,230,216,.85); border-radius:${U(3)}; font:500 ${U(11)}/${U(16)} ${SANS}; text-align:center; letter-spacing:0; color:var(--warm); text-shadow:none; box-shadow:0 0 ${U(5)} rgba(11,8,5,.55); }
#ui .verb { font:400 ${U(16)}/1 ${SANS}; letter-spacing:${U(1)}; color:var(--warm); }

/* ---- Субтитры ---- */
#ui .subs { left:50%; bottom:var(--sub-bottom, ${U(140)}); width:60%; z-index:6; transform:translateX(-50%); text-align:center; opacity:0; transition:opacity .35s linear; }
#ui .subs.on { opacity:1; transition:opacity .2s cubic-bezier(.2,.6,.3,1); }
#ui .subs .inner { display:inline-block; padding:0; }
#ui[data-bg="1"] .subs .inner { background:rgba(11,8,5,.45); padding:${U(8)} ${U(18)}; border-radius:${U(2)}; }
#ui .subs .name { font:500 ${U(16)}/1.2 ${SANS}; text-transform:uppercase; letter-spacing:.18em; color:var(--ochre); margin-bottom:${U(6)}; text-shadow:1px 1.5px 1px rgba(11,8,5,.8), 0 0 ${U(4)} rgba(11,8,5,.8), 0 0 ${U(12)} rgba(11,8,5,.55); }
#ui .subs .nat { font:italic 400 ${U(17)}/1.3 ${SERIF}; letter-spacing:.04em; color:rgba(200,161,101,.92); margin-bottom:${U(5)}; }
#ui[data-sub="S"] .subs .nat { font-size:${U(14)}; } #ui[data-sub="L"] .subs .nat { font-size:${U(22)}; }
#ui .subs .nat.tag { font:500 ${U(11)}/1 ${SANS}; font-style:normal; letter-spacing:.3em; text-transform:uppercase; color:rgba(239,230,216,.5); margin-bottom:${U(6)}; }
#ui .subs .line { font:400 ${U(26)}/1.32 ${SANS}; color:var(--warm); text-wrap:balance; }
#ui[data-sub="S"] .subs .name { font-size:${U(13)}; } #ui[data-sub="S"] .subs .line { font-size:${U(20)}; }
#ui[data-sub="L"] .subs .name { font-size:${U(21)}; } #ui[data-sub="L"] .subs .line { font-size:${U(34)}; }
#ui .bark { z-index:6; left:0; top:0; font:400 ${U(16)}/1.25 ${SANS}; color:var(--warm); max-width:${U(360)}; text-align:center; opacity:0; transform:translate(-50%,-100%); transition:opacity .2s linear; will-change:transform,opacity; }
#ui[data-sub="S"] .bark { font-size:${U(14)}; } #ui[data-sub="L"] .bark { font-size:${U(20)}; }
#ui .bark.out { transition:opacity .5s linear; }

/* ---- Титры, надписи, подсказка ---- */
#ui .tcard { left:0; right:0; top:64%; text-align:center; opacity:0; z-index:23; }
#ui .tcard .t { font:300 ${U(38)}/1.2 ${SERIF}; letter-spacing:.42em; padding-left:.42em; color:var(--warm); }
#ui .tcard .rule { width:${U(140)}; height:${U(1)}; margin:${U(18)} auto 0; background:rgba(200,161,101,.7); }
#ui .tcard.end { top:44%; } #ui .tcard.end .t { font-size:${U(44)}; letter-spacing:.3em; padding-left:.3em; }
#ui .lore { z-index:6; left:50%; top:50%; width:min(70%, ${U(1100)}); transform:translate(-50%,-50%); text-align:center; font:300 ${U(26)}/1.5 ${SERIF}; letter-spacing:.12em; opacity:0; }
#ui .lore .ins { display:block; margin-bottom:${U(12)}; font:400 ${U(22)}/1.3 ${SERIF}; letter-spacing:.32em; color:rgba(200,161,101,.95); text-shadow:0 1px 0 rgba(239,230,216,.25), 0 -1px 0 rgba(11,8,5,.8), 0 0 ${U(10)} rgba(11,8,5,.7); }
#ui .lore .desc { display:block; }
#ui .lore::before, #ui .lore::after { content:""; display:block; width:${U(60)}; height:${U(1)}; margin:0 auto; background:rgba(200,161,101,.6); }
#ui .lore::before { margin-bottom:${U(18)}; } #ui .lore::after { margin-top:${U(18)}; }
#ui .cut { left:0; right:0; top:50%; transform:translateY(-50%); text-align:center; font:300 ${U(30)}/1.3 ${SERIF}; letter-spacing:.3em; padding-left:.3em; color:var(--warm); opacity:0; z-index:22; }
#ui .hint { z-index:6; left:50%; top:var(--hint-top, ${U(96)}); transform:translateX(-50%); width:min(80%, ${U(1100)}); text-align:center; font:400 ${U(17)}/1.4 ${SANS}; color:rgba(239,230,216,.85); opacity:0; }

/* ---- Экранные эффекты ---- */
#ui .bar { left:0; right:0; background:#000; height:0; transition:transform .8s cubic-bezier(.45,0,.55,1); z-index:4; }
#ui .bar.top { top:0; transform:translateY(-100%); } #ui .bar.bot { bottom:0; transform:translateY(100%); }
#ui .bar.on { transform:none; }
#ui .fade { inset:0; background:#000; opacity:0; z-index:20; }

/* ---- Меню (пауза / титульный экран / концовка) ---- */
#ui .pause { inset:0; display:none; opacity:0; z-index:30; pointer-events:auto; background:rgba(11,8,5,.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); transition:opacity .25s ease-out; }
#ui .pause.on { display:block; } #ui .pause.vis { opacity:1; } #ui .pause.closing { transition:opacity .2s linear; }
#ui .menu { position:absolute; left:12%; top:50%; transform:translateY(-50%); }
#ui .menu .cap { font:500 ${U(13)}/1 ${SANS}; letter-spacing:.4em; color:rgba(200,161,101,.7); text-transform:uppercase; margin-bottom:${U(34)}; }
#ui .menu .item { position:relative; display:flex; align-items:baseline; gap:${U(14)}; width:max-content; padding:${U(7)} 0; font:300 ${U(30)}/1.1 ${SANS}; color:rgba(239,230,216,.72); cursor:pointer; letter-spacing:.01em; }
#ui .menu .item .val { font-size:${U(22)}; opacity:.9; }
#ui .menu .item::after { content:""; position:absolute; left:0; bottom:${U(2)}; height:${U(1.5)}; width:100%; background:var(--ochre); transform:scaleX(0); transform-origin:left; transition:transform .18s ease-out; }
#ui .menu .item.sel { color:var(--ochre); } #ui .menu .item.sel::after { transform:scaleX(1); }
#ui .menu .item.dim { opacity:.35; pointer-events:none; }
#ui .vbar { display:inline-block; width:${U(110)}; height:${U(2)}; background:rgba(239,230,216,.2); vertical-align:middle; position:relative; }
#ui .vbar b { position:absolute; left:0; top:0; bottom:0; background:currentColor; }
#ui .menu .legend, #ui .photo-legend { font:400 ${U(13)}/1.5 ${SANS}; color:rgba(239,230,216,.5); letter-spacing:.04em; margin-top:${U(34)}; }
#ui .photo-legend { left:${U(32)}; bottom:${U(32)}; margin:0; z-index:31; text-shadow:${SHADOW}; }
#ui .photo-legend .vals { color:rgba(239,230,216,.8); margin-bottom:${U(4)}; } #ui .photo-legend .keys { opacity:.8; }
#ui .photo-legend.hide { opacity:0; }

/* ---- Панель «Погода и время» (справа; слева остаётся мир для живого просмотра) ---- */
#ui .pause.wxonly { background:none; backdrop-filter:none; -webkit-backdrop-filter:none; pointer-events:none; }
#ui .pause.wxonly .menu { display:none; }
#ui .wx { right:0; top:0; bottom:0; width:min(${U(680)}, 56%); display:none; opacity:0; z-index:50; pointer-events:auto; transition:opacity .25s ease-out;
  background:linear-gradient(to left, rgba(11,8,5,.82) 0%, rgba(11,8,5,.66) 62%, rgba(11,8,5,0) 100%); }
#ui .wx.on { display:block; } #ui .wx.vis { opacity:1; }
#ui .wxc { position:absolute; right:${U(56)}; top:50%; transform:translateY(-50%); width:${U(410)}; max-height:94%; overflow:hidden; }
#ui .wxc .cap { font:500 ${U(13)}/1 ${SANS}; letter-spacing:.4em; color:rgba(200,161,101,.8); text-transform:uppercase; margin-bottom:${U(24)}; }
#ui .wrow { position:relative; margin-bottom:${U(13)}; }
#ui .wrow.sub { margin-top:${U(-9)}; }
#ui .wrow.sel::before { content:""; position:absolute; left:${U(-14)}; top:${U(3)}; bottom:${U(3)}; width:${U(1.5)}; background:var(--ochre); }
#ui .wh { display:flex; justify-content:space-between; align-items:baseline; font:400 ${U(13)}/1.2 ${SANS}; letter-spacing:.16em; text-transform:uppercase; color:rgba(239,230,216,.62); }
#ui .wrow.sel .wl { color:var(--ochre); }
#ui .wv { color:var(--warm); letter-spacing:.06em; font-size:${U(15)}; text-transform:none; }
#ui .wsl { height:${U(22)}; position:relative; cursor:pointer; touch-action:none; }
#ui .wsl .rail { position:absolute; left:0; right:0; top:50%; height:${U(2)}; margin-top:${U(-1)}; background:rgba(239,230,216,.2); }
#ui .wsl .rail.grad { height:${U(3)}; margin-top:${U(-1.5)}; opacity:.9; }
#ui .wsl .rail b { position:absolute; left:0; top:0; bottom:0; background:rgba(200,161,101,.8); }
#ui .wsl .rail.grad b { display:none; }
#ui .wsl .rail i { position:absolute; top:50%; width:${U(11)}; height:${U(11)}; margin:${U(-5.5)} 0 0 ${U(-5.5)}; border-radius:50%; background:var(--warm); box-shadow:0 0 ${U(8)} rgba(11,8,5,.85); }
#ui .wch { display:flex; flex-wrap:wrap; gap:${U(3)} ${U(10)}; margin-top:${U(6)}; font:500 ${U(13)}/1 ${SANS}; letter-spacing:.05em; color:rgba(239,230,216,.62); }
#ui .wch .ch { cursor:pointer; padding:${U(3)} ${U(1)}; border-bottom:${U(1)} solid transparent; transition:color .15s, border-color .15s; }
#ui .wch .ch:hover { color:var(--warm); } #ui .wch .ch.on { color:var(--ochre); border-bottom-color:var(--ochre); }
#ui .wch .sep { opacity:.3; padding-top:${U(3)}; }
#ui .wbtns { display:flex; flex-wrap:wrap; gap:${U(10)} ${U(26)}; margin-top:${U(20)}; }
#ui .wbtn { font:400 ${U(14)}/1 ${SANS}; letter-spacing:.04em; color:rgba(239,230,216,.75); cursor:pointer; padding:${U(4)} 0; border-bottom:${U(1)} solid rgba(200,161,101,.45); }
#ui .wbtn:hover, #ui .wrow.sel .wbtn, #ui .wbtn.sel { color:var(--ochre); border-bottom-color:var(--ochre); }
#ui .wbtn.sel { color:var(--ochre); }
#ui .wst { margin-top:${U(16)}; font:italic 400 ${U(14)}/1.3 ${SERIF}; color:rgba(239,230,216,.55); }
#ui .wlg { margin-top:${U(14)}; font:400 ${U(12)}/1.5 ${SANS}; color:rgba(239,230,216,.42); letter-spacing:.04em; }
#ui .title .opts .ch.wxlink { letter-spacing:.14em; }

#ui .title { inset:0; z-index:40; pointer-events:auto; cursor:pointer; transition:opacity .9s ease-in-out;
  background:radial-gradient(ellipse 80% 70% at 50% 58%, rgba(11,8,5,.18) 0%, rgba(11,8,5,.62) 70%, rgba(11,8,5,.86) 100%), linear-gradient(to bottom, rgba(11,8,5,.55) 0%, rgba(11,8,5,0) 38%, rgba(11,8,5,.0) 55%, rgba(11,8,5,.7) 100%); }
#ui .title.gone { opacity:0; pointer-events:none; }
#ui .title .logo { position:absolute; left:0; right:0; top:25%; text-align:center; }
#ui .title .logo .name { font:300 ${U(104)}/1 ${SERIF}; letter-spacing:.55em; padding-left:.55em; color:var(--warm); text-shadow:0 0 ${U(30)} rgba(11,8,5,.6); }
#ui .title .logo .rule { width:${U(180)}; height:${U(1)}; margin:${U(30)} auto ${U(22)}; background:rgba(200,161,101,.75); }
#ui .title .logo .sub { font:500 ${U(15)}/1 ${SANS}; letter-spacing:.7em; padding-left:.7em; color:var(--ochre); text-transform:uppercase; }
#ui .title .begin { position:absolute; left:0; right:0; top:66%; text-align:center; }
#ui .title .begin .a { font:300 ${U(21)}/1 ${SANS}; letter-spacing:.14em; color:var(--warm); animation:rkpulse 3.2s ease-in-out infinite; text-shadow:${SHADOW}; }
#ui .title .begin .b { margin-top:${U(10)}; font:300 ${U(13)}/1 ${SANS}; letter-spacing:.14em; color:rgba(239,230,216,.42); }
@keyframes rkpulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
#ui .title .opts { position:absolute; left:0; right:0; top:77%; display:flex; justify-content:center; gap:${U(54)}; cursor:default; }
#ui .title .opt { display:flex; align-items:baseline; gap:${U(12)}; font:500 ${U(12)}/1 ${SANS}; letter-spacing:.22em; text-transform:uppercase; color:rgba(239,230,216,.5); }
#ui .title .opt .ch { cursor:pointer; padding:${U(5)} ${U(2)}; color:rgba(239,230,216,.62); border-bottom:${U(1)} solid transparent; transition:color .15s, border-color .15s; }
#ui .title .opt .ch:hover { color:var(--warm); } #ui .title .opt .ch.on { color:var(--ochre); border-bottom-color:var(--ochre); }
#ui .title .opt .sep { opacity:.3; }
#ui .title .keys { position:absolute; left:0; right:0; bottom:${U(38)}; display:flex; justify-content:center; gap:${U(34)}; flex-wrap:wrap; padding:0 6%; color:rgba(239,230,216,.55); font:400 ${U(13)}/1 ${SANS}; letter-spacing:.04em; }
#ui .title .keys span { display:inline-flex; align-items:center; gap:${U(9)}; }
#ui .kcap { display:inline-block; min-width:${U(20)}; height:${U(20)}; padding:0 ${U(6)}; border:${U(1)} solid rgba(239,230,216,.4); border-radius:${U(3)}; font:500 ${U(11)}/${U(18)} ${SANS}; text-align:center; color:rgba(239,230,216,.8); letter-spacing:.04em; }

#ui .endcard { inset:0; z-index:25; display:none; pointer-events:auto; }
#ui .endcard.on { display:block; }
#ui .endcard .actions { position:absolute; left:0; right:0; top:62%; display:flex; justify-content:center; gap:${U(56)}; opacity:0; transition:opacity 1.2s ease-out; }
#ui .endcard .actions.vis { opacity:1; }
#ui .endcard .act { font:300 ${U(24)}/1 ${SANS}; letter-spacing:.06em; color:rgba(239,230,216,.7); padding:${U(8)} 0; cursor:pointer; position:relative; }
#ui .endcard .act::after { content:""; position:absolute; left:0; bottom:0; height:${U(1.5)}; width:100%; background:var(--ochre); transform:scaleX(0); transform-origin:left; transition:transform .18s ease-out; }
#ui .endcard .act.sel { color:var(--ochre); } #ui .endcard .act.sel::after { transform:scaleX(1); }
#ui .endcard .thanks { position:absolute; left:0; right:0; top:56%; text-align:center; font:300 ${U(17)}/1.5 ${SERIF}; letter-spacing:.16em; color:rgba(239,230,216,.6); opacity:0; transition:opacity 1.6s ease-out; }
#ui .endcard .thanks.vis { opacity:1; }
`;
