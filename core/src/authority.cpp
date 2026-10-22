#include "echo/authority.hpp"

#include <algorithm>
#include <cmath>

#include "echo/policy.hpp"
#include "echo/rules.hpp"
#include "echo/tasks.hpp"
#include "echo/world.hpp"

namespace echo {
namespace {

const std::vector<std::string> kIntentFields = {"action", "target_id", "companion_id", "fact_ids", "style", "gesture"};
const char* const kStepNames[] = {"", "format", "pending", "revision", "validity", "reserve", "execute", "record"};

bool id_pattern(const std::string& s, bool allow_digits, std::size_t max_len) {
  if (s.empty() || s.size() > max_len) return false;
  for (const char ch : s) {
    const bool ok = (ch >= 'a' && ch <= 'z') || ch == '_' || (allow_digits && ch >= '0' && ch <= '9');
    if (!ok) return false;
  }
  return true;
}

void add_step(Evaluation& ev, int n, bool ok, std::string detail) {
  StepTrace s;
  s.step = n;
  s.name = kStepNames[n];
  s.ok = ok;
  s.detail = std::move(detail);
  ev.steps.push_back(std::move(s));
}

void skip_from(Evaluation& ev, int from, const std::string& why) {
  for (int n = from; n <= 7; ++n) {
    StepTrace s;
    s.step = n;
    s.name = kStepNames[n];
    s.ok = false;
    s.skipped = true;
    s.detail = why;
    ev.steps.push_back(std::move(s));
  }
}

std::string reasons_ru(const Core& c, const std::vector<std::string>& reasons) {
  std::vector<std::string> out;
  for (const auto& r : reasons) out.push_back(reason_ru(c, r));
  return join(out, "; ");
}

std::string list_reservation(const Core& c, const ActionDef& a, const std::string& executor, const std::string& companion) {
  std::vector<std::string> parts;
  for (const auto& [res, amount] : a.consumes) {
    parts.push_back(c.data.label(res) + " ×" + format_number_ru(amount));
  }
  for (const auto& tool : a.tools) parts.push_back("инструмент " + c.data.label(tool));
  parts.push_back("исполнитель " + name_of(c, executor));
  if (!companion.empty()) parts.push_back("напарник " + name_of(c, companion));
  return join(parts, ", ");
}

std::string proposal_summary_ru(const Core& c, const Proposal& p) {
  const ActionDef* a = c.data.action(p.action);
  std::string s = a != nullptr ? a->label_ru : p.action;
  if (!p.target.empty()) s += " — " + c.data.label(p.target);
  if (!p.companion.empty()) s += " (напарник: " + c.data.label(p.companion) + ")";
  return s;
}

// Speech that accompanies an accepted proposal or a fallback.
Speech speak_for(Core& c, const std::string& actor_id, const Proposal& p, const std::string& kind,
                 const std::string& stage, const std::vector<std::string>* allowed, const Situation& sit,
                 const std::string& reason) {
  SpeechRequest req;
  req.actor = actor_id;
  req.kind = kind;
  req.stage = stage;
  req.action = p.action;
  req.style = p.style;
  req.gesture = p.gesture;
  req.target = p.target;
  req.companion = p.companion;
  req.fact_ids = p.fact_ids;
  req.allowed_facts = allowed;
  req.situation = speech_situation(c, sit);
  req.reason = reason;
  req.say_intent = sit.say_intent;
  return render_speech(c, req);
}

std::string stage_for(const ActionDef& a, const std::string& status, const Situation& sit) {
  if (status == "awaiting_player") return "propose";
  if (a.id == "acknowledge" && sit.origin == "ambient") return "ambient";
  return a.instant() ? "say" : "start";
}

// The companion confirms out loud when a task with a helper starts.
void companion_joins(Core& c, const Proposal& p, const Situation& sit) {
  if (p.companion.empty()) return;
  Proposal join = p;
  join.gesture = "nod";
  join.style = "neutral";
  Speech s = speak_for(c, p.companion, join, "line", "join", nullptr, sit, "");
  if (s.template_id != "core.minimal") say(c, s, kSrcSim);
}

// Facts spoken aloud to the player become the player's knowledge (source: reported_by:<npc>).
void share_spoken_facts(Core& c, const Speech& s) {
  std::vector<std::string> learned;
  for (const auto& f : s.fact_ids) {
    if (learn(c, c.data.player_id, f, "reported_by:" + s.actor)) learned.push_back(f);
  }
  if (!learned.empty()) {
    json::Value p = json::Value::object();
    p.set("to", c.data.player_id);
    p.set("facts", json::Value::string_array(learned));
    p.set("source", "reported_by:" + s.actor);
    emit(c, "facts_revealed", s.actor, std::move(p), kSrcSim);
  }
}

void record_memory(Core& c, const std::string& actor_id, const Proposal& p, const std::string& status,
                   const Situation& sit, std::int64_t event_seq) {
  const ActionDef* a = c.data.action(p.action);
  if (a == nullptr) return;
  const std::string src = "event:" + std::to_string(event_seq);
  std::vector<std::string> tags;
  if (!p.target.empty()) tags.push_back(p.target);
  if (!p.companion.empty()) tags.push_back(p.companion);
  if (status == "awaiting_player") {
    remember(c, actor_id, "episode", "Моё предложение Алексу: " + proposal_summary_ru(c, p) + ".", src, 0.45, tags);
  } else if (!a->instant()) {
    remember(c, actor_id, "episode", "Начато дело: " + proposal_summary_ru(c, p) + ".", src, 0.4, tags);
  } else if (p.action == "report_observation") {
    std::vector<std::string> texts;
    for (const auto& f : p.fact_ids) texts.push_back(c.data.fact(f)->text_ru);
    remember(c, actor_id, "episode", "Доложено Алексу: " + join(texts, " "), src, 0.35, p.fact_ids);
  } else if (p.action == "refuse" && sit.has_order) {
    remember(c, actor_id, "episode", "Отказ от приказа Алекса: " + proposal_summary_ru(c, sit.order) + ".",
             src, 0.55, {c.data.player_id});
  }
}

void count_verdict(Core& c, const std::string& status) { c.rt.ai.verdicts[status]++; }

json::Value plan_payload(const Plan& plan) {
  json::Value p = json::Value::object();
  p.set("plan_id", plan.id);
  p.set("task_id", plan.request_id);
  p.set("action", plan.proposal.action);
  p.set("target", plan.proposal.target);
  p.set("companion", plan.proposal.companion);
  p.set("fact_ids", json::Value::string_array(plan.proposal.fact_ids));
  p.set("expires_s", static_cast<double>(plan.expires_ms) / 1000.0);
  return p;
}

// Steps 5–7 for a proposal that passed validation.
void commit(Core& c, const EvalInput& in, Evaluation& ev) {
  const Proposal& p = ev.proposal;
  const ActionDef& a = *c.data.action(p.action);
  const std::string& actor_id = in.actor;
  const bool order_consent = in.situation.has_order && p.action == in.situation.order.action &&
                             p.target == in.situation.order.target && p.companion == in.situation.order.companion;
  const bool approval = needs_approval(a, actor_id, p.target, p.companion) && !order_consent;
  std::int64_t seq = 0;
  if (approval) {
    Plan plan;
    plan.id = format_id("plan-", c.st.next_plan++, 4);
    plan.actor = actor_id;
    plan.request_id = in.task_id;
    plan.source = in.source;
    plan.proposal = p;
    plan.situation = in.situation;
    plan.from_order = in.situation.has_order;
    plan.created_ms = c.st.sim_ms;
    plan.expires_ms = c.st.sim_ms + kPlanTtlMs;
    std::vector<std::string> touched{actor_id, p.companion};
    for (const auto& [res, amount] : a.consumes) {
      c.st.resources[res].reserved += amount;
      plan.reserved.emplace_back(res, amount);
      touched.push_back(res);
    }
    for (const auto& tool : a.tools) {
      c.st.items[tool].lock = plan.id;
      plan.tools.push_back(tool);
      touched.push_back(tool);
    }
    c.st.actors[actor_id].plan_id = plan.id;
    if (!p.companion.empty()) c.st.actors[p.companion].soft_plan = plan.id;
    bump_revision(c, touched);
    const std::string plan_id = plan.id;
    const std::int64_t expires = plan.expires_ms;
    c.st.plans[plan_id] = plan;
    seq = emit(c, "plan_created", actor_id, plan_payload(c.st.plans[plan_id]), in.source).seq;
    ev.status = "awaiting_player";
    ev.plan_id = plan_id;
    add_step(ev, 5, true,
             "мягкий резерв плана " + plan_id + " до t=" + format_number_ru(static_cast<double>(expires) / 1000.0) +
                 " с: " + list_reservation(c, a, executor_of(a, actor_id, p.target), p.companion) +
                 (p.companion.empty() ? "" : " (напарник — рекомендательно, перепроверка при принятии)"));
    add_step(ev, 6, true, "нужно решение Алекса (approval=" + a.approval + "): задача будет создана после принятия");
  } else {
    TaskSpec spec;
    spec.action = p.action;
    spec.executor = executor_of(a, actor_id, p.target);
    spec.companion = p.companion;
    spec.target = p.target;
    spec.proposer = actor_id;
    spec.origin = in.task_id;
    spec.source = in.source;
    spec.style = p.style;
    spec.gesture = p.gesture;
    spec.fact_ids = p.fact_ids;
    const std::string reservation = list_reservation(c, a, spec.executor, p.companion);
    const std::string task_id = start_task(c, spec, in.now_ms);
    const Task& task = c.st.tasks.at(task_id);
    ev.status = "accepted";
    ev.world_task_id = task_id;
    seq = static_cast<std::int64_t>(c.st.next_seq) - 1;
    add_step(ev, 5, true, (a.consumes.empty() && a.tools.empty() && a.instant() ? std::string("резерв не нужен; ")
                                                                                 : std::string("резерв: ")) +
                              reservation + (order_consent ? " (приказ Алекса = согласие)" : ""));
    if (a.instant()) {
      add_step(ev, 6, true, "мгновенное действие " + task_id + " выполнено");
    } else {
      add_step(ev, 6, true,
               "задача " + task_id + " создана: путь " + join(task.travel.path, " → ") + ", работа " +
                   format_number_ru(static_cast<double>(task.work_total_ms) / 1000.0) +
                   " с; эффекты и расход — только по завершении");
    }
  }
  record_memory(c, actor_id, p, ev.status, in.situation, seq);
  AcceptedIntent ai;
  ai.task_id = in.task_id;
  ai.actor = actor_id;
  ai.source = in.source;
  ai.provider = in.provider;
  ai.model = in.model;
  ai.proposal_text = proposal_text(p);
  ai.status = ev.status;
  ai.t_ms = c.st.sim_ms;
  c.st.accepted.push_back(ai);
  add_step(ev, 7, true, "событие #" + std::to_string(seq) + " в журнале; память обновлена только по принятому");
  audit_invariants(c, "commit " + in.task_id);
}

json::Value plan_decided_payload(const Plan& plan, const std::string& decision, const std::string& result) {
  json::Value p = plan_payload(plan);
  p.set("decision", decision);
  p.set("result", result);
  return p;
}

}  // namespace

std::string proposal_text(const Proposal& p) { return json::dump(proposal_json(p)); }

json::Value proposal_json(const Proposal& p) {
  json::Value v = json::Value::object();
  v.set("action", p.action);
  v.set("target_id", p.target.empty() ? json::Value() : json::Value(p.target));
  v.set("companion_id", p.companion.empty() ? json::Value() : json::Value(p.companion));
  v.set("fact_ids", json::Value::string_array(p.fact_ids));
  v.set("style", p.style);
  v.set("gesture", p.gesture);
  return v;
}

bool parse_intent(const Core& c, std::string_view text, const Offer& offer, Proposal& out,
                  std::vector<std::string>& reasons) {
  if (text.size() > kIntentMaxBytes) {
    reasons.push_back("too_large");
    return false;
  }
  json::ParseLimits limits;
  limits.max_bytes = kIntentMaxBytes;
  limits.max_depth = kIntentMaxDepth;
  json::Value v;
  json::ParseError err;
  if (!json::parse(text, v, &err, limits)) {
    if (err.code == "duplicate_key") {
      const std::size_t a = err.message.find('"');
      const std::size_t b = err.message.rfind('"');
      reasons.push_back("duplicate_key:" + (a != std::string::npos && b > a ? err.message.substr(a + 1, b - a - 1) : ""));
    } else if (err.code == "depth_exceeded" || err.code == "too_large") {
      reasons.push_back(err.code);
    } else {
      reasons.push_back("bad_json:" + err.code);
    }
    return false;
  }
  if (!v.is_object()) {
    reasons.push_back("not_object");
    return false;
  }
  for (const auto& m : v.members()) {
    if (!contains(kIntentFields, m.key)) reasons.push_back("unknown_field:" + m.key);
  }
  if (!reasons.empty()) return false;

  Proposal p;
  const json::Value* action = v.find("action");
  if (action == nullptr) reasons.push_back("missing_field:action");
  else if (!action->is_string()) reasons.push_back("wrong_type:action");
  else if (!id_pattern(action->as_string(), false, 32)) reasons.push_back("bad_pattern:action");
  else p.action = action->as_string();

  const json::Value* style = v.find("style");
  if (style == nullptr) reasons.push_back("missing_field:style");
  else if (!style->is_string()) reasons.push_back("wrong_type:style");
  else if (!contains(c.data.styles, style->as_string())) reasons.push_back("bad_style:" + utf8_truncate(style->as_string(), 32, ""));
  else p.style = style->as_string();

  if (const json::Value* g = v.find("gesture"); g != nullptr) {
    if (!g->is_string()) reasons.push_back("wrong_type:gesture");
    else if (!contains(c.data.gestures, g->as_string())) reasons.push_back("bad_gesture:" + utf8_truncate(g->as_string(), 32, ""));
    else p.gesture = g->as_string();
  }
  auto optional_id = [&](const char* key, std::size_t max_len, std::string& dst) {
    const json::Value* f = v.find(key);
    if (f == nullptr || f->is_null()) return;
    if (!f->is_string()) reasons.push_back(std::string("wrong_type:") + key);
    else if (!id_pattern(f->as_string(), true, max_len)) reasons.push_back(std::string("bad_pattern:") + key);
    else dst = f->as_string();
  };
  optional_id("target_id", 48, p.target);
  optional_id("companion_id", 32, p.companion);
  if (const json::Value* f = v.find("fact_ids"); f != nullptr) {
    if (!f->is_array()) {
      reasons.push_back("wrong_type:fact_ids");
    } else if (f->size() > 4) {
      reasons.push_back("fact_ids_too_many");
    } else {
      for (const auto& item : f->items()) {
        if (!item.is_string()) {
          reasons.push_back("wrong_type:fact_ids");
          break;
        }
        if (!id_pattern(item.as_string(), true, 48)) {
          reasons.push_back("bad_pattern:fact_ids");
          break;
        }
        if (contains(p.fact_ids, item.as_string())) {
          reasons.push_back("fact_ids_not_unique");
          break;
        }
        p.fact_ids.push_back(item.as_string());
      }
    }
  }
  if (!reasons.empty()) return false;
  const OfferedAction* oa = offer.find(p.action);
  if (oa == nullptr) {
    reasons.push_back("action_not_offered:" + p.action);
    return false;
  }
  if (static_cast<int>(p.fact_ids.size()) > oa->fact_max) reasons.push_back("fact_ids_too_many");
  if (static_cast<int>(p.fact_ids.size()) < oa->fact_min) reasons.push_back("fact_ids_too_few");
  if (!reasons.empty()) return false;
  if (p.gesture.empty()) p.gesture = c.data.action(p.action)->gesture_default;
  out = p;
  return true;
}

std::vector<std::string> stale_dependencies(const Core& c, const std::string& actor_id, const Proposal& p,
                                            std::int64_t world_revision) {
  std::vector<std::string> deps{actor_id};
  const ActionDef* a = c.data.action(p.action);
  if (a != nullptr) {
    const std::string executor = executor_of(*a, actor_id, p.target);
    append_unique(deps, executor);
    if (!p.target.empty()) append_unique(deps, p.target);
    if (!p.companion.empty()) append_unique(deps, p.companion);
    for (const auto& [res, amount] : a->consumes) append_unique(deps, res);
    for (const auto& tool : a->tools) append_unique(deps, tool);
    const ActorState* ex = actor(c, executor);
    if (ex != nullptr && (!p.target.empty() || contains(a->effects, "rest"))) {
      const std::string zone = work_zone_for(c, *a, executor, p.target);
      append_unique(deps, zone);
      const Route r = find_route(c, ex->zone, zone);
      for (const auto& d : r.doors) append_unique(deps, d);
    }
  }
  std::vector<std::string> stale;
  for (const auto& d : deps) {
    if (entity_rev(c, d) > world_revision) stale.push_back(d);
  }
  return stale;
}

std::vector<std::string> check_validity(const Core& c, const std::string& actor_id, const Proposal& p, const Offer* offer,
                                        const std::string& ignore_plan) {
  std::vector<std::string> reasons;
  auto add = [&](const std::string& r) {
    if (!r.empty()) append_unique(reasons, r);
  };
  const ActionDef* a = c.data.action(p.action);
  if (a == nullptr) {
    reasons.push_back("action_not_offered:" + p.action);
    return reasons;
  }
  for (const auto& f : p.fact_ids) {
    const FactDef* fd = c.data.fact(f);
    if (fd != nullptr && fd->is_protected) add("fact_protected:" + f);
    else if (offer != nullptr && !contains(offer->visible_facts, f)) add("fact_not_offered:" + f);
    else if (fd == nullptr || !knows(c, actor_id, f)) add("fact_unknown_to_actor:" + f);
  }
  add(role_check(c, actor_id, *a));
  add(cooldown_check(c, actor_id, *a));
  add(actor_state_check(c, actor_id, *a, ignore_plan));
  if (offer != nullptr) {
    const OfferedAction* oa = offer->find(p.action);
    if (oa == nullptr) add("action_not_offered:" + p.action);
    else {
      if (!p.target.empty() && !contains(oa->targets, p.target)) add("target_not_offered:" + p.target);
      if (!p.companion.empty() && !contains(oa->companions, p.companion)) add("companion_not_offered:" + p.companion);
    }
  }
  add(target_check(c, actor_id, *a, p.target, ignore_plan));
  add(companion_check(c, actor_id, *a, p.companion, p.target, ignore_plan));
  add(resources_check(c, *a, ignore_plan));
  add(tools_check(c, *a, ignore_plan));
  return reasons;
}

Evaluation evaluate(Core& c, const EvalInput& in) {
  Evaluation ev;
  // 1. format
  std::vector<std::string> fr;
  Proposal p;
  if (!parse_intent(c, in.text, *in.offer, p, fr)) {
    ev.status = "rejected";
    ev.failed_step = 1;
    ev.reasons = fr;
    add_step(ev, 1, false, reasons_ru(c, fr));
    skip_from(ev, 2, "не выполнялся: отказ на шаге 1");
    if (!in.is_fallback) c.rt.ai.invalid_intents++;
    return ev;
  }
  ev.parsed = true;
  ev.proposal = p;
  add_step(ev, 1, true,
           "один JSON-объект ≤" + std::to_string(kIntentMaxBytes) + " байт, без дубликатов и лишних полей; action=" +
               p.action + ", style=" + p.style);
  // 2. pending (actor binding comes from the host record)
  if (in.is_fallback) {
    add_step(ev, 2, true, "fallback ядра для " + in.task_id + " (" + in.fallback_reason + "), NPC = " + in.actor);
  } else {
    const PendingRequest* r = in.record;
    std::string fail_status, fail_reason;
    if (r == nullptr) {
      fail_status = "rejected";
      fail_reason = "unknown_task:" + in.task_id;
    } else if (r->state == "executed" || r->state == "fallback") {
      fail_status = "duplicate";
      fail_reason = "already_resolved";
    } else if (r->state == "expired") {
      fail_status = "expired";
      fail_reason = "deadline_passed";
    } else if (r->state == "cancelled") {
      fail_status = "rejected";
      fail_reason = "cancelled";
    } else if (in.now_ms > r->deadline_ms) {
      fail_status = "expired";
      fail_reason = "deadline_passed";
    }
    if (!fail_status.empty()) {
      ev.status = fail_status;
      ev.failed_step = 2;
      ev.reasons = {fail_reason};
      add_step(ev, 2, false, reason_ru(c, fail_reason));
      skip_from(ev, 3, "не выполнялся: отказ на шаге 2");
      return ev;
    }
    add_step(ev, 2, true,
             "запрос ожидается, до срока " + format_number_ru(std::floor(r->deadline_ms - in.now_ms)) +
                 " мс; NPC = " + r->actor + " (из записи хоста)");
  }
  // 3. semantic revision of the dependencies
  const std::vector<std::string> stale = stale_dependencies(c, in.actor, p, in.world_revision);
  if (!stale.empty()) {
    ev.status = "stale";
    ev.failed_step = 3;
    for (const auto& s : stale) ev.reasons.push_back("stale:" + s);
    add_step(ev, 3, false, reasons_ru(c, ev.reasons) + " (ревизия запроса " + std::to_string(in.world_revision) + ")");
    skip_from(ev, 4, "не выполнялся: устаревший ответ");
    return ev;
  }
  add_step(ev, 3, true, "зависимости не менялись после ревизии " + std::to_string(in.world_revision) +
                            " (текущая " + std::to_string(c.st.revision) + ")");
  // 4. validity
  const std::vector<std::string> invalid = check_validity(c, in.actor, p, in.offer, "");
  if (!invalid.empty()) {
    ev.status = "rejected";
    ev.failed_step = 4;
    ev.reasons = invalid;
    add_step(ev, 4, false, reasons_ru(c, invalid));
    skip_from(ev, 5, "не выполнялся: отказ на шаге 4");
    if (!in.is_fallback) c.rt.ai.invalid_intents++;
    return ev;
  }
  add_step(ev, 4, true, "цель, роль, навыки, знания, перезарядка, маршрут, ресурсы, физика и напарник проверены: " +
                            proposal_summary_ru(c, p));
  if (in.dry_run) {
    ev.status = "accepted";
    skip_from(ev, 5, "пробный прогон без изменений мира");
    return ev;
  }
  // 5–7
  commit(c, in, ev);
  return ev;
}

FallbackResult apply_fallback(Core& c, const std::string& task_id, const std::string& actor_id, const Situation& sit,
                              const std::string& reason, double now_ms, bool emit_verdict) {
  FallbackResult out;
  // Emergency reactions are ordinary game AI by design, not a failed model call: not counted as fallbacks.
  const bool emergency = reason == "emergency_rules";
  Offer fresh = compute_offer(c, actor_id, sit);
  PolicyChoice choice = choose(c, actor_id, sit, fresh);
  EvalInput in;
  in.task_id = task_id;
  in.actor = actor_id;
  in.text = proposal_text(choice.proposal);
  in.offer = &fresh;
  in.world_revision = fresh.world_revision;
  in.situation = sit;
  in.source = emergency ? kSrcSim : kSrcFallback;
  in.provider = "rules";
  in.model = "utility-policy";
  in.fallback_reason = reason;
  in.now_ms = now_ms;
  in.is_fallback = true;
  out.eval = evaluate(c, in);
  if (out.eval.status != "accepted" && out.eval.status != "awaiting_player") {
    // Defensive: the policy only proposes valid actions, but acknowledging is always possible.
    Proposal ack;
    ack.action = "acknowledge";
    ack.style = "neutral";
    ack.gesture = "nod";
    in.text = proposal_text(ack);
    out.eval = evaluate(c, in);
    choice.refusal_reason.clear();
  }
  if (!emergency) {
    c.rt.ai.fallbacks++;
    c.rt.ai.fallback_reasons[reason]++;
  }
  if (out.eval.parsed) {
    const ActionDef* a = c.data.action(out.eval.proposal.action);
    const std::string reason_code = choice.refusal_reason.empty() ? refusal_reason_for(c, actor_id, sit) : choice.refusal_reason;
    out.speech = speak_for(c, actor_id, out.eval.proposal, emergency ? "line" : "fallback", stage_for(*a, out.eval.status, sit),
                           &fresh.visible_facts, sit, out.eval.proposal.action == "refuse" ? refusal_category(reason_code) : "");
    out.has_speech = true;
    say(c, out.speech, emergency ? kSrcSim : kSrcFallback);
    share_spoken_facts(c, out.speech);
    if (out.eval.status == "accepted") companion_joins(c, out.eval.proposal, sit);
  }
  if (emit_verdict) {
    json::Value ep = json::Value::object();
    ep.set("task_id", task_id);
    ep.set("status", emergency ? out.eval.status : std::string("fallback"));
    ep.set("action", out.eval.parsed ? out.eval.proposal.action : "");
    ep.set("fallback_used", !emergency);
    ep.set("reason", reason);
    emit(c, "verdict", actor_id, std::move(ep), emergency ? kSrcSim : kSrcFallback);
  }
  return out;
}

json::Value steps_json(const std::vector<StepTrace>& steps) {
  json::Value arr = json::Value::array();
  for (const auto& s : steps) {
    json::Value v = json::Value::object();
    v.set("step", s.step);
    v.set("name", s.name);
    v.set("ok", s.ok);
    v.set("detail", s.detail);
    if (s.skipped) v.set("skipped", true);
    arr.push(v);
  }
  return arr;
}

json::Value verdict_json(const std::string& task_id, const std::string& actor_id, const std::string& status,
                         const Evaluation* model, const Evaluation* fallback, const std::string& fallback_reason,
                         const std::vector<std::string>& reasons) {
  json::Value v = json::Value::object();
  v.set("task_id", task_id);
  v.set("actor", actor_id);
  v.set("status", status);
  v.set("fallback_used", fallback != nullptr);
  v.set("fallback_reason", fallback_reason.empty() ? json::Value() : json::Value(fallback_reason));
  v.set("proposal", model != nullptr && model->parsed ? proposal_json(model->proposal) : json::Value());
  v.set("steps", model != nullptr ? steps_json(model->steps) : json::Value::array());
  const Evaluation* final_eval = fallback != nullptr ? fallback : model;
  const std::string plan_id = final_eval != nullptr ? final_eval->plan_id : "";
  const std::string world_task = final_eval != nullptr ? final_eval->world_task_id : "";
  v.set("plan_id", plan_id.empty() ? json::Value() : json::Value(plan_id));
  v.set("world_task_id", world_task.empty() ? json::Value() : json::Value(world_task));
  v.set("reasons", json::Value::string_array(reasons));
  if (fallback != nullptr) {
    json::Value f = json::Value::object();
    f.set("status", fallback->status);
    f.set("proposal", fallback->parsed ? proposal_json(fallback->proposal) : json::Value());
    f.set("steps", steps_json(fallback->steps));
    v.set("fallback", f);
  }
  return v;
}

SubmitOutcome submit_result(Core& c, const json::Value& result, double now_ms) {
  SubmitOutcome out;
  AiMetrics& m = c.rt.ai;
  m.results++;
  const std::string task_id = result["task_id"].str();
  const std::string provider_status = result["status"].str();
  const json::Value& usage = result["usage"];
  m.input_tokens += static_cast<std::uint64_t>(std::max<std::int64_t>(0, usage["input_tokens"].as_int()));
  m.output_tokens += static_cast<std::uint64_t>(std::max<std::int64_t>(0, usage["output_tokens"].as_int()));
  m.cached_tokens += static_cast<std::uint64_t>(std::max<std::int64_t>(0, usage["cached_input_tokens"].as_int()));
  m.reasoning_tokens += static_cast<std::uint64_t>(std::max<std::int64_t>(0, usage["reasoning_tokens"].as_int()));
  if (usage["measured"].as_bool()) m.measured_results++;
  else m.estimated_results++;
  if (result["cost_usd"].is_number()) {
    m.cost_usd += result["cost_usd"].as_number();
    m.results_with_cost++;
    if (result["cost_is_fictional"].as_bool()) m.cost_fictional = true;
  }
  const json::Value& lat = result["latency_ms"];
  if (lat["total"].is_number()) m.provider_total.values.push_back(lat["total"].as_number());
  if (lat["first_token"].is_number()) m.first_token.values.push_back(lat["first_token"].as_number());
  m.models_seen.insert(result["provider"].str() + ":" + result["model"].str());

  const auto it = c.st.requests.find(task_id);
  PendingRequest* rec = it == c.st.requests.end() ? nullptr : &it->second;
  const std::string actor_id = rec != nullptr ? rec->actor : "";
  Offer offer = rec != nullptr ? offer_from_request(rec->request) : Offer{};

  Evaluation model;
  std::string status;
  std::string fallback_reason;
  if (provider_status != "ok") {
    model.status = "rejected";
    model.failed_step = 1;
    model.reasons = {"provider_status:" + provider_status};
    add_step(model, 1, false, reason_ru(c, model.reasons.front()));
    skip_from(model, 2, "не выполнялся: исполнитель не вернул предложение");
    if (rec == nullptr) {
      status = "rejected";
      model.reasons.push_back("unknown_task:" + task_id);
    } else if (rec->state == "executed" || rec->state == "fallback") {
      status = "duplicate";
    } else if (rec->state == "expired") {
      status = "expired";
    } else if (rec->state == "cancelled") {
      status = "rejected";
      model.reasons.push_back("cancelled");
    } else if (now_ms > rec->deadline_ms) {
      status = "expired";
      fallback_reason = "deadline";
    } else {
      status = "fallback";
      fallback_reason = provider_status;
    }
  } else {
    EvalInput in;
    in.task_id = task_id;
    in.actor = actor_id;
    in.text = result["proposal_text"].str();
    in.offer = &offer;
    in.record = rec;
    in.world_revision = rec != nullptr ? rec->world_revision : 0;
    if (rec != nullptr) in.situation = rec->situation;
    in.source = kSrcAgent;
    in.provider = result["provider"].str();
    in.model = result["model"].str();
    in.now_ms = now_ms;
    model = evaluate(c, in);
    status = model.status;
    if (rec != nullptr && rec->state == "pending") {
      if (status == "accepted" || status == "awaiting_player") {
        rec->state = "executed";
        rec->resolution = status;
      } else if (status == "expired") {
        fallback_reason = "deadline";
      } else if (status == "stale") {
        fallback_reason = "stale";
      } else if (status == "rejected") {
        fallback_reason = model.failed_step == 1 ? "invalid_output" : "authority_rejected";
      }
    }
  }

  FallbackResult fb;
  bool used_fallback = false;
  if (!fallback_reason.empty() && rec != nullptr && rec->state == "pending") {
    rec->state = status == "expired" ? "expired" : "fallback";
    rec->resolution = fallback_reason;
    fb = apply_fallback(c, task_id, actor_id, rec->situation, fallback_reason, now_ms, false);
    used_fallback = true;
  }
  if (rec != nullptr) m.ready.values.push_back(now_ms - rec->created_ms);
  count_verdict(c, status);
  std::vector<std::string> reasons = model.reasons;
  out.verdict = verdict_json(task_id, actor_id, status, &model, used_fallback ? &fb.eval : nullptr, fallback_reason, reasons);
  if (status == "accepted" || status == "awaiting_player") {
    const ActionDef* a = c.data.action(model.proposal.action);
    // A refusal is voiced with the reason the game itself knows (secret, power budget, broken rule).
    const std::string reason = model.proposal.action == "refuse" ? refusal_category(refusal_reason_for(c, actor_id, rec->situation)) : "";
    Speech s = speak_for(c, actor_id, model.proposal, "line", stage_for(*a, status, rec->situation), &offer.visible_facts, rec->situation, reason);
    say(c, s, kSrcAgent);
    if (status == "accepted") companion_joins(c, model.proposal, rec->situation);
    share_spoken_facts(c, s);
    out.speech = speech_json(s);
  } else if (used_fallback && fb.has_speech) {
    out.speech = speech_json(fb.speech);
  }
  json::Value ep = json::Value::object();
  ep.set("task_id", task_id);
  ep.set("status", status);
  ep.set("action", model.parsed ? model.proposal.action : "");
  ep.set("fallback_used", used_fallback);
  ep.set("reasons", json::Value::string_array(reasons));
  emit(c, "verdict", actor_id, std::move(ep), used_fallback ? kSrcFallback : kSrcAgent);
  if (rec != nullptr) compact_resolved_request(*rec);
  return out;
}

void release_plan(Core& c, Plan& plan, const std::string& new_state) {
  std::vector<std::string> touched{plan.actor, plan.proposal.companion};
  for (const auto& [res, amount] : plan.reserved) {
    c.st.resources[res].reserved -= amount;
    if (std::fabs(c.st.resources[res].reserved) < 1e-9) c.st.resources[res].reserved = 0.0;
    touched.push_back(res);
  }
  plan.reserved.clear();
  for (const auto& tool : plan.tools) {
    if (c.st.items[tool].lock == plan.id) c.st.items[tool].lock.clear();
    touched.push_back(tool);
  }
  plan.tools.clear();
  if (ActorState* a = actor(c, plan.actor); a != nullptr && a->plan_id == plan.id) a->plan_id.clear();
  if (ActorState* comp = actor(c, plan.proposal.companion); comp != nullptr && comp->soft_plan == plan.id) comp->soft_plan.clear();
  plan.state = new_state;
  bump_revision(c, touched);
}

void expire_plans(Core& c, double now_ms) {
  std::vector<std::string> due;
  for (const auto& [id, plan] : c.st.plans) {
    if (plan.state == "awaiting_player" && c.st.sim_ms >= plan.expires_ms) due.push_back(id);
  }
  for (const auto& id : due) {
    Plan& plan = c.st.plans.at(id);
    release_plan(c, plan, "expired");
    emit(c, "plan_expired", plan.actor, plan_payload(plan), kSrcSim);
    Speech s = speak_for(c, plan.actor, plan.proposal, "line", "expired", nullptr, plan.situation, "");
    say(c, s, kSrcSim);
    Situation sit = plan.situation;
    sit.no_approval = true;
    sit.origin = "plan_expired";
    apply_fallback(c, plan.request_id, plan.actor, sit, "plan_expired", now_ms);
  }
}

SubmitOutcome decide_plan(Core& c, const std::string& plan_id, const std::string& decision, const std::string& companion,
                          double now_ms, std::string& error_code, std::string& error_message) {
  SubmitOutcome out;
  expire_plans(c, now_ms);
  const auto it = c.st.plans.find(plan_id);
  if (it == c.st.plans.end()) {
    error_code = "not_found";
    error_message = "план " + plan_id + " не найден";
    return out;
  }
  Plan& plan = it->second;
  if (plan.state != "awaiting_player") {
    error_code = "invalid_state";
    error_message = "план " + plan_id + " уже не ждёт решения (" + plan.state + ")";
    return out;
  }
  const std::string actor_id = plan.actor;
  Evaluation ev;
  ev.parsed = true;
  ev.proposal = plan.proposal;
  ev.plan_id = plan_id;
  add_step(ev, 1, true, "план " + plan_id + " разобран при предложении");
  add_step(ev, 2, true, "план ждёт решения Алекса до t=" + format_number_ru(static_cast<double>(plan.expires_ms) / 1000.0) + " с");
  std::string status;
  std::vector<std::string> reasons;
  Speech speech;
  bool has_speech = false;
  FallbackResult fb;
  bool used_fallback = false;
  std::string fallback_reason;

  json::Value dp = json::Value::object();
  dp.set("plan_id", plan_id);
  dp.set("decision", decision);
  if (!companion.empty()) dp.set("companion", companion);
  emit(c, "player_decision", c.data.player_id, dp, kSrcPlayer);

  if (decision == "ask_evidence") {
    std::vector<std::string> facts = plan.proposal.fact_ids;
    if (facts.empty()) {
      for (const auto& f : visible_facts(c, actor_id, plan.situation)) {
        if (facts.size() < 2) facts.push_back(f);
      }
    }
    SpeechRequest req;
    req.actor = actor_id;
    req.kind = "evidence";
    req.stage = "evidence";
    req.action = plan.proposal.action;
    req.style = plan.proposal.style;
    req.target = plan.proposal.target;
    req.companion = plan.proposal.companion;
    req.fact_ids = facts;
    req.situation = speech_situation(c, plan.situation);
    speech = render_speech(c, req);
    has_speech = true;
    say(c, speech, kSrcSim);
    share_spoken_facts(c, speech);
    status = "awaiting_player";
    skip_from(ev, 3, "Алекс запросил доказательства — план остаётся на решении");
    emit(c, "plan_decided", actor_id, plan_decided_payload(plan, decision, "awaiting_player"), kSrcPlayer);
  } else if (decision == "reject") {
    release_plan(c, plan, "rejected");
    ActorState* a = actor(c, actor_id);
    a->trust_player = clamp01(a->trust_player - 0.03);
    const std::int64_t seq = emit(c, "plan_decided", actor_id, plan_decided_payload(plan, decision, "rejected"), kSrcPlayer).seq;
    remember(c, actor_id, "episode", "Алекс отклонил мой план: " + proposal_summary_ru(c, plan.proposal) + ".",
             "event:" + std::to_string(seq), 0.6, {c.data.player_id});
    speech = speak_for(c, actor_id, plan.proposal, "line", "rejected", nullptr, plan.situation, "");
    has_speech = true;
    say(c, speech, kSrcSim);
    add_step(ev, 3, true, "решение игрока");
    add_step(ev, 4, true, "план отклонён Алексом");
    add_step(ev, 5, true, "мягкий резерв снят");
    add_step(ev, 6, false, "задача не создаётся");
    add_step(ev, 7, true, "событие #" + std::to_string(seq) + "; память: эпизод об отказе");
    status = "rejected";
    reasons.push_back("player_rejected");
    Situation sit = plan.situation;
    sit.no_approval = true;
    fallback_reason = "player_rejected";
    fb = apply_fallback(c, plan.request_id, actor_id, sit, fallback_reason, now_ms, false);
    used_fallback = true;
  } else {  // accept | reassign
    Proposal p = plan.proposal;
    std::string final_state = "accepted";
    if (decision == "reassign") {
      const ActionDef* a = c.data.action(p.action);
      const std::string err = companion_check(c, actor_id, *a, companion, p.target, plan_id);
      if (companion.empty() || !err.empty()) {
        status = "rejected";
        reasons.push_back(companion.empty() ? "companion_required" : err);
        add_step(ev, 3, true, "решение игрока");
        add_step(ev, 4, false, companion.empty() ? "не указан напарник" : reason_ru(c, err));
        skip_from(ev, 5, "план остаётся на решении");
        Proposal with_comp = p;
        with_comp.companion = companion;
        speech = speak_for(c, actor_id, with_comp, "line", "reassign_invalid", nullptr, plan.situation, "");
        has_speech = true;
        say(c, speech, kSrcSim);
        count_verdict(c, status);
        out.verdict = verdict_json(plan.request_id, actor_id, status, &ev, nullptr, "", reasons);
        out.speech = speech_json(speech);
        return out;
      }
      p.companion = companion;
      final_state = "accepted";
    }
    add_step(ev, 3, true, "перепроверка по текущему состоянию мира (ревизия " + std::to_string(c.st.revision) + ")");
    std::vector<std::string> invalid = check_validity(c, actor_id, p, nullptr, plan_id);
    bool companion_problem = false;
    bool other_problem = false;
    for (const auto& r : invalid) {
      if (starts_with(r, "companion_") || ((starts_with(r, "eva_") || starts_with(r, "route_")) && r.find(p.companion) != std::string::npos && !p.companion.empty())) {
        companion_problem = true;
      } else {
        other_problem = true;
      }
    }
    std::string replaced;
    if (companion_problem && !other_problem && decision == "accept") {
      // Re-evaluation: the companion became unavailable; pick another free one (no double spend: the plan's
      // reservation is transferred, never reserved again).
      std::vector<std::string> cands;
      const ActionDef* a = c.data.action(p.action);
      for (const auto& n : c.data.crew) {
        if (n.is_player || n.id == actor_id || n.id == p.companion) continue;
        if (companion_check(c, actor_id, *a, n.id, p.target, plan_id).empty()) cands.push_back(n.id);
      }
      const std::string alt = best_companion(c, actor_id, cands, p.companion, plan_id);
      reasons = invalid;
      if (!alt.empty()) {
        replaced = p.companion;
        p.companion = alt;
        reasons.push_back("replanned_companion:" + alt);
        invalid = check_validity(c, actor_id, p, nullptr, plan_id);
        final_state = "replanned";
      }
    }
    if (!invalid.empty()) {
      add_step(ev, 4, false, reasons_ru(c, invalid));
      skip_from(ev, 5, "план снят: переоценка обычным игровым ИИ");
      for (const auto& r : invalid) append_unique(reasons, r);
      release_plan(c, plan, "replanned");
      emit(c, "plan_decided", actor_id, plan_decided_payload(plan, decision, "fallback"), kSrcPlayer);
      status = "fallback";
      fallback_reason = "replan_failed";
      Situation sit = plan.situation;
      sit.no_approval = true;
      fb = apply_fallback(c, plan.request_id, actor_id, sit, fallback_reason, now_ms, false);
      used_fallback = true;
    } else {
      add_step(ev, 4, true, replaced.empty() ? "все условия выполняются" : "у " + c.data.speech.names.at(replaced).gen + " другая задача — напарником становится " + name_of(c, p.companion));
      // 5: transfer the soft reservation; people become hard-reserved by the task.
      const ActionDef& a = *c.data.action(p.action);
      if (ActorState* old = actor(c, plan.proposal.companion); old != nullptr && old->soft_plan == plan_id) old->soft_plan.clear();
      if (ActorState* prop = actor(c, actor_id); prop != nullptr && prop->plan_id == plan_id) prop->plan_id.clear();
      plan.proposal = p;
      TaskSpec spec;
      spec.action = p.action;
      spec.executor = executor_of(a, actor_id, p.target);
      spec.companion = p.companion;
      spec.target = p.target;
      spec.proposer = actor_id;
      spec.origin = plan_id;
      spec.source = kSrcPlayer;
      spec.style = p.style;
      spec.gesture = p.gesture;
      spec.fact_ids = p.fact_ids;
      spec.from_plan = plan_id;
      const std::string reservation = list_reservation(c, a, spec.executor, p.companion);
      const std::string task_id = start_task(c, spec, now_ms);
      plan.reserved.clear();
      plan.tools.clear();
      plan.state = final_state;
      plan.world_task_id = task_id;
      ev.world_task_id = task_id;
      add_step(ev, 5, true, "резерв плана передан задаче без повторного списания: " + reservation);
      add_step(ev, 6, true, "задача " + task_id + " создана: путь " + join(c.st.tasks.at(task_id).travel.path, " → "));
      ActorState* pa = actor(c, actor_id);
      pa->trust_player = clamp01(pa->trust_player + 0.03);
      const std::int64_t seq = emit(c, "plan_decided", actor_id, plan_decided_payload(plan, decision, final_state), kSrcPlayer).seq;
      remember(c, actor_id, "promise",
               "Алекс одобрил план: " + proposal_summary_ru(c, p) + ". Обещание: выполнить это " +
                   (p.companion.empty() ? "без напарника." : "вместе с " + c.data.speech.names.at(p.companion).ins + "."),
               "event:" + std::to_string(seq), 0.6, {c.data.player_id, p.target, p.companion});
      if (!p.companion.empty()) {
        remember(c, p.companion, "episode", "Иду напарником к " + c.data.speech.names.at(actor_id).dat + ": " + proposal_summary_ru(c, p) + ".",
                 "event:" + std::to_string(seq), 0.45, {actor_id, p.target});
      }
      add_step(ev, 7, true, "событие #" + std::to_string(seq) + "; память: обещание с источником");
      status = "accepted";
      const std::string stage = final_state == "replanned" ? "replanned" : (decision == "reassign" ? "reassigned" : "accepted");
      speech = speak_for(c, actor_id, p, "line", stage, nullptr, plan.situation, "");
      has_speech = true;
      say(c, speech, kSrcSim);
      companion_joins(c, p, plan.situation);
      audit_invariants(c, "plan " + plan_id);
    }
  }
  count_verdict(c, status);
  out.verdict = verdict_json(plan.request_id, actor_id, status, &ev, used_fallback ? &fb.eval : nullptr, fallback_reason, reasons);
  out.verdict.set("plan_id", plan_id);
  if (used_fallback && !has_speech && fb.has_speech) {
    speech = fb.speech;
    has_speech = true;
  }
  out.speech = has_speech ? speech_json(speech) : json::Value();
  return out;
}

void audit_invariants(Core& c, const std::string& where) {
  std::vector<std::string> problems;
  std::map<std::string, double> expected_reserved;
  std::map<std::string, int> tasks_per_actor;
  for (const auto& [id, t] : c.st.tasks) {
    if (t.state != "active") continue;
    for (const auto& [res, v] : t.reserved) expected_reserved[res] += v;
    tasks_per_actor[t.actor]++;
    if (!t.companion.empty()) tasks_per_actor[t.companion]++;
    const ActorState* a = actor(c, t.actor);
    if (a == nullptr || a->task_id != id) problems.push_back("task " + id + " executor not bound");
    for (const auto& tool : t.tools) {
      if (c.st.items.at(tool).lock != id) problems.push_back("tool " + tool + " not locked by " + id);
    }
  }
  for (const auto& [id, p] : c.st.plans) {
    if (p.state != "awaiting_player") continue;
    for (const auto& [res, v] : p.reserved) expected_reserved[res] += v;
  }
  for (const auto& [id, r] : c.st.resources) {
    if (r.amount < -1e-9) problems.push_back("resource " + id + " negative");
    if (r.reserved < -1e-9 || r.reserved > r.amount + 1e-9) problems.push_back("resource " + id + " over-reserved");
    if (std::fabs(r.reserved - expected_reserved[id]) > 1e-9) problems.push_back("resource " + id + " reservation mismatch");
  }
  for (const auto& [actor_id, n] : tasks_per_actor) {
    if (n > 1) problems.push_back("actor " + actor_id + " in " + std::to_string(n) + " tasks");
  }
  for (const auto& [actor_id, mem] : c.st.memory) {
    for (const auto& k : mem.facts) {
      const FactDef* f = c.data.fact(k.fact);
      if (f == nullptr || f->is_protected) problems.push_back("protected fact known by " + actor_id);
    }
  }
  for (const auto& [id, s] : c.st.sensors) {
    const SensorDef* def = c.data.sensor(id);
    if (def != nullptr && s.truth.value != def->truth.value) problems.push_back("physical truth changed for " + id);
  }
  for (const auto& p : problems) {
    c.rt.ai.violations_admitted++;
    c.rt.ai.violation_log.push_back(where + ": " + p);
    json::Value v = json::Value::object();
    v.set("where", where);
    v.set("detail", p);
    emit(c, "invariant_violation", "", std::move(v), kSrcSim);
  }
}

}  // namespace echo
