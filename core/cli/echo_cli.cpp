// echo_cli — native host for the Echo Runtime core.
//   echo_cli scenario --provider rules|script:<file.jsonl> [--data-dir data] [--seconds 300] [--seed N] [--json] [--check] [--verbose]
//   echo_cli bench-authority [--n 200000] [--data-dir data]
//   echo_cli stdio [--data-dir data]
// The scenario driver talks to the core ONLY through the JSON protocol (Engine::call, the same function behind
// echo_call), exactly like the web client and core/test_wasm_protocol.mjs do.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <iostream>
#include <string>
#include <vector>

#include "data_files.hpp"
#include "echo/authority.hpp"
#include "echo/context.hpp"
#include "echo/engine.hpp"
#include "echo/json.hpp"
#include "echo/util.hpp"
#include "echo/world.hpp"

namespace {

using echo::json::Value;

struct Options {
  std::string mode;
  std::string provider = "rules";
  std::string data_dir = ECHO_DATA_DIR;
  double seconds = 300;
  double seed = -1;
  long long n = 200000;
  bool json_out = false;
  bool check = false;
  bool verbose = false;
};

[[noreturn]] void usage(const char* msg) {
  std::fprintf(stderr, "%s\n\n", msg);
  std::fprintf(stderr,
               "Использование:\n"
               "  echo_cli scenario --provider rules|script:<file.jsonl> [--data-dir DIR] [--seconds 300] [--seed N] [--json] [--check] [--verbose]\n"
               "  echo_cli bench-authority [--n 200000] [--data-dir DIR]\n"
               "  echo_cli stdio [--data-dir DIR]\n");
  std::exit(2);
}

Options parse_args(int argc, char** argv) {
  Options o;
  if (argc < 2) usage("Не указан режим.");
  o.mode = argv[1];
  for (int i = 2; i < argc; ++i) {
    const std::string a = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) usage(("Нет значения для " + a).c_str());
      return argv[++i];
    };
    if (a == "--provider") o.provider = next();
    else if (a == "--data-dir") o.data_dir = next();
    else if (a == "--seconds") o.seconds = std::atof(next().c_str());
    else if (a == "--seed") o.seed = std::atof(next().c_str());
    else if (a == "--n") o.n = std::atoll(next().c_str());
    else if (a == "--json") o.json_out = true;
    else if (a == "--check") o.check = true;
    else if (a == "--verbose") o.verbose = true;
    else usage(("Неизвестный аргумент " + a).c_str());
  }
  return o;
}

// ---------- protocol client ----------
class Client {
 public:
  explicit Client(echo::Engine& e) : engine_(e) {}
  Value call(const Value& req) {
    const std::string out = engine_.call(echo::json::dump(req));
    Value v;
    echo::json::ParseError err;
    if (!echo::json::parse(out, v, &err)) {
      std::fprintf(stderr, "ядро вернуло неверный JSON: %s\n", err.message.c_str());
      std::exit(3);
    }
    ++calls_;
    return v;
  }
  long long calls() const { return calls_; }

 private:
  echo::Engine& engine_;
  long long calls_ = 0;
};

Value cmd(const char* name) {
  Value v = Value::object();
  v.set("cmd", name);
  return v;
}

// One scripted provider answer (JSONL line).
struct ScriptLine {
  Value v;
  bool used = false;
};

struct Delivery {
  double at_ms;
  Value result;
};

class ScenarioRunner {
 public:
  ScenarioRunner(Client& client, const Options& o) : c_(client), o_(o) {}

  bool load_script(const std::string& path) {
    std::string text;
    if (!echo::host::read_file(path, text)) {
      std::fprintf(stderr, "не удалось прочитать сценарий %s\n", path.c_str());
      return false;
    }
    std::size_t start = 0;
    int line_no = 0;
    while (start < text.size()) {
      std::size_t end = text.find('\n', start);
      if (end == std::string::npos) end = text.size();
      const std::string line = text.substr(start, end - start);
      start = end + 1;
      ++line_no;
      if (line.find_first_not_of(" \t\r") == std::string::npos || line[line.find_first_not_of(" \t\r")] == '#') continue;
      Value v;
      echo::json::ParseError err;
      if (!echo::json::parse(line, v, &err) || !v.is_object()) {
        std::fprintf(stderr, "%s:%d: неверная строка JSONL (%s)\n", path.c_str(), line_no, err.message.c_str());
        return false;
      }
      script_.push_back({v, false});
    }
    return true;
  }

