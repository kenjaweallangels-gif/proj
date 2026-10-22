#include <string>

#include "echo/json.hpp"
#include "echo/util.hpp"
#include "harness.hpp"

using echo::json::ParseError;
using echo::json::ParseLimits;
using echo::json::Value;

namespace {

bool parses(const std::string& text, ParseError* err = nullptr, ParseLimits limits = {}) {
  Value v;
  ParseError local;
  return echo::json::parse(text, v, err != nullptr ? err : &local, limits);
}

std::string code_of(const std::string& text, ParseLimits limits = {}) {
  ParseError err;
  Value v;
  if (echo::json::parse(text, v, &err, limits)) return "ok";
  return err.code;
}

}  // namespace

TEST(json, roundtrip_basic) {
  Value v;
  ParseError err;
  REQUIRE(echo::json::parse(R"({"a":1,"b":[true,false,null],"c":"привет","d":-2.5e3,"e":{}})", v, &err));
  CHECK_EQ(v["a"].as_int(), 1);
  CHECK(v["b"].at(0).as_bool());
  CHECK(v["b"].at(2).is_null());
  CHECK_EQ(v["c"].as_string(), std::string("привет"));
  CHECK_EQ(v["d"].as_number(), -2500.0);
  CHECK_EQ(echo::json::dump(v), std::string(R"({"a":1,"b":[true,false,null],"c":"привет","d":-2500,"e":{}})"));
  Value again;
  REQUIRE(echo::json::parse(echo::json::dump(v), again, &err));
  CHECK(again == v);
}

TEST(json, duplicate_keys_rejected) {
  CHECK_EQ(code_of(R"({"a":1,"a":2})"), std::string("duplicate_key"));
  CHECK_EQ(code_of(R"({"x":{"b":1,"c":2,"b":3}})"), std::string("duplicate_key"));
  // Large objects switch to hashed detection; duplicates are still caught.
  std::string big = "{";
  for (int i = 0; i < 100; ++i) big += "\"k" + std::to_string(i) + "\":" + std::to_string(i) + ",";
  CHECK_EQ(code_of(big + "\"k50\":1}"), std::string("duplicate_key"));
  CHECK_EQ(code_of(big + "\"k100\":1}"), std::string("ok"));
}

TEST(json, depth_limit) {
  ParseLimits limits;
  limits.max_depth = 4;
  CHECK_EQ(code_of(R"({"a":{"b":{"c":{"d":1}}}})", limits), std::string("ok"));
  CHECK_EQ(code_of(R"({"a":{"b":{"c":{"d":{"e":1}}}}})", limits), std::string("depth_exceeded"));
  CHECK_EQ(code_of("[[[[[1]]]]]", limits), std::string("depth_exceeded"));
  std::string deep(200, '[');
  deep += std::string(200, ']');
  CHECK_EQ(code_of(deep), std::string("depth_exceeded"));  // default limit 64
}

TEST(json, byte_limit) {
  ParseLimits limits;
  limits.max_bytes = 16;
  CHECK_EQ(code_of(R"({"a":"12345678"})", limits), std::string("ok"));   // exactly 16 bytes
  CHECK_EQ(code_of(R"({"a":"123456789"})", limits), std::string("too_large"));
}

TEST(json, invalid_utf8_rejected) {
  CHECK_EQ(code_of(std::string("\"\xC0\x80\"")), std::string("invalid_utf8"));          // overlong NUL
  CHECK_EQ(code_of(std::string("\"\xED\xA0\x80\"")), std::string("invalid_utf8"));      // UTF-16 surrogate
  CHECK_EQ(code_of(std::string("\"\xE2\x82\"")), std::string("invalid_utf8"));          // truncated
  CHECK_EQ(code_of(std::string("\"\xF5\x80\x80\x80\"")), std::string("invalid_utf8"));  // > U+10FFFF
  CHECK_EQ(code_of(std::string("\"\xFF\"")), std::string("invalid_utf8"));
  CHECK(echo::json::valid_utf8("Мира — шлюз A"));
  CHECK(!echo::json::valid_utf8(std::string("\x80")));
}

