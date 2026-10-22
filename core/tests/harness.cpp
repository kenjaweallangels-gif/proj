#include "harness.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>

#include "echo/json.hpp"

namespace echo::test {
namespace {

struct Entry {
  const char* suite;
  const char* name;
  TestFn fn;
};

std::vector<Entry>& registry() {
  static std::vector<Entry> r;
  return r;
}

int g_failures_in_test = 0;
std::string g_data_dir = ECHO_DATA_DIR;
std::string g_schema_dir = ECHO_SCHEMA_DIR;

}  // namespace

Registrar::Registrar(const char* suite, const char* name, TestFn fn) { registry().push_back({suite, name, fn}); }

bool check(bool ok, const char* expr, const char* file, int line, const std::string& note) {
  if (!ok) {
    ++g_failures_in_test;
    std::printf("    ПРОВАЛ %s:%d: %s%s%s\n", file, line, expr, note.empty() ? "" : " — ", note.c_str());
  }
  return ok;
}

std::string to_text(const std::string& v) { return "\"" + v + "\""; }
std::string to_text(const char* v) { return to_text(std::string(v)); }
std::string to_text(double v) { return json::format_number(v); }
std::string to_text(long long v) { return std::to_string(v); }
std::string to_text(bool v) { return v ? "true" : "false"; }

const std::string& data_dir() { return g_data_dir; }
const std::string& schema_dir() { return g_schema_dir; }

int run_all(int argc, char** argv) {
  std::string filter;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--data-dir") == 0 && i + 1 < argc) g_data_dir = argv[++i];
    else if (std::strcmp(argv[i], "--schema-dir") == 0 && i + 1 < argc) g_schema_dir = argv[++i];
    else if (std::strcmp(argv[i], "--filter") == 0 && i + 1 < argc) filter = argv[++i];
  }
  int passed = 0, failed = 0;
  std::vector<std::string> failed_names;
  const auto start = std::chrono::steady_clock::now();
  for (const auto& e : registry()) {
    const std::string full = std::string(e.suite) + "." + e.name;
    if (!filter.empty() && full.find(filter) == std::string::npos) continue;
    g_failures_in_test = 0;
    const auto t0 = std::chrono::steady_clock::now();
    e.fn();
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    if (g_failures_in_test == 0) {
      ++passed;
      std::printf("  ok    %-58s %8.1f мс\n", full.c_str(), ms);
    } else {
      ++failed;
      failed_names.push_back(full);
      std::printf("  FAIL  %-58s %8.1f мс\n", full.c_str(), ms);
    }
  }
  const double total = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  std::printf("\nИтого: %d тестов, %d пройдено, %d провалено (%.2f с)\n", passed + failed, passed, failed, total);
  for (const auto& n : failed_names) std::printf("  провален: %s\n", n.c_str());
  return failed == 0 ? 0 : 1;
}

}  // namespace echo::test