  void log(double t_s, const std::string& line) {
    const std::string full = "[" + echo::format_seconds_ru(t_s) + "] " + line;
    transcript_.push_back(full);
    if (!o_.json_out) std::printf("%s\n", full.c_str());
  }

  bool interesting(const std::string& type) const {
    if (o_.verbose) return true;
    static const std::vector<std::string> kQuiet = {"request_queued", "request_dispatched", "verdict", "task_work_started",
                                                   "resource_consumed", "debug_patch", "sim_started", "plan_decided"};
    return !echo::contains(kQuiet, type);
  }

  void absorb(const Value& resp) {
    for (const auto& e : resp["events"].items()) {
      ++event_count_;
      const std::string type = e["type"].str();
      if (type == "plan_created") plans_to_accept_.push_back(e["payload"]["plan_id"].str());
      if (type == "invariant_violation") ++violations_;
      seen_types_.push_back(type);
      const bool instant_task = (type == "task_started" || type == "task_completed") && e["payload"]["instant"].as_bool();
      if (interesting(type) && (o_.verbose || !instant_task)) log(e["t"].as_number(), e["text_ru"].str());
    }
  }

  void print_verdict(const Value& v, double t_s) {
    std::string head = "Intent Authority " + v["task_id"].str() + " (" + v["actor"].str() + "): " + v["status"].str();
    if (v["fallback_used"].as_bool()) {
      head += v["status"].str() == "fallback" ? " (" + v["fallback_reason"].str() + ")" : " → fallback (" + v["fallback_reason"].str() + ")";
    }
    log(t_s, head);
    auto steps = [&](const Value& arr, const char* prefix) {
      for (const auto& s : arr.items()) {
        const char* mark = s["skipped"].as_bool() ? "·" : (s["ok"].as_bool() ? "✓" : "✗");
        const std::string line = std::string(prefix) + std::to_string(static_cast<int>(s["step"].as_number())) + " " +
                                 s["name"].str() + " " + mark + " " + s["detail"].str();
        transcript_.push_back(line);
        if (!o_.json_out) std::printf("%s\n", line.c_str());
      }
    };
    steps(v["steps"], "        ");
    if (v["fallback"].is_object()) {
      const std::string line = "      fallback (обычный игровой ИИ): " + echo::json::dump(v["fallback"]["proposal"]);
      transcript_.push_back(line);
      if (!o_.json_out) std::printf("%s\n", line.c_str());
      steps(v["fallback"]["steps"], "        ");
    }
  }

  void accept_plans() {
    while (!plans_to_accept_.empty()) {
      const std::string plan = plans_to_accept_.front();
      plans_to_accept_.pop_front();
      Value req = cmd("player_decide");
      req.set("plan_id", plan);
      req.set("decision", "accept");
      req.set("now_ms", now_ms_);
      const Value r = c_.call(req);
      if (!r["ok"].as_bool()) {
        log(sim_s_, "Алекс не смог принять план " + plan + ": " + r["error"]["message"].str());
        continue;
      }
      log(sim_s_, "Алекс принимает план " + plan + ".");
      ++accepted_plans_;
      print_verdict(r["verdict"], sim_s_);
      absorb(r);
    }
  }

  Value make_result(const std::string& task_id, const std::string& status, const std::string& text, double latency,
                    const Value& first_token, const std::string& provider, const std::string& model, double in_tok,
                    double out_tok, bool measured) {
    Value r = Value::object();
    r.set("task_id", task_id);
    r.set("status", status);
    r.set("proposal_text", status == "ok" ? Value(text) : Value());
    Value usage = Value::object();
    usage.set("input_tokens", in_tok);
    usage.set("output_tokens", out_tok);
    usage.set("measured", measured);
    r.set("usage", usage);
    Value lat = Value::object();
    lat.set("total", latency);
    lat.set("first_token", first_token);
    r.set("latency_ms", lat);
    r.set("provider", provider);
    r.set("model", model);
    r.set("finish_reason", status == "ok" ? "stop" : status);
    r.set("attempts", 1);
    return r;
  }

