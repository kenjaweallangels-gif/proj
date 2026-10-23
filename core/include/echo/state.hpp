// Mutable runtime state. `State` is the game state proper (saved, hashed, replayed deterministically);
// `Runtime` holds host-facing transient data (AI settings, GPU gate, metrics, per-command event buffer)
// that is neither part of the game nor of the state hash.
#pragma once

#include <cstdint>
#include <deque>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "echo/data.hpp"
#include "echo/json.hpp"
#include "echo/util.hpp"

namespace echo {

// A model (or rules) proposal after strict parsing: only ids the host offered can appear here.
struct Proposal {
  std::string action, target, companion, style, gesture;
  std::vector<std::string> fact_ids;
  bool empty() const { return action.empty(); }
};

// Why a request exists; drives ContextBuilder text and the ordinary game AI (UtilityPolicy).
struct Situation {
  std::string origin;      // player_say | player_order | trigger | observation | director | followup | ambient | plan_expired | emergency
  std::string text_ru;     // situation seed in Russian
  std::string utterance;   // player text for direct replies
  std::string say_intent;  // classified intent of the utterance (inspect, rest, report, refuse_secret, energy, ...)
  std::string focus;       // entity the situation is about (sensor_a, sector_c, yun, ...)
  std::string trigger_id;  // scripted trigger / director event / observation key
  bool has_order = false;
  Proposal order;          // what the player ordered (player_order)
  bool no_approval = false;  // after the player rejected a plan: choose only actions that need no approval
};

struct DoorState {
  std::string state;  // open | closed | sealed
};

struct ResourceState {
  double amount = 0.0;
  double reserved = 0.0;  // soft (plans) + hard (tasks) reservations
};

struct ItemState {
  std::string zone;
  std::string lock;  // plan or task id holding the tool; empty when free
  bool preserved = false;
  bool ready = false;
};

struct SensorState {
  Reading truth;    // physical layer: never touched by the director
  Reading reading;  // instrument layer
  std::string fault;
  std::string distortion;            // director event id while an instrument distortion is active
  std::int64_t distortion_until_ms = 0;
};

struct Travel {
  std::vector<std::string> path;   // zones, path[0] == start zone
  std::vector<std::string> doors;  // doors crossed, path.size() - 1 entries
  std::size_t hop = 0;             // index of the zone we are leaving
  std::int64_t hop_elapsed_ms = 0;
  std::int64_t hop_total_ms = 0;
  bool arrived() const { return hop + 1 >= path.size(); }
};

struct ActorState {
  std::string id;
  std::string zone, home_zone;
  std::string task_id;     // active world task (executor or companion)
  std::string plan_id;     // plan awaiting the player in which this actor is the proposer
  std::string soft_plan;   // plan in which this actor is the proposed companion (advisory reservation)
  std::string activity = "idle";
  double fatigue = 0.0, health = 1.0, trust_player = 0.5;
  std::map<std::string, double> relationships;
  std::map<std::string, std::int64_t> cooldown_until_ms;  // action -> sim ms
  std::string gesture = "none", style = "neutral";
  std::int64_t talking_until_ms = 0;
  bool debug_busy = false;
  Travel walk;  // free movement (e.g. returning home) outside of tasks
};

struct Task {
  std::string id, action, actor, companion, target, proposer, origin, source;
  std::string state = "active";  // active | done | cancelled | failed
  std::string phase = "travel";  // travel | work | done
  std::string work_zone;
  Travel travel, companion_travel;
  std::int64_t work_ms = 0, work_total_ms = 0;
  std::int64_t started_ms = 0, finished_ms = 0;
  std::vector<std::string> fact_ids;
  std::vector<std::pair<std::string, double>> reserved;  // resources reserved, consumed at completion
  std::vector<std::string> tools;
  std::string style, gesture;

  double progress() const;
};

struct Plan {
  std::string id, actor, request_id, source;
  std::string state = "awaiting_player";  // awaiting_player | accepted | rejected | replanned | expired | cancelled
  Proposal proposal;
  Situation situation;
  bool from_order = false;
  std::int64_t created_ms = 0, expires_ms = 0;
  std::vector<std::pair<std::string, double>> reserved;
  std::vector<std::string> tools;
  std::string world_task_id;
};

struct QueueItem {
  std::string task_id, actor, kind;
  int priority = 0;
  double created_ms = 0, deadline_ms = 0;
  std::int64_t revision = 0;
  Situation situation;
};

// A dispatched request awaiting a provider result (or already resolved; kept for idempotency).
struct PendingRequest {
  std::string task_id, actor, kind, backend;
  std::string state = "pending";  // pending | executed | fallback | expired | cancelled
  std::string resolution;         // final verdict status or fallback reason
  double created_ms = 0, dispatched_ms = 0, deadline_ms = 0;
  std::int64_t world_revision = 0;
  Situation situation;
  json::Value request;  // the GatewayRequest exactly as handed to the provider
};

struct Event {
  std::int64_t seq = 0;
  std::int64_t t_ms = 0;
  std::int64_t rev = 0;
  std::string type, actor, source;  // source: sim | player | agent_accepted | director | fallback
  json::Value payload;
};

struct MemoryEntry {
  std::string id, kind, text_ru, source;  // kind: fact | opinion | promise | episode
  std::string fact_id;                    // for fact entries linked to the fact registry
  double confidence = -1.0;               // < 0: not applicable (facts, episodes)
  double importance = 0.5;
  std::int64_t time_ms = 0;
  std::vector<std::string> tags;
};

struct KnownFact {
  std::string fact, source;
  std::int64_t time_ms = 0;
};

struct ActorMemory {
  std::vector<MemoryEntry> entries;
  std::vector<KnownFact> facts;
};

struct DirectorState {
  double tension = 0.0;
  std::string last_event;
  std::int64_t last_event_ms = -1;
  std::int64_t next_eval_ms = 0;
  std::int64_t calm_until_ms = 0;
  std::int64_t last_echo_ms = 0;
  std::map<std::string, std::int64_t> cooldown_until_ms;
  std::map<std::string, std::int64_t> last_fired_ms;
  std::vector<std::string> fired;  // chronological event ids
};

struct JournalEntry {
  std::int64_t t_ms = 0;
  std::string kind, actor, companion, task_id, action, detail;
};

struct PlacedDetail {
  std::string zone, anchor, detail_id, label_ru, reason;
  std::int64_t t_ms = 0;
};

struct AcceptedIntent {
  std::string task_id, actor, source, provider, model, proposal_text, status;
  std::int64_t t_ms = 0;
};

struct State {
  std::uint64_t seed = 0;
  Rng rng;
  std::int64_t sim_ms = 0;
  double last_now_ms = 0;  // last host monotonic time seen (for gate ages); not semantic
  std::int64_t revision = 0;
  std::map<std::string, std::int64_t> entity_rev;

