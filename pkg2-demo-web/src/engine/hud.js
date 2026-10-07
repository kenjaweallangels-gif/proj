// HUD внутри окна дисплея очков (DOM поверх канвы, смешивание «screen» — как свет на прозрачном дисплее).
// Угловая панель: алгоритм (шаги), лист КД с подсветкой позиции (в негативе — белый фон на очках слепит), чат.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-step"><span class="hud-n"></span><span class="hud-title"></span></div>
      <div class="hud-info"></div>
      <div class="hud-bar"><i></i></div>
      <div class="hud-toast" hidden></div>
      <div class="hud-status"></div>
      <aside class="hud-panel" data-open="false">
        <nav><button data-tab="algo">Алгоритм</button><button data-tab="kd">КД</button><button data-tab="chat">Чат</button></nav>
        <section data-pane="algo"><ol class="hud-steps"></ol></section>
        <section data-pane="kd"><div class="hud-kd"><img alt=""><b class="hud-kd-pos"></b></div><p class="hud-kd-title"></p></section>
        <section data-pane="chat"><ul class="hud-chat"></ul></section>
      </aside>`;
    this.$ = (sel) => root.querySelector(sel);
    this.panel = this.$('.hud-panel');
    this.tab = 'algo';
    this.panel.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    this.showTab('algo');
    this.toastT = 0;
  }

  layout(r) {
    Object.assign(this.root.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    this.root.style.setProperty('--u', `${Math.max(9, Math.min(20, r.h / 30))}px`);
  }

  setVisible(v) { this.root.hidden = !v; }

  setStep(P, player) {
    const s = player.step;
    this.$('.hud-n').textContent = `${player.index + 1}/${player.total}`;
    this.$('.hud-title').textContent = s.title;
    const info = [];
    if (s.tool) info.push(s.tool);
    if (s.params?.torque_nm) info.push(`момент ${String(s.params.torque_nm).replace('.', ',')} Н·м`);
    if (s.params?.gap_mm != null) info.push(`зазор ${s.params.gap_mm} мм`);
    if (s.fasteners.length) {
      const f = P.fasteners.get(s.fasteners[0]);
      info.push(`${f?.designation ?? 'крепёж'} × ${s.fasteners.length}`);
    }
    if (s.check?.text) info.push(s.check.text);
    this.$('.hud-info').textContent = info.join(' · ');
    this.$('.hud-steps').innerHTML = P.steps.map((x, i) =>
      `<li class="${i < player.index ? 'done' : i === player.index ? 'cur' : ''}"><span>${i + 1}</span>${esc(x.title)}${x.critical ? ' <em>крит.</em>' : ''}</li>`).join('');
    // лист КД: первый лист шага; позиция первой детали
    const sheet = P.kdSheets.get(s.kd[0]);
    const part = P.parts.get(s.parts[0]);
    const img = this.$('.hud-kd img');
    const box = this.$('.hud-kd-pos');
    if (sheet) {
      if (img.dataset.src !== sheet.url) { img.src = sheet.url; img.dataset.src = sheet.url; }
      this.$('.hud-kd-title').textContent = `${sheet.title}${part?.kd ? ` · поз. ${part.kd.position} — ${part.designation}` : ''}`;
      const pos = part?.kd && sheet.positions[part.kd.position];
      const place = () => {
        if (!pos || !img.naturalWidth) { box.hidden = true; return; }
        const k = img.clientWidth / img.naturalWidth;
        Object.assign(box.style, { left: `${pos[0] * k}px`, top: `${pos[1] * k}px`, width: `${pos[2] * k}px`, height: `${pos[3] * k}px` });
        box.hidden = false;
      };
      img.onload = place; place();
    } else {
      img.removeAttribute('src'); img.dataset.src = ''; box.hidden = true;
      this.$('.hud-kd-title').textContent = 'Для шага нет листа КД';
    }
  }

  progress(k) { this.$('.hud-bar i').style.width = `${Math.round(Math.min(1, Math.max(0, k)) * 100)}%`; }
  status(text, warn = false) { const el = this.$('.hud-status'); el.textContent = text; el.classList.toggle('warn', warn); }

  togglePanel(open = this.panel.dataset.open !== 'true') { this.panel.dataset.open = String(open); return open; }
  showTab(tab) {
    this.tab = tab;
    this.panel.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    this.panel.querySelectorAll('section').forEach((s) => { s.hidden = s.dataset.pane !== tab; });
  }

  chat(author, text, me = false) {
    const li = document.createElement('li');
    li.className = me ? 'me' : '';
    li.innerHTML = `<b>${esc(author)}</b> ${esc(text)}`;
    const ul = this.$('.hud-chat');
    ul.append(li);
    while (ul.children.length > 30) ul.firstChild.remove();
    ul.scrollTop = ul.scrollHeight;
    if (!me) this.toast(`${author}: ${text}`);
  }

  toast(text) {
    const t = this.$('.hud-toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; }, 5000);
  }
}