  void submit(const Value& result) {
    Value req = cmd("submit_result");
    req.set("result", result);
    req.set("now_ms", now_ms_);
    const Value r = c_.call(req);
    if (!r["ok"].as_bool()) {
      log(sim_s_, "submit_result отклонён протоколом: " + r["error"]["message"].str());
      return;
    }
    print_verdict(r["verdict"], sim_s_);
    absorb(r);
    accept_plans();
  }

  ScriptLine* next_script_line(const std::string& actor, const std::string& kind) {
    for (auto& l : script_) {
      if (l.used) continue;
      const std::string a = l.v["actor"].str();
      const std::string k = l.v["kind"].str();
      if ((!a.empty() && a != actor) || (!k.empty() && k != kind)) continue;
      return &l;
    }
    return nullptr;
  }

  void dispatch_rules_until_idle() {
    for (int guard = 0; guard < 16; ++guard) {
      Value d = cmd("dispatch");
      d.set("now_ms", now_ms_);
      d.set("backend", "rules");
      const Value r = c_.call(d);
      absorb(r);
      if (r["request"].is_null()) return;
      const std::string task_id = r["request"]["task_id"].str();
      Value rp = cmd("rules_propose");
      rp.set("task_id", task_id);
      const Value p = c_.call(rp);
      submit(make_result(task_id, "ok", p["proposal_text"].str(), 0, Value(), "rules", "utility-policy", 0, 0, false));
    }
  }

  void dispatch_script() {
    // Deliver results whose simulated latency has elapsed.
    for (auto it = deliveries_.begin(); it != deliveries_.end();) {
      if (it->at_ms <= now_ms_) {
        const Value result = it->result;
        it = deliveries_.erase(it);
        submit(result);
      } else {
        ++it;
      }
    }
    for (int guard = 0; guard < 8; ++guard) {
      Value d = cmd("dispatch");
      d.set("now_ms", now_ms_);
      d.set("backend", "cpu");
      const Value r = c_.call(d);
      absorb(r);
      if (r["request"].is_null()) return;  // busy (one generation at a time) or empty queue
      const Value& req = r["request"];
      const std::string task_id = req["task_id"].str();
      ScriptLine* line = next_script_line(req["actor_id"].str(), req["kind"].str());
      if (line == nullptr) {
        // Script exhausted: the scripted "model" answers with the rules policy, like a local backup.
        Value rp = cmd("rules_propose");
        rp.set("task_id", task_id);
        const Value p = c_.call(rp);
        submit(make_result(task_id, "ok", p["proposal_text"].str(), 0, Value(), "rules", "utility-policy", 0, 0, false));
        continue;
      }
      line->used = true;
      const Value& l = line->v;
      const double latency = l["latency_ms"].as_number(800);
      Value first = l.has("first_token_ms") ? l["first_token_ms"] : Value();
      Value result = make_result(task_id, l["status"].str("ok"), l["proposal_text"].str(), latency, first, "script",
                                 l["model"].str("scripted-model"), l["input_tokens"].as_number(0), l["output_tokens"].as_number(0),
                                 l.has("input_tokens"));
      log(sim_s_, "Скриптовый провайдер получил " + task_id + " (" + req["actor_id"].str() + "), ответ через " +
                      echo::format_number_ru(latency) + " мс.");
      deliveries_.push_back({now_ms_ + latency, result});
      if (l["duplicate"].as_bool()) deliveries_.push_back({now_ms_ + latency + 1, result});
      return;  // the cpu lane is now busy
    }
  }