  std::map<std::string, DoorState> doors;
  std::map<std::string, ResourceState> resources;
  std::map<std::string, ItemState> items;
  std::map<std::string, SensorState> sensors;
  std::set<std::string> sealed_zones;
  std::map<std::string, ActorState> actors;
  std::map<std::string, Task> tasks;
  std::map<std::string, Plan> plans;
  std::vector<QueueItem> queue;
  std::map<std::string, PendingRequest> requests;
  std::vector<Event> events;
  std::map<std::string, ActorMemory> memory;
  DirectorState director;
  std::map<std::string, std::vector<JournalEntry>> journals;
  std::vector<PlacedDetail> biography;
  std::map<std::string, std::deque<std::string>> speech_recent;  // actor -> recent template ids
  std::vector<AcceptedIntent> accepted;
  std::set<std::string> triggers_fired;
  std::map<std::string, std::int64_t> observe_until_ms;  // observation key -> suppressed until (sim ms)
  bool emergency = false;
  bool emergency_lights = false;
  std::string emergency_sensor;
  std::int64_t next_ambient_ms = 0;

  std::uint64_t next_req = 1, next_plan = 1, next_task = 1, next_seq = 1, next_mem = 1;
};

// ---------- transient host-facing runtime ----------
struct AiConfig {
  std::string mode = "smooth";  // smooth | live | extended
  bool gpu_enabled = false;
  bool calibrated = false;
  std::string privacy_profile = "offline";  // offline | hybrid | online
  int cpu_cores = 0;                        // 0 = unknown (host did not report)
  double deadline_scale = 1.0;              // host multiplier for model deadlines; 1 = Документ §11 targets
};

struct FrameSampleRec {
  float interval_ms = 0, cpu_ms = 0, gpu_ms = -1;  // gpu < 0: unavailable
};

struct GateState {
  std::deque<FrameSampleRec> window;  // newest samples covering ~stable_window_s
  bool have_stats = false;
  double last_stats_ms = 0;
  bool good_streak = false;   // frames currently within thresholds
  double good_since_ms = 0;   // start of the current good streak (host ms; may be negative near t=0)
  double cooldown_until_ms = 0;
  double last_bad_ms = -1e18;
  double vram_free_gib = -1;  // < 0: unknown
  bool degraded = false;
};

struct LatencySet {
  std::vector<double> values;
};

struct AiMetrics {
  std::uint64_t queued = 0, dispatched = 0, replaced = 0, evicted = 0;
  std::map<std::string, std::uint64_t> by_backend, by_kind, verdicts, fallback_reasons;
  std::uint64_t invalid_intents = 0, violations_admitted = 0, fallbacks = 0, results = 0;
  LatencySet first_token, ready, provider_total, queue_wait;
  std::uint64_t speech_lines = 0, speech_repeated = 0;
  std::map<std::string, std::uint64_t> speech_by_kind;
  std::uint64_t input_tokens = 0, output_tokens = 0, cached_tokens = 0, reasoning_tokens = 0;
  std::uint64_t measured_results = 0, estimated_results = 0, results_with_cost = 0;
  double cost_usd = 0.0;
  bool cost_fictional = false;
  std::set<std::string> models_seen;
  std::vector<std::string> violation_log;
};

struct FrameStore {
  std::vector<FrameSampleRec> warm, cold;
};

// Incremental digest of the append-only event log (hashing stays O(new events)); reset on init/load.
struct EventDigest {
  std::size_t count = 0;
  std::uint64_t value = 0xcbf29ce484222325ULL;
};

struct Runtime {
  AiConfig config;
  mutable EventDigest event_digest;
  GateState gate;
  AiMetrics ai;
  FrameStore frames;
  std::vector<std::size_t> out_events;  // indices into State::events produced by the current command
};

struct Core {
  StaticData data;
  State st;
  Runtime rt;
};

}  // namespace echo
