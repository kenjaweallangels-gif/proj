#include "echo/rules.hpp"

#include "echo/world.hpp"

namespace echo {
namespace {

std::string code(const std::string& c, const std::string& detail = "") { return detail.empty() ? c : c + ":" + detail; }

double reserved_by_plan(const Core& c, const std::string& plan_id, const std::string& resource) {
  if (plan_id.empty()) return 0.0;
  const auto it = c.st.plans.find(plan_id);
  if (it == c.st.plans.end() || it->second.state != "awaiting_player") return 0.0;
  double sum = 0.0;
  for (const auto& [r, v] : it->second.reserved) {
    if (r == resource) sum += v;
  }
  return sum;
}

std::string rest_zone_for(const Core& c, const std::string& executor) {
  const ActorState* a = actor(c, executor);
  if (a != nullptr) {
    const ZoneDef* home = c.data.zone(a->home_zone);
    if (home != nullptr && home->pressurized && !home->suit_required) return home->id;
  }
  for (const auto& z : c.data.zones) {
    if (z.kind == "habitat") return z.id;
  }
  return a != nullptr ? a->zone : "";
}

}  // namespace

bool is_remote_action(const ActionDef& a) { return a.id == "drone_survey"; }

std::string executor_of(const ActionDef& a, const std::string& actor_id, const std::string& target) {
  if (contains(a.target_kinds, "actor") && !target.empty() && contains(a.effects, "rest")) return target;
  return actor_id;
}

std::string work_zone_for(const Core& c, const ActionDef& a, const std::string& executor, const std::string& target) {
  if (contains(a.effects, "rest")) return rest_zone_for(c, executor);
  const ActorState* ex = actor(c, executor);
  if (is_remote_action(a) || target.empty()) return ex != nullptr ? ex->zone : "";
  return zone_of_entity(c, target);
}

bool needs_approval(const ActionDef& a, const std::string& actor_id, const std::string& target,
                    const std::string& companion) {
  if (a.approval == "always") return true;
  if (a.approval == "if_companion") return !companion.empty();
  if (a.approval == "if_target_other") return !target.empty() && target != actor_id;
  return false;
}

std::string role_check(const Core& c, const std::string& actor_id, const ActionDef& a) {
  const NpcDef* n = c.data.npc(actor_id);
  if (n == nullptr || n->is_player) return code("unknown_actor", actor_id);
  if (!contains(a.roles, "*") && !contains(a.roles, n->role)) return code("role_not_allowed", n->role);
  for (const auto& [skill, min] : a.min_skill) {
    if (n->skill(skill) < min) return code("skill_too_low", skill);
  }
  return "";
}

std::string cooldown_check(const Core& c, const std::string& actor_id, const ActionDef& a) {
  const ActorState* st = actor(c, actor_id);
  if (st == nullptr) return code("unknown_actor", actor_id);
  const auto it = st->cooldown_until_ms.find(a.id);
  if (it != st->cooldown_until_ms.end() && it->second > c.st.sim_ms) return code("cooldown", a.id);
  return "";
}

std::string actor_state_check(const Core& c, const std::string& actor_id, const ActionDef& a, const std::string& ignore_plan) {
  const ActorState* st = actor(c, actor_id);
  if (st == nullptr) return code("unknown_actor", actor_id);
  if (a.instant()) return "";
  if (!st->plan_id.empty() && st->plan_id != ignore_plan) return code("actor_has_pending_plan", st->plan_id);
  // propose_rest of someone else: the proposer does not execute it, the target's availability is checked instead.
  if (contains(a.effects, "rest") && contains(a.target_kinds, "actor")) return "";
  if (actor_busy(c, actor_id)) return code("actor_busy", actor_id);
  return "";
}

std::string resources_check(const Core& c, const ActionDef& a, const std::string& ignore_plan) {
  for (const auto& [res, amount] : a.consumes) {
    const double free = resource_free(c, res) + reserved_by_plan(c, ignore_plan, res);
    if (free + 1e-9 < amount) return code("resource_short", res);
  }
  return "";
}

std::string tools_check(const Core& c, const ActionDef& a, const std::string& ignore_plan) {
  for (const auto& tool : a.tools) {
    const auto it = c.st.items.find(tool);
    if (it == c.st.items.end()) return code("tool_missing", tool);
    if (!it->second.lock.empty() && it->second.lock != ignore_plan) return code("tool_locked", tool);
  }
  return "";
}

bool companion_available(const Core& c, const std::string& id, const std::string& ignore_plan) {
  if (!is_npc(c, id) || actor_busy(c, id)) return false;
  const ActorState* a = actor(c, id);
  if (!a->plan_id.empty() && a->plan_id != ignore_plan) return false;
  if (!a->soft_plan.empty() && a->soft_plan != ignore_plan) return false;
  return true;
}

std::string target_check(const Core& c, const std::string& actor_id, const ActionDef& a, const std::string& target,
                         const std::string& ignore_plan) {
  if (target.empty()) return a.target_required ? code("target_required") : "";
  if (a.target_kinds.empty()) return code("target_not_allowed", target);
  const std::string kind = c.data.kind_of(target);
  if (kind.empty()) return code("target_unknown", target);
  if (!contains(a.target_kinds, kind)) return code("target_kind", kind);
  if (kind == "zone" && !a.zone_kinds.empty() && !contains(a.zone_kinds, c.data.zone(target)->kind)) {
    return code("zone_kind_not_allowed", target);
  }
  if (kind == "item" && !a.item_kinds.empty() && !contains(a.item_kinds, c.data.item(target)->kind)) {
    return code("item_kind_not_allowed", target);
  }
  if (kind == "actor") {
    if (!is_npc(c, target)) return code("target_not_npc", target);
    if (target == actor_id) {
      if (!a.self_allowed) return code("target_self_not_allowed");
      if (actor_busy(c, actor_id)) return code("actor_busy", actor_id);
    } else {
      const NpcDef* n = c.data.npc(actor_id);
      if (!contains(a.others_roles, n->role)) return code("target_other_not_allowed", target);
      const ActorState* t = actor(c, target);
      if (actor_busy(c, target) || (!t->plan_id.empty() && t->plan_id != ignore_plan)) return code("target_busy", target);
    }
  }
  // Action-specific world conditions.
  if (contains(a.effects, "clear_sensor_fault")) {
    if (kind != "sensor" || c.st.sensors.at(target).fault.empty()) return code("nothing_to_repair", target);
  }
  if (contains(a.effects, "preserve_sample") && c.st.items.at(target).preserved) return code("already_done", target);
  if (contains(a.effects, "rover_ready") && c.st.items.at(target).ready) return code("already_done", target);
  if (contains(a.effects, "seal_zone")) {
    if (c.st.sealed_zones.count(target) != 0) return code("zone_sealed", target);
    for (const auto& [id, st] : c.st.actors) {
      if (st.zone == target) return code("zone_occupied", target);
    }
  }
  // Route and physical rules for whoever performs the action.
  const std::string executor = executor_of(a, actor_id, target);
  const ActorState* ex = actor(c, executor);
  if (ex == nullptr) return code("unknown_actor", executor);
  const std::string zone = work_zone_for(c, a, executor, target);
  if (c.st.sealed_zones.count(zone) != 0) return code("zone_sealed", zone);
  const Route r = find_route(c, ex->zone, zone);
  if (!r.ok) return code(r.blocked_reason == "zone_sealed" ? "zone_sealed" : "route_sealed", zone);
  if (!is_remote_action(a)) {
    std::string why;
    if (!eva_ok(c, executor, r.zones, why)) return code(why, executor);
  }
  return "";
}

std::string companion_check(const Core& c, const std::string& actor_id, const ActionDef& a, const std::string& companion,
                            const std::string& target, const std::string& ignore_plan) {
  if (companion.empty()) return "";
  if (a.companion == "none") return code("companion_not_allowed", a.id);
  if (companion == actor_id) return code("companion_is_actor");
  if (!is_npc(c, companion)) return code("companion_unknown", companion);
  if (actor_busy(c, companion)) return code("companion_busy", companion);
  const ActorState* comp = actor(c, companion);
  if (!comp->plan_id.empty() && comp->plan_id != ignore_plan) return code("companion_busy", companion);
  if (!comp->soft_plan.empty() && comp->soft_plan != ignore_plan) return code("companion_reserved", companion);
  if (!target.empty()) {
    const std::string zone = work_zone_for(c, a, actor_id, target);
    const Route r = find_route(c, comp->zone, zone);
    if (!r.ok) return code("route_sealed", zone);
    std::string why;
    if (!eva_ok(c, companion, r.zones, why)) return code(why, companion);
  }
  return "";
}

std::string reason_ru(const Core& c, const std::string& reason) {
  const std::size_t colon = reason.find(':');
  const std::string k = reason.substr(0, colon);
  const std::string d = colon == std::string::npos ? std::string() : reason.substr(colon + 1);
  const std::string name = d.empty() ? std::string() : c.data.label(d);
  // Genitive form for "у кого" phrases (declined names live in data/speech_ru.json).
  const auto names = c.data.speech.names.find(d);
  const std::string gen = names != c.data.speech.names.end() ? names->second.gen : name;
  if (k == "unknown_field") return "неизвестное поле «" + d + "» — поля хоста и лишние поля модели не принимаются";
  if (k == "duplicate_key") return "повторяющийся ключ «" + d + "»";
  if (k == "too_large") return "ответ длиннее лимита байт";
  if (k == "depth_exceeded") return "слишком глубокая вложенность";
  if (k == "not_object") return "ответ должен быть одним JSON-объектом";
  if (k == "bad_json") return "неверный JSON (" + d + ")";
  if (k == "wrong_type") return "неверный тип поля «" + d + "»";
  if (k == "missing_field") return "нет обязательного поля «" + d + "»";
  if (k == "bad_pattern") return "недопустимое значение поля «" + d + "»";
  if (k == "action_not_offered") return "действие «" + d + "» не было предложено игрой";
  if (k == "bad_style") return "неизвестный стиль «" + d + "»";
  if (k == "bad_gesture") return "неизвестный жест «" + d + "»";
  if (k == "fact_ids_not_unique") return "fact_ids повторяются";
  if (k == "fact_ids_too_many") return "слишком много фактов для этого действия";
  if (k == "fact_ids_too_few") return "для этого действия нужны факты-обоснования";
  if (k == "provider_status") return "исполнитель вернул статус «" + d + "»";
  if (k == "unknown_task") return "запрос " + d + " не ожидается";
  if (k == "already_resolved") return "запрос уже обработан — повтор не исполняется";
  if (k == "cancelled") return "запрос отменён хостом";
  if (k == "deadline_passed") return "срок ответа истёк";
  if (k == "stale") return "изменилась сущность «" + name + "» после выдачи запроса";
  if (k == "target_required") return "нужна цель";
  if (k == "target_not_allowed") return "у действия нет цели";
  if (k == "target_unknown") return "цель «" + d + "» не существует";
  if (k == "target_not_offered") return "цель «" + name + "» не была предложена";
  if (k == "target_kind") return "цель неподходящего типа (" + d + ")";
  if (k == "zone_kind_not_allowed") return "этот отсек нельзя выбрать для действия";
  if (k == "item_kind_not_allowed") return "этот предмет нельзя выбрать для действия";
  if (k == "target_not_npc") return "цель должна быть членом экипажа";
  if (k == "target_self_not_allowed") return "нельзя выбрать себя";
  if (k == "target_other_not_allowed") return "отправлять на отдых других может только врач";
  if (k == "target_busy") return "у " + gen + " сейчас другая задача";
  if (k == "nothing_to_repair") return "у цели «" + name + "» нет неисправности";
  if (k == "already_done") return "уже сделано: " + name;
  if (k == "zone_occupied") return "в отсеке «" + name + "» есть люди — герметизация запрещена";
  if (k == "zone_sealed") return "отсек «" + name + "» загерметизирован";
  if (k == "route_sealed") return "нет прохода к «" + name + "» (дверь загерметизирована)";
  if (k == "eva_fatigue") return "у " + gen + " слишком высокая усталость для выхода в скафандре";
  if (k == "eva_skill") return "у " + gen + " не хватает навыка EVA";
  if (k == "role_not_allowed") return "действие не по роли (" + d + ")";
  if (k == "skill_too_low") return "не хватает навыка «" + d + "»";
  if (k == "fact_not_offered") return "факт «" + d + "» не был выдан в запросе";
  if (k == "fact_unknown_to_actor") return "персонаж не знает факт «" + d + "»";
  if (k == "fact_protected") return "защищённый факт «" + d + "» не выдаётся никогда";
  if (k == "cooldown") return "действие ещё на перезарядке";
  if (k == "resource_short") return "не хватает ресурса «" + name + "» с учётом резерва";
  if (k == "tool_missing") return "нет инструмента «" + name + "»";
  if (k == "tool_locked") return "инструмент «" + name + "» уже занят";
  if (k == "companion_not_allowed") return "для этого действия напарник не предусмотрен";
  if (k == "companion_not_offered") return "напарник «" + name + "» не был предложен";
  if (k == "companion_is_actor") return "напарник не может совпадать с исполнителем";
  if (k == "companion_unknown") return "напарник «" + d + "» не член экипажа";
  if (k == "companion_busy") return "у " + gen + " уже есть другая задача";
  if (k == "companion_reserved") return "напарник «" + name + "» уже обещан другому плану";
  if (k == "actor_busy") return "исполнитель занят другой задачей";
  if (k == "actor_has_pending_plan") return "у персонажа уже есть план на решении у Алекса";
  if (k == "unknown_actor") return "неизвестный персонаж";
  if (k == "plan_not_awaiting") return "план уже не ждёт решения";
  if (k == "plan_expired") return "срок плана истёк";
  if (k == "power_budget") return "энергия сверх запаса до вечерней подзарядки";
  return reason;
}

std::string refusal_category(const std::string& reason) {
  if (reason.empty()) return "";
  const std::string k = reason.substr(0, reason.find(':'));
  if (k == "power_budget" || k == "resource_short") return k == "power_budget" ? "power" : "resource";
  if (k == "secret") return "secret";
  if (k == "eva_fatigue" || k == "eva_skill") return "eva";
  if (k == "actor_busy" || k == "actor_has_pending_plan" || k == "cooldown") return "busy";
  if (k == "role_not_allowed" || k == "skill_too_low") return "role";
  if (k == "route_sealed" || k == "zone_sealed") return "route";
  if (k.empty()) return "generic";
  return "invalid";
}

}  // namespace echo