  int run() {
    Value data;
    std::string error;
    if (!echo::host::load_data_dir(o_.data_dir, data, error)) {
      std::fprintf(stderr, "Ошибка данных: %s\n", error.c_str());
      return 1;
    }
    const bool script = echo::starts_with(o_.provider, "script:");
    if (!script && o_.provider != "rules") usage("--provider: rules или script:<file.jsonl>");
    if (script && !load_script(o_.provider.substr(7))) return 1;
    const Value init = c_.call(echo::host::init_request(data, o_.seed));
    if (!init["ok"].as_bool()) {
      std::fprintf(stderr, "init: %s\n", echo::json::dump(init["error"]).c_str());
      return 1;
    }
    if (!o_.json_out) {
      std::printf("ZERO ECHO · D0 · Echo Runtime %s, провайдер: %s, seed %s, %s с симуляции\n",
                  script ? "(скриптовая модель)" : "(обычный игровой ИИ, без модели)", o_.provider.c_str(),
                  echo::format_number_ru(init["seed"].as_number()).c_str(), echo::format_number_ru(o_.seconds).c_str());
      std::printf("Данные: %s · шаблонов речи: %s · событий директора: %s\n\n", init["data_hash"].str().c_str(),
                  echo::format_number_ru(init["summary"]["speech_templates"].as_number()).c_str(),
                  echo::format_number_ru(init["summary"]["director_events"].as_number()).c_str());
    }
    const double dt = 0.5;
    const long long steps = static_cast<long long>(std::llround(o_.seconds / dt));
    for (long long i = 0; i < steps; ++i) {
      now_ms_ += dt * 1000.0;
      Value t = cmd("tick");
      t.set("dt_s", dt);
      t.set("now_ms", now_ms_);
      const Value r = c_.call(t);
      sim_s_ = r["sim_time_s"].as_number();
      absorb(r);
      accept_plans();
      if (script) dispatch_script();
      else dispatch_rules_until_idle();
    }
    Value sreq = cmd("state");
    sreq.set("now_ms", now_ms_);
    const Value state = c_.call(sreq);
    const Value metrics = c_.call(cmd("metrics"));
    const std::string hash = state["hash"].str();
    std::vector<std::string> failures;
    if (o_.check) failures = check_outcome(state, metrics);
    if (o_.json_out) {
      Value out = Value::object();
      out.set("ok", failures.empty());
      out.set("hash", hash);
      out.set("sim_time_s", state["sim_time_s"]);
      out.set("revision", state["revision"]);
      out.set("events", static_cast<double>(event_count_));
      out.set("protocol_calls", static_cast<double>(c_.calls()));
      out.set("accepted_plans", static_cast<double>(accepted_plans_));
      out.set("emergency_lights", state["emergency_lights"]);
      out.set("biography", state["biography"]);
      out.set("director", state["director"]);
      out.set("ai", metrics["ai"]);
      out.set("failures", Value::string_array(failures));
      out.set("transcript", Value::string_array(transcript_));
      std::printf("%s\n", echo::json::dump(out).c_str());
    } else {
      std::printf("\n— Итог —\n");
      std::printf("Время симуляции: %s с, ревизия мира %s, событий в журнале %lld, вызовов протокола %lld\n",
                  echo::format_number_ru(state["sim_time_s"].as_number()).c_str(),
                  echo::format_number_ru(state["revision"].as_number()).c_str(), event_count_, c_.calls());
      std::printf("Аварийный свет: %s\n", state["emergency_lights"].as_bool() ? "включён" : "выключен");
      for (const auto& b : state["biography"].items()) {
        std::printf("Биография места: %s — %s (%s)\n", b["zone"].str().c_str(), b["label_ru"].str().c_str(), b["anchor"].str().c_str());
      }
      const Value& ai = metrics["ai"];
      std::printf("ИИ: запросов %s, вердикты %s, fallback %s, неверных намерений %s, допущенных нарушений %s, повторяемость реплик %s\n",
                  echo::format_number_ru(ai["requests"]["queued"].as_number()).c_str(), echo::json::dump(ai["verdicts"]).c_str(),
                  echo::json::dump(ai["fallback"]["by_reason"]).c_str(),
                  echo::format_number_ru(ai["invalid_intents"].as_number()).c_str(),
                  echo::format_number_ru(ai["violations_admitted"].as_number()).c_str(),
                  echo::fixed(ai["speech"]["repetition_rate"].as_number(), 3).c_str());
      std::printf("Хеш состояния: %s\n", hash.c_str());
      for (const auto& f : failures) std::printf("ПРОВЕРКА НЕ ПРОЙДЕНА: %s\n", f.c_str());
      if (o_.check && failures.empty()) std::printf("Проверки сценария пройдены.\n");
    }
    return failures.empty() ? 0 : 1;
  }

