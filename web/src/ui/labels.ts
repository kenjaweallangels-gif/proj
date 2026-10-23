// Russian labels for protocol enums shown in the UI.
export const ACTIVITY_RU: Record<string, string> = {
  idle: 'ожидает', walking: 'идёт', working: 'работает', resting: 'отдыхает', talking: 'говорит',
};

export const SPEECH_KIND_RU: Record<string, string> = {
  immediate: 'мгновенная реакция', line: 'проверенная реплика', fallback: 'fallback-реплика', evidence: 'доказательства',
  order: 'поручение', decision: 'решение',
};

export const GESTURE_RU: Record<string, string> = {
  none: 'без жеста', nod: 'кивок', point_at_target: 'указывает на цель', look_at_player: 'смотрит на Алекса', pause: 'пауза',
  wary: 'насторожен', shrug: 'пожимает плечами', check_device: 'сверяется с прибором',
};

export const STYLE_RU: Record<string, string> = {
  neutral: 'нейтрально', concerned: 'с тревогой', firm: 'твёрдо', warm: 'тепло', tense: 'напряжённо', dry: 'сухо',
  apologetic: 'извиняясь', curious: 'с интересом',
};

export const KIND_RU: Record<string, string> = {
  direct_reply: 'ответ игроку', order_response: 'ответ на поручение', initiative: 'инициатива NPC', ambient: 'фоновая реплика',
  emergency: 'авария',
};

export const STATUS_RU: Record<string, string> = {
  ok: 'ok', timeout: 'таймаут', refused: 'отказ модели', invalid_output: 'неверный вывод', unavailable: 'недоступен',
  rate_limited: 'лимит запросов', budget_exceeded: 'бюджет исчерпан', cancelled: 'отменён',
};

export const REASON_RU: Record<string, string> = {
  timeout: 'истёк срок ответа',
  deadline_in_queue: 'срок истёк в очереди',
  invalid_output: 'неверный формат ответа',
  authority_rejected: 'Intent Authority отклонил',
  stale: 'мир изменился (устаревшая ревизия)',
  plan_expired: 'план истёк без решения',
  plan_rejected: 'план отклонён игроком',
  cancelled: 'запрос отменён',
  queue_overflow: 'очередь переполнена',
  emergency_rules: 'авария: сразу обычный ИИ',
  provider_unavailable: 'исполнитель недоступен',
  refused: 'модель отказалась',
  rate_limited: 'лимит запросов',
  unavailable: 'исполнитель недоступен',
};

export function reasonRu(r: string | null | undefined): string {
  if (!r) return '—';
  return REASON_RU[r] ?? r;
}

export const DOOR_STATE_RU: Record<string, string> = { open: 'открыта', closed: 'закрыта', sealed: 'загерметизирована' };

export const TASK_STATE_RU: Record<string, string> = { active: 'идёт', done: 'выполнена', cancelled: 'отменена', failed: 'сорвалась' };

export const PHASE_RU: Record<string, string> = { travel: 'в пути', work: 'работа', done: 'готово' };

export const PROVIDER_STATE_RU: Record<string, string> = {
  ready: 'готов', checking: 'проверка', unavailable: 'недоступен', off: 'выключен', loading: 'загрузка', backoff: 'пауза',
};

export const LAYER_RU: Record<string, string> = {
  instrument: 'показания приборов', physical: 'физическая проверка', history: 'история', interpretation: 'интерпретация',
  canon: 'канон (защищён)',
};

export const PROVIDER_RU: Record<string, string> = {
  rules: 'правила', 'claude-artifact': 'Claude', mock: 'mock (сценарий)', webllm: 'WebLLM', gateway: 'шлюз',
};

export function providerRu(id: string | undefined): string {
  if (!id) return '—';
  return PROVIDER_RU[id] ?? id;
}
