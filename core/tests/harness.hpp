// Minimal self-registering test harness (no third-party dependencies; runs natively and under WASM/Node).
#pragma once

#include <string>
#include <vector>

namespace echo::test {

using TestFn = void (*)();

struct Registrar {
  Registrar(const char* suite, const char* name, TestFn fn);
};

bool check(bool ok, const char* expr, const char* file, int line, const std::string& note = "");
std::string to_text(const std::string& v);
std::string to_text(const char* v);
std::string to_text(double v);
std::string to_text(long long v);
std::string to_text(bool v);
template <typename T>
std::string to_text(const T& v) {
  return to_text(static_cast<long long>(v));
}

template <typename A, typename B>
bool check_eq(const A& a, const B& b, const char* ea, const char* eb, const char* file, int line) {
  const bool ok = a == b;
  return check(ok, (std::string(ea) + " == " + eb).c_str(), file, line, ok ? "" : "получено " + to_text(a) + ", ожидалось " + to_text(b));
}

const std::string& data_dir();
const std::string& schema_dir();
int run_all(int argc, char** argv);

}  // namespace echo::test

#define ECHO_CAT2(a, b) a##b
#define ECHO_CAT(a, b) ECHO_CAT2(a, b)
#define TEST(suite, name)                                                                     \
  static void ECHO_CAT(test_, ECHO_CAT(suite, ECHO_CAT(_, name)))();                           \
  static ::echo::test::Registrar ECHO_CAT(reg_, ECHO_CAT(suite, ECHO_CAT(_, name)))(#suite, #name, \
      &ECHO_CAT(test_, ECHO_CAT(suite, ECHO_CAT(_, name))));                                   \
  static void ECHO_CAT(test_, ECHO_CAT(suite, ECHO_CAT(_, name)))()

#define CHECK(cond) ::echo::test::check(static_cast<bool>(cond), #cond, __FILE__, __LINE__)
#define CHECK_MSG(cond, msg) ::echo::test::check(static_cast<bool>(cond), #cond, __FILE__, __LINE__, (msg))
#define CHECK_EQ(a, b) ::echo::test::check_eq((a), (b), #a, #b, __FILE__, __LINE__)
#define REQUIRE(cond)                                                       \
  do {                                                                      \
    if (!::echo::test::check(static_cast<bool>(cond), #cond, __FILE__, __LINE__)) return; \
  } while (0)
#define REQUIRE_MSG(cond, msg)                                                          \
  do {                                                                                  \
    if (!::echo::test::check(static_cast<bool>(cond), #cond, __FILE__, __LINE__, (msg))) return; \
  } while (0)