  std::vector<std::string> check_outcome(const Value& state, const Value& metrics) {
    std::vector<std::string> f;
    auto saw = [&](const char* type) { return echo::contains(seen_types_, type); };
    bool mira_plan = false, inspect_done = false, repaired = false;
    bool thomas_rest = false;
    for (const auto& line : transcript_) {
      if (line.find("Мира предлагает план") != std::string::npos && line.find("Ника") != std::string::npos) mira_plan = true;
      if (line.find("Томас предлагает план") != std::string::npos && line.find("Юн") != std::string::npos) thomas_rest = true;
      if (line.find("Мира завершает: осмотреть") != std::string::npos) inspect_done = true;
      if (line.find("откалиброван") != std::string::npos) repaired = true;
    }
    if (!saw("trigger_fired")) f.push_back("тревога давления не сработала");
    if (!mira_plan) f.push_back("Мира не предложила проверку с Никой");
    if (!thomas_rest) f.push_back("Томас не предложил отдых Юну");
    if (!inspect_done) f.push_back("осмотр датчика не завершён");
    if (o_.seconds >= 300 && !repaired) f.push_back("датчик не откалиброван");
    if (o_.seconds >= 300 && state["emergency_lights"].as_bool()) f.push_back("аварийный свет не погашен");
    if (metrics["ai"]["violations_admitted"].as_number() != 0 || violations_ != 0) f.push_back("допущены нарушения инвариантов");
    if (state["hash"].str().empty()) f.push_back("нет хеша состояния");
    return f;
  }

 private:
  Client& c_;
  const Options& o_;
  double now_ms_ = 0;
  double sim_s_ = 0;
  std::vector<ScriptLine> script_;
  std::vector<Delivery> deliveries_;
  std::deque<std::string> plans_to_accept_;
  std::vector<std::string> transcript_;
  std::vector<std::string> seen_types_;
  long long event_count_ = 0;
  long long accepted_plans_ = 0;
  long long violations_ = 0;
};

int run_scenario(const Options& o) {
  echo::Engine engine;
  Client client(engine);
  ScenarioRunner runner(client, o);
  return runner.run();
}

