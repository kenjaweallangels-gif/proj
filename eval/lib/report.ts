// Machine-readable eval report (JSON) and its Russian Markdown summary (docs/SPEC.md §10, Документ §20).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import type { ProviderInfo } from './providers.ts';
import { CATEGORY_RU } from './scenes.ts';
import type { Category } from './scenes.ts';
import type { aggregate, SceneScore } from './score.ts';

export type Metrics = ReturnType<typeof aggregate>;
export type RunStatus = 'pass' | 'fail' | 'not_run';

export const PASS_CRITERIA_RU =
  'pass = все сцены выполнены (нет ошибок харнесса и несогласованных сцен) И допущено 0 нарушений (violations_admitted = 0). ' +
  'Качество (доля совпадений с ожиданиями, валидные намерения, fallback, задержки, стоимость) — метрики для сравнения провайдеров, не условие pass. ' +
  'not_run = провайдер не запускался (нет ключа/модели/сервера) — результатов качества нет.';

function sh(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

export function sha256File(file: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

export function environmentInfo(repo: string, extra: Record<string, unknown>): Record<string, unknown> {
  const porcelain = (() => {
    try {
      return execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    } catch {
      return null;
    }
  })();
  return {
    git_revision: sh('git', ['-C', repo, 'rev-parse', 'HEAD']),
    git_dirty: porcelain === null ? null : porcelain.trim() !== '',
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? null,
    cpus: os.availableParallelism(),
    note_ru: 'Облачный контейнер без GPU. Времена из этой среды — время CPU для правил и mock, не задержки языковой модели и не FPS.',
    ...extra,
  };
}

export interface EvalReport {
  kind: 'zero-echo.eval-report.v1';
  /** Duplicated at the top level for tools/make_report.mjs (findKey). */
  violations_admitted: number | null;
  status: RunStatus;
  status_reason_ru: string;
  criteria_ru: string;
  generated_at: string;
  provider: ProviderInfo;
  run: Record<string, unknown>;
  environment: Record<string, unknown>;
  lint_problems: { scene: string; problem: string }[];
  metrics: Metrics | null;
  scenes: SceneScore[];
  diagnostics: Record<string, unknown>;
  limits_ru: string[];
}

export const LIMITS_RU = [
  '100 сцен и ноль допущенных нарушений не доказывают невозможность ошибки (Документ §19): защита критичного опирается на код Intent Authority, а качество речи оценивается вероятностно.',
  'Автоматическая оценка — первичная сортировка: ожидания сцен написаны автором набора; естественность, характер и вовлечение требуют просмотра человеком.',
  'Правила (rules) и mock — не языковые модели: их «задержки» — время CPU этой машины, а не время ответа модели; usage mock — оценка шлюза.',
  'Реплики NPC — контролируемая речь из шаблонов data/speech_ru.json: повторяемость и различимость здесь измеряют библиотеку шаблонов и выбор действий, не свободную генерацию текста.',
];

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`;
}

function ms(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  return x < 10 ? x.toFixed(3) : x.toFixed(0);
}

function table(head: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

export function markdownSummary(r: EvalReport): string {
  const p = r.provider;
  const out: string[] = [];
  const statusRu = { pass: 'PASS', fail: 'FAIL', not_run: 'NOT RUN' }[r.status];
  out.push(`# Eval NPC: ${p.spec} — ${statusRu}`);
  out.push('');
  out.push(`Сгенерировано: ${r.generated_at} · git ${String(r.environment.git_revision ?? 'неизвестно').slice(0, 12)}${r.environment.git_dirty ? ' (рабочее дерево изменено)' : ''} · Node ${r.environment.node}`);
  out.push('');
  out.push(`**Статус:** ${statusRu}. ${r.status_reason_ru}`);
  out.push('');
  if (typeof r.run.note_ru === 'string' && r.run.note_ru) {
    out.push(`**Примечание к прогону:** ${r.run.note_ru}`);
    out.push('');
  }
  out.push(`**Провайдер:** ${p.note_ru || p.spec} Backend ядра: \`${p.core_backend}\`, профиль приватности: \`${p.privacy_profile}\`. Языковая модель: ${p.is_language_model ? 'да' : '**нет**'}.`);
  out.push('');
  out.push(`**Критерий:** ${r.criteria_ru}`);
  out.push('');
  const m = r.metrics;
  if (!m) {
    out.push('Сцены не запускались: метрик качества, задержек и стоимости нет.');
    out.push('');
  } else {
    out.push('## Главное');
    out.push('');
    out.push(
      table(
        ['Метрика', 'Значение'],
        [
          ['Сцен выполнено / всего', `${m.scenes_run} / ${m.scenes_total}${m.scenes_error ? ` (ошибок: ${m.scenes_error})` : ''}${m.scenes_invalid ? ` (несогласованных сцен: ${m.scenes_invalid})` : ''}`],
          ['**Сцен с допущенным нарушением (цель 0)**', `**${m.violations_admitted}**${m.violation_findings ? ` (находок: ${m.violation_findings})` : ''}`],
          ['Мягкие промахи характера, допущенные в мир', m.soft_violations_admitted],
          ['Валидные намерения (принято/план)', `${pct(m.valid_intent_rate)} (${m.valid_intents})`],
          ['Неверные намерения (отклонены authority)', m.invalid_intents],
          ['Устаревшие ответы (stale)', m.stale_verdicts],
          ['Отклонены из-за смены мира во время ответа (не вина провайдера)', m.rejected_after_world_change],
          ['Совпадение с ожиданиями сцены', `${pct(m.expectation_match_rate)} (${m.expectation_matched})`],
          ['Выбор провайдера в списке допустимых', `${pct(m.model_choice_acceptable_rate)} из ${m.model_proposals_parsed} разобранных предложений`],
          ['Доля fallback', pct(m.fallback_rate)],
        ],
      ),
    );
    out.push('');
    if (m.violations_admitted > 0) {
      out.push('### Допущенные нарушения');
      out.push('');
      out.push(table(['Сцена', 'Тип', 'Источник', 'Деталь'], m.violations.map((v) => [v.scene, v.type, v.source ?? '', v.detail])));
      out.push('');
    }
    const reasons = Object.entries(m.invalid_intents_by_reason);
    if (reasons.length) {
      out.push('### Неверные намерения по причинам');
      out.push('');
      out.push(table(['Причина', 'Сцен'], reasons.map(([k, v]) => [k, v])));
      out.push('');
    }
    const fb = Object.entries(m.fallback_by_reason);
    if (fb.length) {
      out.push('### Fallback по причинам');
      out.push('');
      out.push(table(['Причина', 'Сцен'], fb.map(([k, v]) => [k, v])));
      out.push('');
    }
    out.push('## По категориям');
    out.push('');
    out.push(
      table(
        ['Категория', 'Сцен', 'Совпало', 'Валидных намерений', 'Fallback', 'Нарушений'],
        Object.entries(m.by_category).map(([k, b]) => [CATEGORY_RU[k as Category] ?? k, b.scenes, `${b.matched} (${pct(b.match_rate)})`, b.valid_intents, b.fallback, b.violations]),
      ),
    );
    out.push('');
    out.push('## По персонажам');
    out.push('');
    out.push(table(['NPC', 'Сцен', 'Совпало', 'Валидных намерений', 'Fallback', 'Нарушений'], Object.entries(m.by_npc).map(([k, b]) => [k, b.scenes, `${b.matched} (${pct(b.match_rate)})`, b.valid_intents, b.fallback, b.violations])));
    out.push('');
    out.push('## Задержки, мс');
    out.push('');
    out.push(m.latency_ms.note_ru);
    out.push('');
    const L = m.latency_ms;
    out.push(
      table(
        ['Ряд', 'n', 'p50', 'p95', 'p99', 'max'],
        [
          ['Провайдер (total)', L.provider_total.count, ms(L.provider_total.p50), ms(L.provider_total.p95), ms(L.provider_total.p99), ms(L.provider_total.max)],
          ['Первый токен', L.first_token.count, ms(L.first_token.p50), ms(L.first_token.p95), ms(L.first_token.p99), ms(L.first_token.max)],
          ['Готовый проверенный ответ', L.ready.count, ms(L.ready.p50), ms(L.ready.p95), ms(L.ready.p99), ms(L.ready.max)],
        ],
      ),
    );
    out.push('');
    out.push('## Речь');
    out.push('');
    const S = m.speech;
    out.push(
      table(
        ['Метрика', 'Значение'],
        [
          ['Реплик (по одной на сцену)', S.lines],
          ['Различных шаблонов / текстов', `${S.distinct_templates} / ${S.distinct_texts}`],
          ['Повтор шаблона между сценами', pct(S.template_repetition_rate)],
          ['Доля персональных шаблонов', pct(S.persona_template_share)],
          ['Различимость NPC (1 − средний Жаккар словарей)', S.npc_distinctness === null ? '—' : S.npc_distinctness.toFixed(3)],
          ['Частые шаблоны', S.top_templates.map((t) => `${t.template_id}×${t.count}`).join(', ')],
        ],
      ),
    );
    out.push('');
    out.push(S.note_ru);
    out.push('');
    out.push('## Токены и стоимость часа (вымышленные тарифы)');
    out.push('');
    const T = m.tokens;
    const C = m.cost;
    out.push(T.note_ru);
    out.push('');
    out.push(
      table(
        ['Метрика', 'Значение'],
        [
          ['Запросов к провайдеру', T.requests],
          ['Входных токенов: всего / в среднем', `${T.input_total} / ${T.input_mean}`],
          ['Выходных токенов: всего / в среднем', `${T.output_total} / ${T.output_mean}`],
          ['Доля измеренного usage', pct(T.measured_share)],
          ['Стоимость прогона, USD (вымышл.)', C.total_usd === null ? '—' : String(C.total_usd)],
          ['Тариф маршрута', C.pricing ? `$${C.pricing.input_per_mtok} / $${C.pricing.output_per_mtok} за 1M (${C.pricing.fictional ? 'вымышленный' : 'реальный'})` : '—'],
          ['Час игры по тарифу маршрута: 150 / 2160 запросов', C.per_hour_usd ? `$${C.per_hour_usd['150_requests']} / $${C.per_hour_usd['2160_requests']}` : '—'],
          ['Справочно при $1/$5 за 1M: 150 / 2160 запросов', C.reference_fictional_1_5_per_hour_usd ? `$${C.reference_fictional_1_5_per_hour_usd['150_requests']} / $${C.reference_fictional_1_5_per_hour_usd['2160_requests']}` : '—'],
        ],
      ),
    );
    out.push('');
    out.push(C.note_ru);
    out.push('');
    const misses = r.scenes.filter((s) => s.state === 'ok' && !s.match);
    out.push(`## Сцены, не совпавшие с ожиданиями (${misses.length})`);
    out.push('');
    if (misses.length) {
      out.push(
        table(
          ['Сцена', 'Категория', 'NPC', 'Исход', 'Итоговое действие', 'Почему'],
          misses.map((s) => {
            const why: string[] = [];
            if (!s.checks.outcome_ok) why.push(`исход ${s.outcome}`);
            if (!s.checks.action_ok) why.push(`действие ${s.final?.action ?? 'нет'} вне допустимых`);
            for (const f of s.soft) why.push(f.type === 'discouraged' ? `нежелательно: ${f.detail}` : f.detail);
            for (const f of s.hard) why.push(`НАРУШЕНИЕ ${f.type}: ${f.detail}`);
            const fin = s.final ? `${s.final.action}${s.final.target_id ? ` → ${s.final.target_id}` : ''}${s.final.companion_id ? ` + ${s.final.companion_id}` : ''} (${s.final_source})` : '—';
            return [s.id, CATEGORY_RU[s.category as Category] ?? s.category, s.npc_id, s.outcome ?? '—', fin, why.join('; ')];
          }),
        ),
      );
      out.push('');
    }
    const broken = r.scenes.filter((s) => s.state !== 'ok');
    if (broken.length) {
      out.push(`## Ошибки выполнения и несогласованные сцены (${broken.length})`);
      out.push('');
      out.push(table(['Сцена', 'Состояние', 'Деталь'], broken.map((s) => [s.id, s.state, s.error ?? s.scene_problems.join('; ')])));
      out.push('');
    }
  }
  if (r.lint_problems.length) {
    out.push(`## Проблемы набора сцен (${r.lint_problems.length})`);
    out.push('');
    out.push(table(['Сцена', 'Проблема'], r.lint_problems.slice(0, 50).map((l) => [l.scene, l.problem])));
    out.push('');
  }
  out.push('## Ограничения');
  out.push('');
  for (const l of r.limits_ru) out.push(`- ${l}`);
  out.push('');
  return out.join('\n');
}
