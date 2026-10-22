// Gateway CLI.
//
//   node gateway/src/cli.ts cost --rph 150 --in 1200 --out 180 --pin 1 --pout 5      → 0.315 USD/h
//   node gateway/src/cli.ts cost --rph 2160 --in 1200 --out 180 --route openai [--config ...]
//   node gateway/src/cli.ts probe [--config ...] [--route id] [--deep] [--allow-remote]
//   node gateway/src/cli.ts manifest [--config ...]
//
// `probe` contacts only enabled routes; remote routes are contacted only with --allow-remote (the owner's
// explicit choice), and --deep sends one tiny generation per route (may cost money on paid APIs).

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig } from './config.ts';
import { Gateway } from './gateway.ts';
import { nullSink } from './log.ts';
import { formatUsd, PriceBook, pricePerHour } from './pricing.ts';
import { SecretsError, SecretStore } from './secrets.ts';

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`неожиданный аргумент ${k}`);
    const name = k.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) flags[name] = true;
    else {
      flags[name] = v;
      i++;
    }
  }
  return flags;
}

function numFlag(flags: Flags, name: string, required = true): number | null {
  const v = flags[name];
  if (v === undefined) {
    if (required) throw new Error(`нужен флаг --${name}`);
    return null;
  }
  const n = Number(v);
  if (typeof v !== 'string' || !Number.isFinite(n) || n < 0) throw new Error(`--${name}: ожидается неотрицательное число`);
  return n;
}

const DEFAULT_CONFIG = 'data/providers.example.json';

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}

export function costCommand(flags: Flags): string[] {
  const rph = numFlag(flags, 'rph') as number;
  const inTok = numFlag(flags, 'in') as number;
  const outTok = numFlag(flags, 'out') as number;
  let pIn = numFlag(flags, 'pin', false);
  let pOut = numFlag(flags, 'pout', false);
  let source = 'тарифы из аргументов командной строки';
  let fictional: boolean | null = null;
  if (pIn === null || pOut === null) {
    const route = typeof flags.route === 'string' ? flags.route : null;
    if (!route) throw new Error('укажите --pin и --pout (USD за 1M токенов) или --route <id> для тарифа из файла');
    const config = loadConfig(resolve(typeof flags.config === 'string' ? flags.config : DEFAULT_CONFIG));
    const prices = typeof flags.pricing === 'string' ? PriceBook.load(resolve(flags.pricing)) : config.pricing_file ? PriceBook.load(config.pricing_file) : PriceBook.empty();
    const r = config.routes.find((x) => x.id === route);
    if (!r) throw new Error(`маршрут ${route} не найден`);
    const p = prices.lookup(r.id, r.model);
    if (!p) throw new Error(`для маршрута ${route} нет тарифа в ${prices.source}`);
    pIn = pIn ?? p.input_per_mtok;
    pOut = pOut ?? p.output_per_mtok;
    fictional = p.fictional;
    source = `тариф маршрута ${route} из ${prices.source}`;
  }
  const perHour = pricePerHour({ requestsPerHour: rph, inputTokens: inTok, outputTokens: outTok, pIn, pOut });
  const perRequest = rph > 0 ? perHour / rph : 0;
  const lines = [
    `${formatUsd(perHour)} USD/h`,
    `Цена часа = ${rph} × (${inTok} × ${pIn} + ${outTok} × ${pOut}) / 1 000 000 = ${formatUsd(perHour)} USD/h (≈ ${formatUsd(perRequest)} USD за запрос)`,
    `Источник тарифа: ${source}${fictional === true ? ' — ВЫМЫШЛЕННЫЙ тариф' : fictional === false ? '' : ' (условные значения)'}. Документ §18: пример чувствительности бюджета, не коммерческая оценка; TTS и инфраструктура не включены, тарифицируемые reasoning-токены нужно включать в --out.`,
  ];
  if (flags.json === true) {
    return [JSON.stringify({ usd_per_hour: Number(formatUsd(perHour)), usd_per_request: Number(formatUsd(perRequest)), requests_per_hour: rph, input_tokens: inTok, output_tokens: outTok, p_in_per_mtok: pIn, p_out_per_mtok: pOut, fictional, source })];
  }
  return lines;
}

async function probeCommand(flags: Flags): Promise<void> {
  const config = loadConfig(resolve(typeof flags.config === 'string' ? flags.config : DEFAULT_CONFIG));
  const only = typeof flags.route === 'string' ? flags.route : null;
  const allowRemote = flags['allow-remote'] === true;
  if (only) for (const r of config.routes) if (r.id !== only) r.enabled = false;
  const gateway = new Gateway(config, { logSink: nullSink });
  try {
    // Session in the strictest profile that still reaches the requested routes.
    const created = await gateway.createSession({ privacy_profile: allowRemote ? 'online' : 'offline', client: 'native' });
    const token = (created.body as { session_token: string }).session_token;
    const session = gateway.sessions.authenticate(`Bearer ${token}`);
    const report = await gateway.providers(session, { refresh: true, deep: flags.deep === true, allowRemoteDeep: allowRemote && flags.deep === true });
    out(JSON.stringify({ ...report, remote_contacted: allowRemote, note_cli_ru: allowRemote ? 'удалённые маршруты опрошены по явному --allow-remote' : 'удалённые маршруты не опрашивались (нужен --allow-remote); статус not_configured/disabled — это not_run, а не отказ провайдера' }, null, 2));
  } finally {
    gateway.close();
  }
}

function manifestCommand(flags: Flags): void {
  const config = loadConfig(resolve(typeof flags.config === 'string' ? flags.config : DEFAULT_CONFIG));
  // The manifest needs no keys: an empty secret store keeps secrets out of this process entirely.
  const gateway = new Gateway(config, { logSink: nullSink, secrets: new SecretStore() });
  out(JSON.stringify(gateway.manifest(), null, 2));
  gateway.close();
}

const USAGE = `Использование:
  node gateway/src/cli.ts cost --rph <запросов/ч> --in <вх. токенов> --out <вых. токенов> (--pin <USD/1M> --pout <USD/1M> | --route <id> [--config файл]) [--json]
  node gateway/src/cli.ts probe [--config файл] [--route id] [--deep] [--allow-remote]
  node gateway/src/cli.ts manifest [--config файл]`;

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const flags = parseFlags(rest);
    switch (command) {
      case 'cost':
        for (const line of costCommand(flags)) out(line);
        return 0;
      case 'probe':
        await probeCommand(flags);
        return 0;
      case 'manifest':
        manifestCommand(flags);
        return 0;
      default:
        process.stderr.write(`${USAGE}\n`);
        return 2;
    }
  } catch (e) {
    const msg = e instanceof ConfigError || e instanceof SecretsError ? e.message : `ошибка: ${(e as Error).message}`;
    process.stderr.write(`${msg}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