// ---------- bench-authority ----------
int run_bench(const Options& o) {
  Value data;
  std::string error;
  if (!echo::host::load_data_dir(o.data_dir, data, error)) {
    std::fprintf(stderr, "Ошибка данных: %s\n", error.c_str());
    return 1;
  }
  echo::Engine engine;
  Client client(engine);
  client.call(echo::host::init_request(data));
  double now = 0;
  for (int i = 0; i < 42; ++i) {  // up to the pressure alarm at t=20 s
    now += 500;
    Value t = cmd("tick");
    t.set("dt_s", 0.5);
    t.set("now_ms", now);
    client.call(t);
  }
  // Find Mira's initiative and dispatch it to get a real GatewayRequest.
  Value request;
  for (int guard = 0; guard < 8 && request.is_null(); ++guard) {
    Value d = cmd("dispatch");
    d.set("now_ms", now);
    d.set("backend", "rules");
    const Value r = client.call(d);
    if (r["request"].is_null()) break;
    if (r["request"]["actor_id"].str() == "mira") request = r["request"];
    else {
      Value rp = cmd("rules_propose");
      rp.set("task_id", r["request"]["task_id"].str());
      const Value p = client.call(rp);
      Value s = cmd("submit_result");
      Value res = Value::object();
      res.set("task_id", r["request"]["task_id"].str());
      res.set("status", "ok");
      res.set("proposal_text", p["proposal_text"].str());
      Value usage = Value::object();
      usage.set("input_tokens", 0);
      usage.set("output_tokens", 0);
      usage.set("measured", false);
      res.set("usage", usage);
      Value lat = Value::object();
      lat.set("total", 0);
      res.set("latency_ms", lat);
      res.set("provider", "rules");
      res.set("model", "utility-policy");
      res.set("finish_reason", "stop");
      res.set("attempts", 1);
      s.set("result", res);
      s.set("now_ms", now);
      client.call(s);
    }
  }
  if (request.is_null()) {
    std::fprintf(stderr, "не удалось получить запрос Миры для замера\n");
    return 1;
  }
  echo::Core& core = engine.core();
  const echo::Offer offer = echo::offer_from_request(request);
  const std::string good = "{\"action\":\"inspect\",\"target_id\":\"sensor_a\",\"companion_id\":\"nika\",\"fact_ids\":[\"pressure_disagreement\"],\"style\":\"concerned\",\"gesture\":\"point_at_target\"}";
  const std::string bad = "{\"action\":\"inspect\",\"target_id\":\"sensor_a\",\"style\":\"concerned\",\"world_revision\":1}";
  echo::EvalInput in;
  in.task_id = request["task_id"].str();
  in.actor = "mira";
  in.offer = &offer;
  in.world_revision = request["world_revision"].as_int();
  in.is_fallback = true;  // the record check is a map lookup; the dry run skips commit
  in.dry_run = true;
  in.now_ms = now;
  auto measure = [&](const std::string& text, long long n, const char* expect) {
    in.text = text;
    long long ok = 0;
    const auto t0 = std::chrono::steady_clock::now();
    for (long long i = 0; i < n; ++i) {
      const echo::Evaluation ev = echo::evaluate(core, in);
      if (ev.status == expect) ++ok;
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double s = std::chrono::duration<double>(t1 - t0).count();
    return std::make_pair(s, ok);
  };
  const long long n = std::max<long long>(1, o.n);
  const auto [s_good, ok_good] = measure(good, n, "accepted");
  const auto [s_bad, ok_bad] = measure(bad, n, "rejected");
  std::printf("bench-authority — CPU-замер на этой машине (не GPU, не FPS, не качество NPC)\n");
  std::printf("Шаги 1–4 Intent Authority (строгий разбор JSON ≤2048 байт, pending, ревизия, все игровые проверки), без фиксации.\n");
  std::printf("  допустимое предложение:  %lld проверок за %.3f с → %.0f проверок/с (%.2f мкс/шт), принято %lld/%lld\n", n, s_good,
              static_cast<double>(n) / s_good, s_good * 1e6 / static_cast<double>(n), ok_good, n);
  std::printf("  с полем хоста (reject):  %lld проверок за %.3f с → %.0f проверок/с (%.2f мкс/шт), отклонено %lld/%lld\n", n, s_bad,
              static_cast<double>(n) / s_bad, s_bad * 1e6 / static_cast<double>(n), ok_bad, n);
  return (ok_good == n && ok_bad == n) ? 0 : 1;
}

// ---------- stdio ----------
int run_stdio(const Options& o) {
  echo::Engine engine;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.find_first_not_of(" \t\r") == std::string::npos) continue;
    // Host convenience: {"cmd":"init","data_dir":"..."} loads the data directory on this side.
    Value req;
    echo::json::ParseError err;
    if (echo::json::parse(line, req, &err) && req.is_object() && req["cmd"].str() == "init" && req["data"].is_null()) {
      Value data;
      std::string error;
      const std::string dir = req["data_dir"].str(o.data_dir);
      if (!echo::host::load_data_dir(dir, data, error)) {
        std::printf("%s\n", echo::json::dump(echo::error_response("data_invalid", error)).c_str());
        std::fflush(stdout);
        continue;
      }
      req.erase("data_dir");
      req.set("data", data);
      line = echo::json::dump(req);
    }
    std::printf("%s\n", engine.call(line).c_str());
    std::fflush(stdout);
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const Options o = parse_args(argc, argv);
  if (o.mode == "scenario") return run_scenario(o);
  if (o.mode == "bench-authority") return run_bench(o);
  if (o.mode == "stdio") return run_stdio(o);
  usage(("Неизвестный режим " + o.mode).c_str());
}
