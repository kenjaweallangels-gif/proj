#include "echo/util.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>

namespace echo {

std::uint64_t fnv1a64(std::string_view data, std::uint64_t seed) noexcept {
  std::uint64_t h = seed;
  for (const char c : data) {
    h ^= static_cast<unsigned char>(c);
    h *= 0x100000001b3ULL;
  }
  return h;
}

std::string hex64(std::uint64_t v) {
  static const char* kHex = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i) {
    out[static_cast<std::size_t>(i)] = kHex[v & 0xF];
    v >>= 4;
  }
  return out;
}

std::uint64_t Rng::next_u64() noexcept {
  std::uint64_t z = (state_ += 0x9e3779b97f4a7c15ULL);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}

double Rng::next_double() noexcept {
  return static_cast<double>(next_u64() >> 11) * (1.0 / 9007199254740992.0);
}

std::uint32_t Rng::next_below(std::uint32_t n) noexcept {
  if (n <= 1) return 0;
  return static_cast<std::uint32_t>(next_u64() % n);
}

std::size_t utf8_length(std::string_view s) noexcept {
  std::size_t n = 0;
  for (const char c : s) {
    if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++n;
  }
  return n;
}

std::string utf8_truncate(std::string_view s, std::size_t max_cp, std::string_view ellipsis) {
  if (utf8_length(s) <= max_cp) return std::string(s);
  const std::size_t keep = max_cp > utf8_length(ellipsis) ? max_cp - utf8_length(ellipsis) : 0;
  std::size_t cp = 0;
  std::size_t i = 0;
  for (; i < s.size(); ++i) {
    if ((static_cast<unsigned char>(s[i]) & 0xC0) != 0x80) {
      if (cp == keep) break;
      ++cp;
    }
  }
  std::string out(s.substr(0, i));
  out += ellipsis;
  return out;
}

namespace {

// Decodes one code point from valid UTF-8 at s[i]; advances i.
std::uint32_t decode(std::string_view s, std::size_t& i) {
  const auto b = [&](std::size_t k) { return static_cast<std::uint32_t>(static_cast<unsigned char>(s[k])); };
  const std::uint32_t c = b(i);
  if (c < 0x80) {
    i += 1;
    return c;
  }
  if ((c >> 5) == 0x6 && i + 1 < s.size()) {
    const std::uint32_t cp = ((c & 0x1F) << 6) | (b(i + 1) & 0x3F);
    i += 2;
    return cp;
  }
  if ((c >> 4) == 0xE && i + 2 < s.size()) {
    const std::uint32_t cp = ((c & 0x0F) << 12) | ((b(i + 1) & 0x3F) << 6) | (b(i + 2) & 0x3F);
    i += 3;
    return cp;
  }
  if ((c >> 3) == 0x1E && i + 3 < s.size()) {
    const std::uint32_t cp = ((c & 0x07) << 18) | ((b(i + 1) & 0x3F) << 12) | ((b(i + 2) & 0x3F) << 6) | (b(i + 3) & 0x3F);
    i += 4;
    return cp;
  }
  i += 1;
  return 0xFFFD;
}

void encode(std::string& out, std::uint32_t cp) {
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

bool is_word_cp(std::uint32_t cp) {
  return (cp >= '0' && cp <= '9') || (cp >= 'a' && cp <= 'z') || (cp >= 0x0430 && cp <= 0x044F);
}

}  // namespace

std::string fold_ru(std::string_view s) {
  std::string out;
  out.reserve(s.size());
  std::size_t i = 0;
  while (i < s.size()) {
    std::uint32_t cp = decode(s, i);
    if (cp >= 'A' && cp <= 'Z') cp += 0x20;
    else if (cp >= 0x0410 && cp <= 0x042F) cp += 0x20;  // А-Я -> а-я
    if (cp == 0x0401 || cp == 0x0451) cp = 0x0435;       // Ё/ё -> е
    encode(out, cp);
  }
  return out;
}

std::vector<std::string> words_ru(std::string_view folded) {
  std::vector<std::string> words;
  std::string cur;
  std::size_t i = 0;
  while (i < folded.size()) {
    const std::size_t start = i;
    const std::uint32_t cp = decode(folded, i);
    if (is_word_cp(cp)) {
      cur.append(folded.substr(start, i - start));
    } else if (!cur.empty()) {
      words.push_back(cur);
      cur.clear();
    }
  }
  if (!cur.empty()) words.push_back(cur);
  return words;
}

int estimate_tokens(std::string_view s) noexcept {
  return static_cast<int>(std::ceil(static_cast<double>(utf8_length(s)) / 3.2));
}

std::string format_id(std::string_view prefix, std::uint64_t n, int width) {
  std::string digits = std::to_string(n);
  if (static_cast<int>(digits.size()) < width) digits.insert(0, static_cast<std::size_t>(width) - digits.size(), '0');
  return std::string(prefix) + digits;
}

std::string format_seconds_ru(double seconds) {
  const long long total = static_cast<long long>(std::floor(seconds));
  const long long m = total / 60;
  const long long s = total % 60;
  char buf[32];
  std::snprintf(buf, sizeof buf, "%02lld:%02lld", m, s);
  return buf;
}

std::string fixed(double v, int decimals) {
  char buf[64];
  std::snprintf(buf, sizeof buf, "%.*f", decimals, v);
  return buf;
}

std::string format_number_ru(double v) {
  if (std::trunc(v) == v && std::fabs(v) < 1e15) return std::to_string(static_cast<long long>(v));
  std::string s = fixed(v, 2);
  while (!s.empty() && s.back() == '0') s.pop_back();
  if (!s.empty() && s.back() == '.') s.pop_back();
  std::replace(s.begin(), s.end(), '.', ',');
  return s;
}

bool contains(const std::vector<std::string>& v, std::string_view s) noexcept {
  return std::find(v.begin(), v.end(), s) != v.end();
}

void append_unique(std::vector<std::string>& v, std::string_view s) {
  if (!contains(v, s)) v.emplace_back(s);
}

std::string join(const std::vector<std::string>& v, std::string_view sep) {
  std::string out;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (i > 0) out += sep;
    out += v[i];
  }
  return out;
}

bool starts_with(std::string_view s, std::string_view prefix) noexcept {
  return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

double clamp01(double v) noexcept { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

}  // namespace echo
