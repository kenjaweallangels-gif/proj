#include "echo/biography.hpp"

#include <cmath>

#include "echo/world.hpp"

namespace echo {
namespace {

bool same_pair(const JournalEntry& e, const std::vector<std::string>& pair) {
  if (pair.size() != 2) return true;
  return (e.actor == pair[0] && e.companion == pair[1]) || (e.actor == pair[1] && e.companion == pair[0]);
}

int count_matching(const Core& c, const BioDetailDef& d, const std::string& zone) {
  int n = 0;
  auto consider = [&](const JournalEntry& e) {
    if (e.kind != d.journal_kind) return;
    if (!d.pair.empty() && !same_pair(e, d.pair)) return;
    if (d.with_companion && e.companion.empty()) return;
    if (!d.actor.empty() && e.actor != d.actor) return;
    if (d.by_non_owner) {
      const auto owner = c.data.biography.tool_owner.find(e.detail);
      if (owner == c.data.biography.tool_owner.end() || owner->second == e.actor) return;
    }
    ++n;
  };
  if (!d.pair.empty()) {
    for (const auto& [z, entries] : c.st.journals) {
      for (const auto& e : entries) consider(e);
    }
  } else if (const auto it = c.st.journals.find(zone); it != c.st.journals.end()) {
    for (const auto& e : it->second) consider(e);
  }
  return n;
}

bool already_placed(const Core& c, const BioDetailDef& d, const std::string& zone) {
  for (const auto& p : c.st.biography) {
    if (p.detail_id == d.id && (p.zone == zone || !d.pair.empty())) return true;
  }
  return false;
}

}  // namespace

std::string biography_validate(const Core& c, const BioDetailDef& d, const std::string& zone, const std::string& anchor) {
  const BiographyData& b = c.data.biography;
  const auto it = b.anchors.find(anchor);
  if (it == b.anchors.end()) return "anchor_unknown";
  const BioAnchor& a = it->second;
  if (a.zone != zone) return "anchor_wrong_zone";
  const ZoneDef* z = c.data.zone(zone);
  if (z == nullptr || !contains(z->anchors, anchor)) return "anchor_not_in_world";
  if (contains(b.blocked_roles, a.role)) return "anchor_blocked_role:" + a.role;
  if (!contains(d.roles, a.role)) return "role_not_allowed:" + a.role;
  if (d.collision && a.role == "control") return "blocks_control";
  int in_zone = 0;
  for (const auto& p : c.st.biography) {
    if (p.anchor == anchor) return "anchor_occupied";
    if (p.zone == zone) ++in_zone;
  }
  if (in_zone >= b.max_details_per_zone) return "zone_full";
  if (c.data.layout.present) {
    const auto pos = c.data.layout.anchors.find(anchor);
    const auto stand = c.data.layout.stand_points.find(zone);
    if (pos == c.data.layout.anchors.end()) return "anchor_not_in_layout";
    if (stand != c.data.layout.stand_points.end()) {
      const double dx = pos->second[0] - stand->second[0];
      const double dz = pos->second[2] - stand->second[2];
      if (std::sqrt(dx * dx + dz * dz) < b.min_clearance_m) return "too_close_to_stand_point";
    }
  }
  return "";
}

void biography_record(Core& c, const std::string& zone, const std::string& kind, const Task& task, const std::string& tool) {
  if (zone.empty()) return;
  JournalEntry e;
  e.t_ms = c.st.sim_ms;
  e.kind = kind;
  e.actor = task.actor;
  e.companion = task.companion;
  e.task_id = task.id;
  e.action = task.action;
  e.detail = tool;
  c.st.journals[zone].push_back(e);

  for (const auto& d : c.data.biography.details) {
    if (d.journal_kind != kind) continue;
    std::string place_zone = zone;
    if (d.place == "home_zone_of") place_zone = c.st.actors.at(d.place_actor).home_zone;
    if (d.place == "actor_home") place_zone = c.st.actors.at(task.actor).home_zone;
    if (already_placed(c, d, place_zone) || count_matching(c, d, zone) < d.min_count) continue;
    // Anchors in the order authored for the zone, preferring the detail's roles in their listed order.
    const ZoneDef* z = c.data.zone(place_zone);
    std::string chosen, last_error = "no_anchor";
    for (const auto& role : d.roles) {
      for (const auto& anchor : z->anchors) {
        const auto ai = c.data.biography.anchors.find(anchor);
        if (ai == c.data.biography.anchors.end() || ai->second.role != role) continue;
        const std::string err = biography_validate(c, d, place_zone, anchor);
        if (err.empty()) {
          chosen = anchor;
          break;
        }
        last_error = err;
      }
      if (!chosen.empty()) break;
    }
    json::Value p = json::Value::object();
    p.set("detail_id", d.id);
    p.set("zone", place_zone);
    if (chosen.empty()) {
      p.set("reason", last_error);
      emit(c, "biography_rejected", task.actor, std::move(p), kSrcSim);
      continue;
    }
    PlacedDetail pd;
    pd.zone = place_zone;
    pd.anchor = chosen;
    pd.detail_id = d.id;
    pd.label_ru = d.label_ru;
    pd.reason = kind + ":" + task.id;
    pd.t_ms = c.st.sim_ms;
    c.st.biography.push_back(pd);
    p.set("anchor", chosen);
    p.set("label_ru", d.label_ru);
    emit(c, "biography_detail", task.actor, std::move(p), kSrcSim);
  }
}

json::Value biography_json(const Core& c) {
  json::Value arr = json::Value::array();
  for (const auto& p : c.st.biography) {
    json::Value v = json::Value::object();
    v.set("zone", p.zone);
    v.set("anchor", p.anchor);
    v.set("detail_id", p.detail_id);
    v.set("label_ru", p.label_ru);
    arr.push(v);
  }
  return arr;
}

}  // namespace echo
