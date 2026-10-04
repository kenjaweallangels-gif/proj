import { useEffect, useRef, useState } from "react";
import { get, post } from "../api";
import { Badge, useAuth, useToast } from "../ui";

interface Msg { role: "u" | "a"; text: string; route?: string; pending?: { id: string; kind: string; payload: unknown; summary: string }[] }
const HINTS = ["состав РЧ-100.00.000", "куда входит ПОДШ 6206", "себестоимость РЧ-100.02.001", "дефицит", "MRP", "найди подшипник"];

export default function Chat() {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "a", text: "Здравствуйте! Спрашивайте о составах, применяемости, себестоимости, дефиците и потребности. Могу предложить изменения — они применятся только после вашего подтверждения." }]);
  const [text, setText] = useState("");
  const [conv, setConv] = useState<string | null>(null);
  const [cloud, setCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ local: boolean; cloud: boolean; cloud_allowed_for_user: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && !status) get<typeof status>("/api/ai/status").then(setStatus).catch(() => {}); }, [open, status]);
  useEffect(() => { box.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs]);
  const send = async (t = text) => {
    if (!t.trim() || busy) return;
    setMsgs((m) => [...m, { role: "u", text: t }]); setText(""); setBusy(true);
    try {
      const r = await post<{ conversation: string; reply: string; route: string; pending: Msg["pending"] }>("/api/ai/chat", { message: t, conversation: conv, allow_cloud: cloud });
      setConv(r.conversation); setMsgs((m) => [...m, { role: "a", text: r.reply, route: r.route, pending: r.pending }]);
    } catch (e) { setMsgs((m) => [...m, { role: "a", text: `Ошибка: ${(e as Error).message}` }]); } finally { setBusy(false); }
  };
  const apply = async (p: NonNullable<Msg["pending"]>[0]) => {
    try { const r = await post<Record<string, unknown>>("/api/ai/apply", p); toast("ok", `Применено: ${JSON.stringify(r)}`); setMsgs((m) => m.map((x) => ({ ...x, pending: x.pending?.filter((y) => y.id !== p.id) }))); } catch (e) { toast("err", (e as Error).message); }
  };
  return (
    <>
      <button className="chat-fab" onClick={() => setOpen(!open)} title="ИИ-ассистент">{open ? "✕" : "🤖"}</button>
      {open && (
        <div className="chat">
          <header><b>🤖 Ассистент</b>
            <span className="small muted">{status?.local ? "локальная LLM" : status?.cloud ? "облако" : "режим правил"}</span>
            {status?.cloud && status.cloud_allowed_for_user && <label className="small right" title="Облачная модель используется только для неконфиденциальных данных"><input type="checkbox" style={{ width: "auto" }} checked={cloud} onChange={(e) => setCloud(e.target.checked)} /> облако</label>}
          </header>
          <div className="msgs" ref={box}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "grid", justifyItems: m.role === "u" ? "end" : "start", gap: 4 }}>
                <div className={`msg ${m.role}`}>{m.text}</div>
                {m.route && <span className="small muted">{{ rules: "по правилам", local: "локальная модель", cloud: "облачная модель", "cloud!": "облако (коснулось конф. данных — зафиксировано в аудите)" }[m.route] ?? m.route}</span>}
                {m.pending?.map((p) => <div key={p.id} className="pending"><b>Предложение:</b> {p.summary}<div className="row">
                  {can({ create_item: "items:write", change_notice: "ecn:create", stock_move: "stock:write" }[p.kind] ?? "*") ? <button className="sm primary" onClick={() => apply(p)}>✔ Применить</button> : <Badge tone="red">нет прав</Badge>}
                  <button className="sm" onClick={() => setMsgs((mm) => mm.map((x) => ({ ...x, pending: x.pending?.filter((y) => y.id !== p.id) })))}>Отклонить</button></div></div>)}
              </div>
            ))}
            {busy && <div className="msg a muted">…</div>}
          </div>
          <footer>
            <div className="row">{HINTS.map((h) => <button key={h} className="sm" onClick={() => send(h)}>{h}</button>)}</div>
            <div className="row"><input placeholder="Спросите или дайте команду…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} /><button className="primary" disabled={busy} onClick={() => send()}>➤</button></div>
          </footer>
        </div>
      )}
    </>
  );
}
