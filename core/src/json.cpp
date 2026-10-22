#include "echo/json.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <unordered_set>

namespace echo::json {
namespace {

const Value kNull;
const std::string kEmptyString;
const std::vector<Value> kEmptyArray;
const std::vector<Member> kEmptyObject;

constexpr double kMaxExactInteger = 9007199254740992.0;  // 2^53
constexpr std::size_t kLinearKeyScan = 16;

// Length of the valid UTF-8 sequence starting at s[i], or 0 when invalid.
std::size_t utf8_sequence_length(std::string_view s, std::size_t i) noexcept {
  const auto byte = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
  const unsigned char c = byte(i);
  if (c < 0x80) return 1;
  const std::size_t n = s.size();
  auto cont = [&](std::size_t k, unsigned char lo = 0x80, unsigned char hi = 0xBF) {
    return k < n && byte(k) >= lo && byte(k) <= hi;
  };
  if (c >= 0xC2 && c <= 0xDF) return cont(i + 1) ? 2 : 0;
  if (c == 0xE0) return cont(i + 1, 0xA0, 0xBF) && cont(i + 2) ? 3 : 0;
  if ((c >= 0xE1 && c <= 0xEC) || c == 0xEE || c == 0xEF) return cont(i + 1) && cont(i + 2) ? 3 : 0;
  if (c == 0xED) return cont(i + 1, 0x80, 0x9F) && cont(i + 2) ? 3 : 0;  // no UTF-16 surrogates
  if (c == 0xF0) return cont(i + 1, 0x90, 0xBF) && cont(i + 2) && cont(i + 3) ? 4 : 0;
  if (c >= 0xF1 && c <= 0xF3) return cont(i + 1) && cont(i + 2) && cont(i + 3) ? 4 : 0;
  if (c == 0xF4) return cont(i + 1, 0x80, 0x8F) && cont(i + 2) && cont(i + 3) ? 4 : 0;
  return 0;
}

void append_utf8(std::string& out, std::uint32_t cp) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

class Parser {
 public:
  Parser(std::string_view text, const ParseLimits& limits, ParseError* err)
      : s_(text), limits_(limits), err_(err) {}

  bool run(Value& out) {
    if (s_.size() > limits_.max_bytes) {
      return fail("too_large", "document exceeds " + std::to_string(limits_.max_bytes) + " bytes");
    }
    skip_ws();
    if (pos_ >= s_.size()) return fail("empty", "empty document");
    if (!parse_value(out, 0)) return false;
    skip_ws();
    if (pos_ != s_.size()) return fail("trailing_garbage", "unexpected data after the JSON value");
    return true;
  }

 private:
  bool fail(const char* code, std::string message) {
    if (err_ != nullptr) {
      err_->code = code;
      err_->message = std::move(message);
      err_->offset = pos_;
    }
    return false;
  }

  void skip_ws() {
    while (pos_ < s_.size()) {
      const char c = s_[pos_];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++pos_;
      } else {
        break;
      }
    }
  }

  bool literal(std::string_view word) {
    if (s_.substr(pos_, word.size()) != word) return fail("unexpected_char", "invalid literal");
    pos_ += word.size();
    return true;
  }

  bool parse_value(Value& out, int depth) {
    if (pos_ >= s_.size()) return fail("unexpected_end", "unexpected end of input");
    const char c = s_[pos_];
    switch (c) {
      case '{': return parse_object(out, depth + 1);
      case '[': return parse_array(out, depth + 1);
      case '"': {
        std::string str;
        if (!parse_string(str)) return false;
        out = Value(std::move(str));
        return true;
      }
      case 't': if (!literal("true")) return false; out = Value(true); return true;
      case 'f': if (!literal("false")) return false; out = Value(false); return true;
      case 'n': if (!literal("null")) return false; out = Value(); return true;
      default:
        if (c == '-' || (c >= '0' && c <= '9')) return parse_number(out);
        return fail("unexpected_char", std::string("unexpected character '") + (c >= 0x20 && c < 0x7F ? std::string(1, c) : std::string("?")) + "'");
    }
  }

  bool enter(int depth) {
    if (depth > limits_.max_depth) {
      return fail("depth_exceeded", "nesting depth exceeds " + std::to_string(limits_.max_depth));
    }
    return true;
  }

