#!/usr/bin/env python3
"""
Оркестратор мультиагентной разработки «Rakis: Heretics».

Маршрутизирует задачи с доски (tasks.yaml) по ролям и движкам
(Claude Code / Codex / Kimi / Cursor), запускает каждую задачу в отдельном
git worktree, собирает handoff, назначает кросс-ревью другим движком
и останавливается на «воротах» (gate) для решения человека.

Команды:
  status                         — доска задач
  run [--max N] [--task ID] [--parallel N] [--dry-run] [--no-worktree] [--no-review]
  review ID                      — повторить ревью
  approve ID [--merge]           — решение человека на воротах → done (+ слияние ветки)
  reject ID [--note TEXT]        — вернуть в todo
  set ID STATUS                  — вручную сменить статус
  prompt ID                      — показать промпт задачи (отладка)
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Нужен PyYAML: pip install pyyaml (или uv pip install pyyaml)")

ROOT = Path(__file__).resolve().parent.parent
ORCH = ROOT / "orchestrator"
TASKS_FILE = ORCH / "tasks.yaml"
ROLES_FILE = ORCH / "roles.yaml"
ENGINES_FILE = ORCH / "engines.yaml"
HANDOFFS = ORCH / "handoffs"
LOGS = ORCH / "logs"
WT_ROOT = ROOT.parent / f"{ROOT.name}-wt"
MAX_ATTEMPTS = 2
HANDOFF_CHARS = 6000  # сколько символов handoff зависимостей подмешивать в промпт

_lock = threading.RLock()
STATUSES = {"todo", "running", "review", "gate", "done", "blocked"}


# ---------- IO ----------
def load_yaml(p: Path) -> dict:
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def save_tasks(board: dict) -> None:
    with _lock:  # noqa
        TASKS_FILE.write_text(
            yaml.safe_dump(board, allow_unicode=True, sort_keys=False, width=120),
            encoding="utf-8",
        )


def strip_frontmatter(text: str) -> str:
    return re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.S).strip()


def log(msg: str) -> None:
    ts = dt.datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    with _lock, open(LOGS / "orchestrator.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ---------- доска ----------
def find(board: dict, tid: str) -> dict:
    for t in board["tasks"]:
        if t["id"] == tid:
            return t
    sys.exit(f"Задача {tid} не найдена")


def ready_tasks(board: dict) -> list[dict]:
    done = {t["id"] for t in board["tasks"] if t["status"] == "done"}
    return [t for t in board["tasks"] if t["status"] == "todo" and set(t.get("deps", [])) <= done]


def set_status(board: dict, task: dict, status: str, **extra) -> None:
    """Атомарно: перечитать доску, обновить одну задачу, сохранить (безопасно для потоков)."""
    assert status in STATUSES, status
    with _lock:
        fresh = load_yaml(TASKS_FILE)
        for t in fresh["tasks"]:
            if t["id"] == task["id"]:
                t["status"] = status
                t.update(extra)
                t["updated"] = dt.datetime.now().isoformat(timespec="seconds")
                task.clear(); task.update(t)
        TASKS_FILE.write_text(
            yaml.safe_dump(fresh, allow_unicode=True, sort_keys=False, width=120),
            encoding="utf-8",
        )


# ---------- git worktree ----------
def is_git() -> bool:
    return subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=ROOT,
                          capture_output=True).returncode == 0


def prepare_worktree(tid: str) -> Path:
    wt = WT_ROOT / tid
    if wt.exists():
        return wt
    WT_ROOT.mkdir(parents=True, exist_ok=True)
    branch = f"task/{tid}"
    exists = subprocess.run(["git", "rev-parse", "--verify", branch], cwd=ROOT,
                            capture_output=True).returncode == 0
    cmd = ["git", "worktree", "add", str(wt)] + ([branch] if exists else ["-b", branch])
    with _lock:
        subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
    return wt


# ---------- промпты ----------
def deps_context(task: dict) -> str:
    parts = []
    for d in task.get("deps", []):
        p = HANDOFFS / f"{d}.md"
        if p.exists():
            parts.append(f"### Handoff {d}\n{p.read_text(encoding='utf-8')[:HANDOFF_CHARS]}")
    return "\n\n".join(parts) or "(нет)"


def build_prompt(task: dict, roles: dict, review: bool = False) -> str:
    agents_md = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    role_key = "qa-reviewer" if review else task["role"]
    role_text = strip_frontmatter((ROOT / roles[role_key]["prompt"]).read_text(encoding="utf-8"))
    tid = task["id"]
    head = f"""{agents_md}

---
# Твоя роль: {role_key}
{role_text}

---
# Задача {tid}: {task['title']}
Исполнитель: {task['role']}
Входные данные: {', '.join(task.get('inputs', [])) or '—'}
Критерии приёмки: {task['acceptance']}
"""
    if task.get("review_notes"):
        head += f"\nЗамечания прошлого ревью (исправить):\n{task['review_notes']}\n"
    if review:
        return head + f"""
