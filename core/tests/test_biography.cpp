#include <cmath>
#include <string>

#include "data_files.hpp"
#include "echo/biography.hpp"
#include "echo/world.hpp"
#include "fixtures.hpp"
#include "harness.hpp"

using namespace echo::test;

namespace {

const echo::BioDetailDef& detail(World& w, const char* id) {
  for (const auto& d : w.core().data.biography.details) {
    if (d.id == id) return d;
  }
  return w.core().data.biography.details.front();
}

}  // namespace

TEST(biography, shared_tool_layout_after_mira_and_nika_work_together) {
  World w;
  w.run_scenario(300);
  const Value bio = w.state()["biography"];
  bool shared = false, tape = false, note = false;
  for (const auto& b : bio.items()) {
    if (b["detail_id"].str() == "shared_tool_layout") {
      shared = true;
      CHECK_EQ(b["zone"].str(), std::string("workshop"));
      CHECK_EQ(b["anchor"].str(), std::string("ws_wall_tools"));
    }
    if (b["detail_id"].str() == "repair_tape") {
      tape = true;
      CHECK_EQ(b["zone"].str(), std::string("niche_a"));
    }
    if (b["detail_id"].str() == "note") {
      note = true;
      CHECK_EQ(b["anchor"].str(), std::string("niche_b_rack"));  // Mira's own rack
    }
    CHECK(!b["label_ru"].str().empty());
  }
  CHECK(shared);
  CHECK(tape);
  CHECK(note);
  // The journal remembers who worked where.
  const auto& j = w.core().st.journals.at("niche_a");
  bool together = false;
  for (const auto& e : j) together = together || (e.kind == "work_together" && e.actor == "mira" && e.companion == "nika");
  CHECK(together);
}

TEST(biography, anchors_never_on_stand_points_passages_or_exits) {
  World w;
  Value layout;
  std::string err;
  REQUIRE(echo::host::parse_file(data_dir() + "/scene/d0_layout.json", layout, err));
  const auto& bio = w.core().data.biography;
  // Every listed anchor exists in the layout and in its zone's anchor list.
  for (const auto& [id, a] : bio.anchors) {
    CHECK_MSG(layout["anchors"].has(id), id);
    CHECK(echo::contains(w.core().data.zone(a.zone)->anchors, id));
  }
  // Every zone anchor of the world is classified (no silent gaps).
  for (const auto& z : w.core().data.zones) {
    for (const auto& a : z.anchors) CHECK_MSG(bio.anchors.count(a) == 1, a);
  }
  int valid_pairs = 0;
  for (const auto& d : bio.details) {
    for (const auto& [id, a] : bio.anchors) {
      if (!echo::biography_validate(w.core(), d, a.zone, id).empty()) continue;
      ++valid_pairs;
      CHECK(!echo::contains(bio.blocked_roles, a.role));
      CHECK(a.role != "passage" && a.role != "exterior");
      const Value& p = layout["anchors"][id];
      const Value& s = layout["zone_stand_points"][a.zone];
      const double dx = p.at(0).as_number() - s.at(0).as_number();
      const double dz = p.at(2).as_number() - s.at(2).as_number();
      CHECK_MSG(std::sqrt(dx * dx + dz * dz) >= bio.min_clearance_m, d.id + "@" + id);
    }
  }
  CHECK(valid_pairs > 10);
}

TEST(biography, invalid_placement_keeps_previous_state) {
  World w;
  const auto& tape = detail(w, "repair_tape");
  CHECK_EQ(echo::biography_validate(w.core(), tape, "niche_a", "niche_a_floor"), std::string("anchor_blocked_role:passage"));
  CHECK_EQ(echo::biography_validate(w.core(), tape, "niche_a", "ws_bench"), std::string("anchor_wrong_zone"));
  CHECK_EQ(echo::biography_validate(w.core(), tape, "sector_c", "sector_c_door"), std::string("anchor_blocked_role:passage"));
  CHECK_EQ(echo::biography_validate(w.core(), detail(w, "old_sealant"), "airlock_a", "airlock_panel"),
           std::string("role_not_allowed:control"));
  CHECK_EQ(echo::biography_validate(w.core(), tape, "niche_a", "nowhere"), std::string("anchor_unknown"));
  // A journal entry whose detail has no valid anchor leaves the zone untouched and says why.
  echo::Task t;
  t.id = "task-test";
  t.actor = "samir";
  t.action = "prepare_isolation";
  const auto before = w.core().st.biography.size();
  w.core().rt.out_events.clear();
  echo::biography_record(w.core(), "surface", "isolation", t, "");
  CHECK_EQ(w.core().st.biography.size(), before);
  bool rejected = false;
  for (const auto i : w.core().rt.out_events) rejected = rejected || w.core().st.events[i].type == "biography_rejected";
  CHECK(rejected);
  // Occupied anchors are never reused.
  echo::biography_record(w.core(), "lab_geo", "isolation", t, "");
  const auto placed = w.core().st.biography.size();
  REQUIRE(placed == before + 1);
  CHECK_EQ(echo::biography_validate(w.core(), detail(w, "personal_item"), "lab_geo", w.core().st.biography.back().anchor),
           std::string("anchor_occupied"));
}