  bool parse_object(Value& out, int depth) {
    if (!enter(depth)) return false;
    ++pos_;  // '{'
    out = Value::object();
    skip_ws();
    if (pos_ < s_.size() && s_[pos_] == '}') {
      ++pos_;
      return true;
    }
    // Small objects use a linear scan; large ones switch to a hash set so hostile input stays O(n).
    std::unordered_set<std::string> seen;
    for (;;) {
      skip_ws();
      if (pos_ >= s_.size() || s_[pos_] != '"') return fail("expected_key", "expected a string key");
      std::string key;
      if (!parse_string(key)) return false;
      bool duplicate = false;
      if (out.size() < kLinearKeyScan) {
        duplicate = out.find(key) != nullptr;
      } else {
        if (seen.empty()) {
          for (const auto& m : out.members()) seen.insert(m.key);
        }
        duplicate = !seen.insert(key).second;
      }
      if (duplicate) return fail("duplicate_key", "duplicate key \"" + key + "\"");
      skip_ws();
      if (pos_ >= s_.size() || s_[pos_] != ':') return fail("expected_colon", "expected ':'");
      ++pos_;
      skip_ws();
      Value v;
      if (!parse_value(v, depth)) return false;
      out.append_member(std::move(key), std::move(v));
      skip_ws();
      if (pos_ >= s_.size()) return fail("unexpected_end", "unterminated object");
      if (s_[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (s_[pos_] == '}') {
        ++pos_;
        return true;
      }
      return fail("unexpected_char", "expected ',' or '}'");
    }
  }

  bool parse_array(Value& out, int depth) {
    if (!enter(depth)) return false;
    ++pos_;  // '['
    out = Value::array();
    skip_ws();
    if (pos_ < s_.size() && s_[pos_] == ']') {
      ++pos_;
      return true;
    }
    for (;;) {
      skip_ws();
      Value v;
      if (!parse_value(v, depth)) return false;
      out.push(std::move(v));
      skip_ws();
      if (pos_ >= s_.size()) return fail("unexpected_end", "unterminated array");
      if (s_[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (s_[pos_] == ']') {
        ++pos_;
        return true;
      }
      return fail("unexpected_char", "expected ',' or ']'");
    }
  }

  bool hex4(std::uint32_t& out) {
    if (pos_ + 4 > s_.size()) return fail("bad_escape", "truncated \\u escape");
    std::uint32_t v = 0;
    for (int i = 0; i < 4; ++i) {
      const char h = s_[pos_++];
      v <<= 4;
      if (h >= '0' && h <= '9') v |= static_cast<std::uint32_t>(h - '0');
      else if (h >= 'a' && h <= 'f') v |= static_cast<std::uint32_t>(h - 'a' + 10);
      else if (h >= 'A' && h <= 'F') v |= static_cast<std::uint32_t>(h - 'A' + 10);
      else return fail("bad_escape", "invalid hex digit in \\u escape");
    }
    out = v;
    return true;
  }

  bool parse_string(std::string& out) {
    ++pos_;  // opening quote
    for (;;) {
      if (pos_ >= s_.size()) return fail("unexpected_end", "unterminated string");
      const unsigned char c = static_cast<unsigned char>(s_[pos_]);
      if (c == '"') {
        ++pos_;
        return true;
      }
      if (c < 0x20) return fail("control_char", "unescaped control character in string");
      if (c == '\\') {
        ++pos_;
        if (pos_ >= s_.size()) return fail("unexpected_end", "unterminated escape");
        const char e = s_[pos_++];
        switch (e) {
          case '"': out.push_back('"'); break;
          case '\\': out.push_back('\\'); break;
          case '/': out.push_back('/'); break;
          case 'b': out.push_back('\b'); break;
          case 'f': out.push_back('\f'); break;
          case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break;
          case 't': out.push_back('\t'); break;
          case 'u': {
            std::uint32_t cp = 0;
            if (!hex4(cp)) return false;
            if (cp >= 0xDC00 && cp <= 0xDFFF) return fail("lone_surrogate", "unpaired low surrogate");
            if (cp >= 0xD800 && cp <= 0xDBFF) {
              if (pos_ + 2 > s_.size() || s_[pos_] != '\\' || s_[pos_ + 1] != 'u') {
                return fail("lone_surrogate", "unpaired high surrogate");
              }
              pos_ += 2;
              std::uint32_t lo = 0;
              if (!hex4(lo)) return false;
              if (lo < 0xDC00 || lo > 0xDFFF) return fail("lone_surrogate", "invalid surrogate pair");
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            }
            append_utf8(out, cp);
            break;
          }
          default: return fail("bad_escape", "invalid escape sequence");
        }
        continue;
      }
      const std::size_t len = utf8_sequence_length(s_, pos_);
      if (len == 0) return fail("invalid_utf8", "invalid UTF-8 sequence in string");
      out.append(s_.data() + pos_, len);
      pos_ += len;
    }
  }

  bool parse_number(Value& out) {
    const std::size_t start = pos_;
    auto digit = [&](std::size_t k) { return k < s_.size() && s_[k] >= '0' && s_[k] <= '9'; };
    if (s_[pos_] == '-') ++pos_;
    if (!digit(pos_)) return fail("bad_number", "expected digit");
    if (s_[pos_] == '0') {
      ++pos_;
      if (digit(pos_)) return fail("bad_number", "leading zeros are not allowed");
    } else {
      while (digit(pos_)) ++pos_;
    }
    if (pos_ < s_.size() && s_[pos_] == '.') {
      ++pos_;
      if (!digit(pos_)) return fail("bad_number", "expected digit after '.'");
      while (digit(pos_)) ++pos_;
    }
    if (pos_ < s_.size() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
      ++pos_;
      if (pos_ < s_.size() && (s_[pos_] == '+' || s_[pos_] == '-')) ++pos_;
      if (!digit(pos_)) return fail("bad_number", "expected exponent digits");
      while (digit(pos_)) ++pos_;
    }
    // Grammar validated above; strtod (C locale) gives the correctly rounded value on glibc and musl.
    const std::string token(s_.substr(start, pos_ - start));
    char* end = nullptr;
    const double v = std::strtod(token.c_str(), &end);
    if (end != token.c_str() + token.size()) return fail("bad_number", "malformed number");
    if (!std::isfinite(v)) return fail("number_out_of_range", "number is not finite");
    out = Value(v);
    return true;
  }

  std::string_view s_;
  const ParseLimits& limits_;
  ParseError* err_;
  std::size_t pos_ = 0;
};

void dump_string(std::string& out, std::string_view s) {
  static const char* kHex = "0123456789abcdef";
  out.push_back('"');
  for (const char ch : s) {
    const auto c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out.push_back(kHex[c >> 4]);
          out.push_back(kHex[c & 0xF]);
        } else {
          out.push_back(ch);
        }
    }
  }
  out.push_back('"');
}

}  // namespace

Value Value::array() {
  Value v;
  v.type_ = Type::Array;
  return v;
}

Value Value::object() {
  Value v;
  v.type_ = Type::Object;
  return v;
}

Value Value::string_array(const std::vector<std::string>& items) {
  Value v = array();
  v.arr_.reserve(items.size());
  for (const auto& s : items) v.arr_.emplace_back(s);
  return v;
}

bool Value::is_integer() const noexcept {
  return type_ == Type::Number && std::trunc(num_) == num_ && std::fabs(num_) <= kMaxExactInteger;
}

std::int64_t Value::as_int(std::int64_t fallback) const noexcept {
  if (type_ != Type::Number || !(std::fabs(num_) <= kMaxExactInteger)) return fallback;
  return static_cast<std::int64_t>(num_);
}

const std::string& Value::as_string() const noexcept { return type_ == Type::String ? str_ : kEmptyString; }

const std::vector<Value>& Value::items() const noexcept { return type_ == Type::Array ? arr_ : kEmptyArray; }

std::vector<Value>& Value::items_mut() {
  if (type_ != Type::Array) *this = array();
  return arr_;
}

Value& Value::push(Value v) {
  if (type_ != Type::Array) *this = array();
  arr_.push_back(std::move(v));
  return arr_.back();
}

std::size_t Value::size() const noexcept {
  if (type_ == Type::Array) return arr_.size();
  if (type_ == Type::Object) return obj_.size();
  return 0;
}

const Value& Value::at(std::size_t i) const noexcept {
  return (type_ == Type::Array && i < arr_.size()) ? arr_[i] : kNull;
}

const std::vector<Member>& Value::members() const noexcept { return type_ == Type::Object ? obj_ : kEmptyObject; }

const Value* Value::find(std::string_view key) const noexcept {
  if (type_ != Type::Object) return nullptr;
  for (const auto& m : obj_) {
    if (m.key == key) return &m.value;
  }
  return nullptr;
}

Value* Value::find_mut(std::string_view key) noexcept {
  if (type_ != Type::Object) return nullptr;
  for (auto& m : obj_) {
    if (m.key == key) return &m.value;
  }
  return nullptr;
}

const Value& Value::operator[](std::string_view key) const noexcept {
  const Value* v = find(key);
  return v != nullptr ? *v : kNull;
}

Value& Value::set(std::string_view key, Value v) {
  if (type_ != Type::Object) *this = object();
  for (auto& m : obj_) {
    if (m.key == key) {
      m.value = std::move(v);
      return m.value;
    }
  }
  obj_.push_back(Member{std::string(key), std::move(v)});
  return obj_.back().value;
}

Value& Value::append_member(std::string key, Value v) {
  if (type_ != Type::Object) *this = object();
  obj_.push_back(Member{std::move(key), std::move(v)});
  return obj_.back().value;
}

bool Value::erase(std::string_view key) {
  if (type_ != Type::Object) return false;
  for (auto it = obj_.begin(); it != obj_.end(); ++it) {
    if (it->key == key) {
      obj_.erase(it);
      return true;
    }
  }
  return false;
}

bool Value::operator==(const Value& other) const noexcept {
  if (type_ != other.type_) return false;
  switch (type_) {
    case Type::Null: return true;
    case Type::Bool: return bool_ == other.bool_;
    case Type::Number: return num_ == other.num_;
    case Type::String: return str_ == other.str_;
    case Type::Array: return arr_ == other.arr_;
    case Type::Object:
      if (obj_.size() != other.obj_.size()) return false;
      for (const auto& m : obj_) {
        const Value* o = other.find(m.key);
        if (o == nullptr || !(*o == m.value)) return false;
      }
      return true;
  }
  return false;
}

bool parse(std::string_view text, Value& out, ParseError* err, const ParseLimits& limits) {
  Parser p(text, limits, err);
  Value v;
  if (!p.run(v)) return false;
  out = std::move(v);
  return true;
}

std::string format_number(double v) {
  if (v == 0.0 || !std::isfinite(v)) return "0";  // -0 -> 0; non-finite values never enter Values from parse
  char buf[64];
  if (std::fabs(v) < 1e15 && std::trunc(v) == v) {
    const auto r = std::to_chars(buf, buf + sizeof buf, static_cast<long long>(v));
    return std::string(buf, r.ptr);
  }
  const auto r = std::to_chars(buf, buf + sizeof buf, v);
  return std::string(buf, r.ptr);
}

std::string quote(std::string_view s) {
  std::string out;
  out.reserve(s.size() + 2);
  dump_string(out, s);
  return out;
}

void dump_to(std::string& out, const Value& v, bool sort_keys) {
  switch (v.type()) {
    case Type::Null: out += "null"; return;
    case Type::Bool: out += v.as_bool() ? "true" : "false"; return;
    case Type::Number: out += format_number(v.as_number()); return;
    case Type::String: dump_string(out, v.as_string()); return;
    case Type::Array: {
      out.push_back('[');
      bool first = true;
      for (const auto& item : v.items()) {
        if (!first) out.push_back(',');
        first = false;
        dump_to(out, item, sort_keys);
      }
      out.push_back(']');
      return;
    }
    case Type::Object: {
      out.push_back('{');
      const auto& members = v.members();
      std::vector<const Member*> order;
      order.reserve(members.size());
      for (const auto& m : members) order.push_back(&m);
      if (sort_keys) {
        std::sort(order.begin(), order.end(), [](const Member* a, const Member* b) { return a->key < b->key; });
      }
      bool first = true;
      for (const Member* m : order) {
        if (!first) out.push_back(',');
        first = false;
        dump_string(out, m->key);
        out.push_back(':');
        dump_to(out, m->value, sort_keys);
      }
      out.push_back('}');
      return;
    }
  }
}

std::string dump(const Value& v) {
  std::string out;
  dump_to(out, v, false);
  return out;
}

std::string dump_canonical(const Value& v) {
  std::string out;
  dump_to(out, v, true);
  return out;
}

bool valid_utf8(std::string_view s) noexcept {
  std::size_t i = 0;
  while (i < s.size()) {
    const std::size_t len = utf8_sequence_length(s, i);
    if (len == 0) return false;
    i += len;
  }
  return true;
}

}  // namespace echo::json