## Что сделать
Проведи ревью работы по задаче {tid}. Посмотри `git log` и `git diff` текущей ветки
относительно основной, прочитай `orchestrator/handoffs/{tid}.md`.
Запиши отчёт в `orchestrator/handoffs/{tid}.review.md` по шаблону роли qa-reviewer.
Первая строка отчёта строго: `Вердикт: APPROVE` или `Вердикт: CHANGES_REQUESTED` или `Вердикт: BLOCKED`.
Не изменяй другие файлы.
"""
    return head + f"""
## Контекст от зависимостей
{deps_context(task)}

## Что сделать
1. Выполни задачу в зоне файлов своей роли.
2. Проверь результат (сборка/запуск скрипта/линтер — что применимо).
3. Создай `orchestrator/handoffs/{tid}.md` по шаблону из AGENTS.md.
4. Сделай коммит: `git add -A && git commit -m "{task['role']}({tid}): <кратко>"`.
Работай автономно; если упёрся в неопределённость — зафиксируй её в разделе «Открытые вопросы» handoff.
"""


# ---------- запуск движка ----------
def run_engine(engine: str, prompt: str, cwd: Path, logfile: Path, engines: dict, dry: bool) -> int:
    spec = engines["engines"][engine]
    cmd = [c.replace("{prompt}", prompt) for c in spec["cmd"]]
    shown = " ".join(c if c != prompt else "<prompt>" for c in cmd)
    if dry:
        log(f"DRY  [{engine}] cwd={cwd} :: {shown}")
        return 0
    if shutil.which(cmd[0]) is None:
        log(f"ERR  движок '{engine}' не найден в PATH ({cmd[0]})")
        return 127
    log(f"RUN  [{engine}] {shown}")
    logfile.parent.mkdir(parents=True, exist_ok=True)
    with open(logfile, "w", encoding="utf-8") as lf:
        try:
            r = subprocess.run(cmd, cwd=cwd, stdout=lf, stderr=subprocess.STDOUT,
                               timeout=spec.get("timeout_min", 45) * 60)
            return r.returncode
        except subprocess.TimeoutExpired:
            lf.write("\n[orchestrator] TIMEOUT\n")
            return 124


def sync_back(wt: Path, names: list[str]) -> None:
    """Копирует handoff-файлы из worktree в основной репозиторий (доска живёт в основном)."""
    if wt == ROOT:
        return
    HANDOFFS.mkdir(parents=True, exist_ok=True)
    for n in names:
        src = wt / "orchestrator" / "handoffs" / n
        if src.exists():
            shutil.copy2(src, HANDOFFS / n)


def do_review(board, task, roles, engines, wt: Path, dry: bool) -> None:
    tid = task["id"]
    reviewer = roles[task["role"]]["reviewer"]
    if reviewer == "none":
        set_status(board, task, "gate" if task.get("gate", "none") != "none" else "done")
        return
    rc = run_engine(reviewer, build_prompt(task, roles, review=True), wt,
                    LOGS / f"{tid}.review.log", engines, dry)
    sync_back(wt, [f"{tid}.review.md"])
    if dry:
        return
    rfile = HANDOFFS / f"{tid}.review.md"
    verdict = "BLOCKED"
    if rc == 0 and rfile.exists():
        m = re.search(r"Вердикт:\s*(APPROVE|CHANGES_REQUESTED|BLOCKED)", rfile.read_text(encoding="utf-8"))
        verdict = m.group(1) if m else "BLOCKED"
    log(f"REV  {tid} [{reviewer}] → {verdict}")
    if verdict == "APPROVE":
        nxt = "gate" if task.get("gate", "none") != "none" else "done"
        set_status(board, task, nxt, reviewed_by=reviewer)
    elif verdict == "CHANGES_REQUESTED" and task.get("attempts", 0) < MAX_ATTEMPTS:
        notes = rfile.read_text(encoding="utf-8")[:4000]
        set_status(board, task, "todo", review_notes=notes)
    else:
        set_status(board, task, "blocked", reviewed_by=reviewer)


def execute(task_id: str, args, roles, engines) -> None:
    board = load_yaml(TASKS_FILE)
    task = find(board, task_id)
    tid, role = task["id"], task["role"]
    engine = roles[role]["engine"]
    wt = ROOT if (args.no_worktree or not is_git() or args.dry_run) else prepare_worktree(tid)
    if not args.dry_run:
        set_status(board, task, "running", engine=engine, attempts=task.get("attempts", 0) + 1)
    rc = run_engine(engine, build_prompt(task, roles), wt, LOGS / f"{tid}.log", engines, args.dry_run)
    sync_back(wt, [f"{tid}.md"])
    if args.dry_run:
        if not args.no_review:
            do_review(board, task, roles, engines, wt, True)
        return
    board = load_yaml(TASKS_FILE)
    task = find(board, tid)
    if rc != 0 or not (HANDOFFS / f"{tid}.md").exists():
        log(f"FAIL {tid}: rc={rc}, handoff={'есть' if (HANDOFFS / f'{tid}.md').exists() else 'нет'} "
            f"— см. {LOGS / (tid + '.log')}")
        set_status(board, task, "blocked", last_rc=rc)
        return
    set_status(board, task, "review")
    if not args.no_review:
        do_review(board, task, roles, engines, wt, False)


# ---------- CLI ----------
def cmd_status(_args) -> None:
    board = load_yaml(TASKS_FILE)
    roles = load_yaml(ROLES_FILE)["roles"]
    print(f"Спринт: {board.get('sprint', '—')}\n")
    print(f"{'ID':7} {'STATUS':8} {'ROLE':20} {'ENG':7} {'GATE':6} TITLE")
    ready = {t['id'] for t in ready_tasks(board)}
    for t in board["tasks"]:
        mark = "*" if t["id"] in ready else " "
        print(f"{t['id']:7} {t['status']:8} {t['role']:20} {roles[t['role']]['engine']:7} "
              f"{t.get('gate', 'none'):6}{mark}{t['title']}")
    print("\n* — готова к запуску (зависимости выполнены)")


def cmd_run(args) -> None:
    roles = load_yaml(ROLES_FILE)["roles"]
    engines = load_yaml(ENGINES_FILE)
    board = load_yaml(TASKS_FILE)
    ids = [args.task] if args.task else [t["id"] for t in ready_tasks(board)][: args.max]
    if not ids:
        log("Нет готовых задач. Проверьте gate-задачи: `status`, затем `approve <ID>`.")
        return
    log(f"Запуск: {', '.join(ids)} (parallel={args.parallel})")
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as ex:
        list(ex.map(lambda i: execute(i, args, roles, engines), ids))
    board = load_yaml(TASKS_FILE)
    gates = [t["id"] for t in board["tasks"] if t["status"] == "gate"]
    if gates:
        log(f"Ждут вашего решения (gate): {', '.join(gates)} → `approve <ID>` / `reject <ID>`")


def cmd_review(args) -> None:
    roles = load_yaml(ROLES_FILE)["roles"]
    engines = load_yaml(ENGINES_FILE)
    board = load_yaml(TASKS_FILE)
    task = find(board, args.id)
    wt = WT_ROOT / args.id
    do_review(board, task, roles, engines, wt if wt.exists() else ROOT, False)


def cmd_approve(args) -> None:
    board = load_yaml(TASKS_FILE)
    task = find(board, args.id)
    set_status(board, task, "done", approved_by="human")
    if args.merge and is_git():
        r = subprocess.run(["git", "merge", "--no-ff", "-m", f"merge task/{args.id}", f"task/{args.id}"],
                           cwd=ROOT, capture_output=True, text=True)
        log(f"OK   {args.id} утверждена и слита" if r.returncode == 0
            else f"WARN {args.id}: конфликт слияния, разрешите вручную\n{r.stdout}{r.stderr}")
    else:
        log(f"OK   {args.id} утверждена. Слияние: git merge --no-ff task/{args.id}")


def cmd_reject(args) -> None:
    board = load_yaml(TASKS_FILE)
    task = find(board, args.id)
    set_status(board, task, "todo", review_notes=f"Решение человека: {args.note or 'доработать'}")


def cmd_set(args) -> None:
    board = load_yaml(TASKS_FILE)
    set_status(board, find(board, args.id), args.status)


def cmd_prompt(args) -> None:
    roles = load_yaml(ROLES_FILE)["roles"]
    board = load_yaml(TASKS_FILE)
    print(build_prompt(find(board, args.id), roles, review=args.review))


def main() -> None:
    p = argparse.ArgumentParser(description="Оркестратор агентов Rakis")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    r = sub.add_parser("run")
    r.add_argument("--max", type=int, default=1)
    r.add_argument("--task")
    r.add_argument("--parallel", type=int, default=1)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--no-worktree", action="store_true")
    r.add_argument("--no-review", action="store_true")
    r.set_defaults(fn=cmd_run)
    rv = sub.add_parser("review")
    rv.add_argument("id")
    rv.set_defaults(fn=cmd_review)
    ap = sub.add_parser("approve")
    ap.add_argument("id")
    ap.add_argument("--merge", action="store_true", help="сразу слить ветку task/<ID> в текущую")
    ap.set_defaults(fn=cmd_approve)
    rj = sub.add_parser("reject")
    rj.add_argument("id")
    rj.add_argument("--note")
    rj.set_defaults(fn=cmd_reject)
    st = sub.add_parser("set")
    st.add_argument("id")
    st.add_argument("status", choices=sorted(STATUSES))
    st.set_defaults(fn=cmd_set)
    pr = sub.add_parser("prompt")
    pr.add_argument("id")
    pr.add_argument("--review", action="store_true")
    pr.set_defaults(fn=cmd_prompt)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
