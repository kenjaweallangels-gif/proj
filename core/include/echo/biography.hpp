// Place biography (Документ §13, SPEC §6): every module keeps a journal of who worked there and what was done;
// visible details (repair tape, moved tool, note, old sealant, personal item, shared tool layout) are chosen
// from the journal and placed only at validated anchors — never on stand points, passages or controls that
// must stay clear. A failed validation keeps the zone unchanged.
#pragma once

#include <string>

#include "echo/state.hpp"

namespace echo {

void biography_record(Core& c, const std::string& zone, const std::string& kind, const Task& task, const std::string& tool);
// "" when `detail` may be placed at `anchor` in `zone`, otherwise the rejection code.
std::string biography_validate(const Core& c, const BioDetailDef& detail, const std::string& zone, const std::string& anchor);
json::Value biography_json(const Core& c);

}  // namespace echo
