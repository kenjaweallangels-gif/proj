// Strict JSON for the Echo Runtime core: one small dependency-free value type, a strict parser
// (duplicate keys, depth/byte limits, UTF-8 validation, no NaN/Inf, no trailing garbage) and a
// deterministic serializer (insertion order or canonical sorted keys).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace echo::json {

enum class Type : std::uint8_t { Null, Bool, Number, String, Array, Object };

struct Member;

class Value {
 public:
  // Constructors are defined below, once Member is a complete type.
  Value() noexcept;
  Value(std::nullptr_t) noexcept;
  Value(bool b) noexcept;
  Value(double n) noexcept;
  Value(int n) noexcept;
  Value(long n) noexcept;
  Value(long long n) noexcept;
  Value(unsigned n) noexcept;
  Value(unsigned long n) noexcept;
  Value(unsigned long long n) noexcept;
  Value(const char* s);
  Value(std::string s) noexcept;
  Value(std::string_view s);
  Value(const Value&);
  Value(Value&&) noexcept;
  Value& operator=(const Value&);
  Value& operator=(Value&&) noexcept;
  ~Value();

  static Value array();
  static Value object();
  static Value string_array(const std::vector<std::string>& items);

  Type type() const noexcept { return type_; }
  bool is_null() const noexcept { return type_ == Type::Null; }
  bool is_bool() const noexcept { return type_ == Type::Bool; }
  bool is_number() const noexcept { return type_ == Type::Number; }
  bool is_string() const noexcept { return type_ == Type::String; }
  bool is_array() const noexcept { return type_ == Type::Array; }
  bool is_object() const noexcept { return type_ == Type::Object; }
  // Number with an integral value that is exactly representable (|v| <= 2^53).
  bool is_integer() const noexcept;

  bool as_bool(bool fallback = false) const noexcept { return is_bool() ? bool_ : fallback; }
  double as_number(double fallback = 0.0) const noexcept { return is_number() ? num_ : fallback; }
  std::int64_t as_int(std::int64_t fallback = 0) const noexcept;
  const std::string& as_string() const noexcept;  // empty string when not a string
  std::string str(std::string_view fallback = {}) const { return is_string() ? str_ : std::string(fallback); }

  // Arrays. push() turns a null value into an array.
  const std::vector<Value>& items() const noexcept;
  std::vector<Value>& items_mut();
  Value& push(Value v);
  std::size_t size() const noexcept;  // array items or object members; 0 otherwise
  const Value& at(std::size_t i) const noexcept;

  // Objects (insertion-ordered). set() turns a null value into an object and replaces existing keys.
  const std::vector<Member>& members() const noexcept;
  const Value* find(std::string_view key) const noexcept;
  Value* find_mut(std::string_view key) noexcept;
  bool has(std::string_view key) const noexcept { return find(key) != nullptr; }
  const Value& operator[](std::string_view key) const noexcept;  // null when absent
  Value& set(std::string_view key, Value v);
  // Appends without checking for an existing key; the caller guarantees uniqueness (used by the parser).
  Value& append_member(std::string key, Value v);
  bool erase(std::string_view key);

  bool operator==(const Value& other) const noexcept;
  bool operator!=(const Value& other) const noexcept { return !(*this == other); }

 private:
  Type type_ = Type::Null;
  bool bool_ = false;
  double num_ = 0.0;
  std::string str_;
  std::vector<Value> arr_;
  std::vector<Member> obj_;
};

struct Member {
  std::string key;
  Value value;
};

inline Value::Value() noexcept {}
inline Value::Value(std::nullptr_t) noexcept {}
inline Value::Value(bool b) noexcept : type_(Type::Bool), bool_(b) {}
inline Value::Value(double n) noexcept : type_(Type::Number), num_(n) {}
inline Value::Value(int n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(long n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(long long n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(unsigned n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(unsigned long n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(unsigned long long n) noexcept : type_(Type::Number), num_(static_cast<double>(n)) {}
inline Value::Value(const char* s) : type_(Type::String), str_(s) {}
inline Value::Value(std::string s) noexcept : type_(Type::String), str_(std::move(s)) {}
inline Value::Value(std::string_view s) : type_(Type::String), str_(s) {}
inline Value::Value(const Value&) = default;
inline Value::Value(Value&&) noexcept = default;
inline Value& Value::operator=(const Value&) = default;
inline Value& Value::operator=(Value&&) noexcept = default;
inline Value::~Value() = default;

struct ParseLimits {
  std::size_t max_bytes = 16u * 1024u * 1024u;
  int max_depth = 64;  // nesting depth of containers; a top-level object is depth 1
};

struct ParseError {
  std::string code;     // too_large, depth_exceeded, duplicate_key, invalid_utf8, ...
  std::string message;  // human-readable detail
  std::size_t offset = 0;
};

// Strict RFC 8259 parsing. Duplicate keys are always an error. Returns false and fills `err` on failure.
bool parse(std::string_view text, Value& out, ParseError* err, const ParseLimits& limits = {});

// Compact serialization in insertion order.
std::string dump(const Value& v);
// Compact serialization with object keys sorted bytewise: the canonical form used for hashing.
std::string dump_canonical(const Value& v);
void dump_to(std::string& out, const Value& v, bool sort_keys);

// Shortest round-trip number formatting; integral values within 1e15 print without exponent/fraction.
std::string format_number(double v);
// JSON string literal with escapes (output stays valid UTF-8; non-ASCII is emitted raw).
std::string quote(std::string_view s);

// Validates a UTF-8 byte sequence (RFC 3629: no overlongs, no surrogates, <= U+10FFFF).
bool valid_utf8(std::string_view s) noexcept;

}  // namespace echo::json