TEST(json, unicode_escapes_and_surrogates) {
  Value v;
  ParseError err;
  REQUIRE(echo::json::parse(R"("Мира 😀")", v, &err));
  CHECK_EQ(v.as_string(), std::string("Мира \xF0\x9F\x98\x80"));
  CHECK_EQ(code_of(R"("\ud83d")"), std::string("lone_surrogate"));
  CHECK_EQ(code_of(R"("\ude00")"), std::string("lone_surrogate"));
  CHECK_EQ(code_of(R"("\ud83dA")"), std::string("lone_surrogate"));
  CHECK_EQ(code_of(R"("\x41")"), std::string("bad_escape"));
}

TEST(json, no_nan_inf_or_trailing_garbage) {
  for (const char* bad : {"NaN", "Infinity", "-Infinity", "01", "1.", ".5", "+1", "1 2", "{} x", "[1,]", "{\"a\":1,}", "tru",
                          "{'a':1}", "\xEF\xBB\xBF{}", "", "   "}) {
    CHECK_MSG(!parses(bad), std::string("должно отклоняться: ") + bad);
  }
  CHECK(parses("  {\"a\": [1, 2.5, -0, 1e3, 1E-3]}  "));
}

TEST(json, number_out_of_range) {
  CHECK_EQ(code_of("1e400"), std::string("number_out_of_range"));
  CHECK_EQ(code_of("-1e400"), std::string("number_out_of_range"));
  CHECK_EQ(code_of("1e-400"), std::string("ok"));
}

TEST(json, control_chars_rejected) {
  CHECK_EQ(code_of(std::string("\"a\nb\"")), std::string("control_char"));
  CHECK_EQ(code_of(std::string("\"a\tb\"")), std::string("control_char"));
  CHECK_EQ(code_of(R"("a\nb")"), std::string("ok"));
}

TEST(json, canonical_serialization_is_deterministic) {
  Value a = Value::object();
  a.set("b", 2);
  a.set("a", 1);
  Value b = Value::object();
  b.set("a", 1);
  b.set("b", 2);
  CHECK_EQ(echo::json::dump_canonical(a), echo::json::dump_canonical(b));
  CHECK(echo::json::dump(a) != echo::json::dump(b));
  CHECK_EQ(echo::json::format_number(0.1), std::string("0.1"));
  CHECK_EQ(echo::json::format_number(-0.0), std::string("0"));
  CHECK_EQ(echo::json::format_number(100), std::string("100"));
  CHECK_EQ(echo::json::format_number(1e21), std::string("1e+21"));
  CHECK_EQ(echo::json::format_number(0.30000000000000004), std::string("0.30000000000000004"));
  CHECK_EQ(echo::json::quote("a\"b\\c\n\x01"), std::string("\"a\\\"b\\\\c\\n\\u0001\""));
}

TEST(json, fnv1a64_known_vectors) {
  CHECK_EQ(echo::hex64(echo::fnv1a64("")), std::string("cbf29ce484222325"));
  CHECK_EQ(echo::hex64(echo::fnv1a64("a")), std::string("af63dc4c8601ec8c"));
  CHECK_EQ(echo::hex64(echo::fnv1a64("foobar")), std::string("85944171f73967e8"));
}

TEST(util, fold_tokens_and_estimate) {
  CHECK_EQ(echo::fold_ru("Проверь ДАТЧИК А, Ёлка!"), std::string("проверь датчик а, елка!"));
  const auto words = echo::words_ru(echo::fold_ru("Мира, проверь датчик A — срочно."));
  REQUIRE(words.size() == 5);
  CHECK_EQ(words[0], std::string("мира"));
  CHECK_EQ(words[3], std::string("a"));
  // ceil(code points / 3.2), as estimateTokens() in shared/prompt.ts.
  CHECK_EQ(echo::estimate_tokens(std::string(32, 'x')), 10);
  CHECK_EQ(echo::estimate_tokens(std::string(33, 'x')), 11);
  CHECK_EQ(echo::estimate_tokens("Мира"), 2);  // 4 code points, not 8 bytes
  CHECK_EQ(echo::utf8_truncate("абвгдеж", 4), std::string("абв…"));
}

TEST(util, rng_is_reproducible) {
  echo::Rng a(42), b(42), c(43);
  bool all_equal = true, any_diff = false;
  for (int i = 0; i < 100; ++i) {
    const auto x = a.next_u64();
    all_equal = all_equal && x == b.next_u64();
    any_diff = any_diff || x != c.next_u64();
  }
  CHECK(all_equal);
  CHECK(any_diff);
  echo::Rng d(7);
  for (int i = 0; i < 1000; ++i) {
    const double r = d.next_double();
    CHECK(r >= 0.0 && r < 1.0);
  }
}
