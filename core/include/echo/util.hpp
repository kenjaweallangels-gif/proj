// Small deterministic helpers shared by all core modules: FNV-1a hashing, a seeded RNG, UTF-8 and
// Russian text utilities, token estimation and id formatting. Nothing here depends on the platform,
// so native and WebAssembly builds produce identical results.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace echo {

// FNV-1a 64-bit.
std::uint64_t fnv1a64(std::string_view data, std::uint64_t seed = 0xcbf29ce484222325ULL) noexcept;
std::string hex64(std::uint64_t v);

// SplitMix64: tiny, fast and fully specified, so a seed replays identically on every target.
class Rng {
 public:
  explicit Rng(std::uint64_t seed = 0) noexcept : state_(seed) {}
  std::uint64_t next_u64() noexcept;
  double next_double() noexcept;                   // [0, 1)
  std::uint32_t next_below(std::uint32_t n) noexcept;  // [0, n), n > 0
  std::uint64_t state() const noexcept { return state_; }
  void set_state(std::uint64_t s) noexcept { state_ = s; }

 private:
  std::uint64_t state_;
};

// Number of Unicode code points in valid UTF-8.
std::size_t utf8_length(std::string_view s) noexcept;
// Truncates to at most `max_cp` code points (never splits a sequence); appends `ellipsis` when cut.
std::string utf8_truncate(std::string_view s, std::size_t max_cp, std::string_view ellipsis = "…");
// Lowercases ASCII and Cyrillic (А-Я, Ё) and folds ё -> е, for keyword matching.
std::string fold_ru(std::string_view s);
// Splits folded text into words of letters/digits (UTF-8 aware; punctuation separates words).
std::vector<std::string> words_ru(std::string_view folded);

// Token estimate used for context budgets: ceil(code points / 3.2). It is a heuristic, not provider usage;
// the same formula as estimateTokens() in shared/prompt.ts.
int estimate_tokens(std::string_view s) noexcept;

std::string format_id(std::string_view prefix, std::uint64_t n, int width);
std::string format_seconds_ru(double seconds);  // "1:05" style mm:ss for transcripts
std::string fixed(double v, int decimals);      // locale-independent fixed formatting
std::string format_number_ru(double v);         // "12", "2,5", "0,35" (Russian decimal comma)

bool contains(const std::vector<std::string>& v, std::string_view s) noexcept;
void append_unique(std::vector<std::string>& v, std::string_view s);
std::string join(const std::vector<std::string>& v, std::string_view sep);
bool starts_with(std::string_view s, std::string_view prefix) noexcept;
double clamp01(double v) noexcept;

}  // namespace echo
