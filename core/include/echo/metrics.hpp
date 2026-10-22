// Metrics (Документ §2, §19; SPEC §9). Frame statistics come from samples the host measured; they are
// reported honestly (GPU "unavailable" without timestamp-query, never replaced by CPU time). AI metrics
// separate first-token and verified-answer latency, fallback reasons, invalid intents and admitted
// violations (target 0), template repetition, tokens and cost when the provider reports them.
#pragma once

#include <vector>

#include "echo/state.hpp"

namespace echo {

struct PercentileSet {
  double p50 = 0, p95 = 0, p99 = 0, max = 0, mean = 0;
  std::size_t count = 0;
};

// Nearest-rank percentiles (p = value at rank ceil(q*n)).
PercentileSet percentiles(std::vector<double> values);
json::Value percentiles_json(const PercentileSet& p);

json::Value frame_report(const Core& c);
json::Value ai_report(const Core& c);

}  // namespace echo
