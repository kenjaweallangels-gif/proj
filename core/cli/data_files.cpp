#include "data_files.hpp"

#include <cstdio>

namespace echo::host {

bool read_file(const std::string& path, std::string& out) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return false;
  out.clear();
  char buf[65536];
  std::size_t n = 0;
  while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
  const bool ok = std::ferror(f) == 0;
  std::fclose(f);
  return ok;
}

bool parse_file(const std::string& path, json::Value& out, std::string& error) {
  std::string text;
  if (!read_file(path, text)) {
    error = "не удалось прочитать " + path;
    return false;
  }
  json::ParseError perr;
  if (!json::parse(text, out, &perr)) {
    error = path + ": " + perr.code + " — " + perr.message + " (offset " + std::to_string(perr.offset) + ")";
    return false;
  }
  return true;
}

bool load_data_dir(const std::string& dir, json::Value& data, std::string& error, bool with_layout) {
  struct Entry {
    const char* key;
    const char* file;
  };
  static const Entry kFiles[] = {
      {"world", "world/zero_echo_d0.json"}, {"npcs", "npcs.json"},           {"actions", "actions.json"},
      {"profiles", "profiles.json"},        {"speech", "speech_ru.json"},    {"director", "director_events.json"},
      {"biography", "biography_details.json"},
  };
  data = json::Value::object();
  for (const auto& e : kFiles) {
    json::Value v;
    if (!parse_file(dir + "/" + e.file, v, error)) return false;
    data.set(e.key, std::move(v));
  }
  if (with_layout) {
    json::Value layout;
    if (!parse_file(dir + "/scene/d0_layout.json", layout, error)) return false;
    json::Value subset = json::Value::object();
    subset.set("anchors", layout["anchors"]);
    subset.set("zone_stand_points", layout["zone_stand_points"]);
    data.set("layout", std::move(subset));
  }
  return true;
}

json::Value init_request(const json::Value& data, double seed) {
  json::Value req = json::Value::object();
  req.set("cmd", "init");
  req.set("data", data);
  if (seed >= 0) req.set("seed", seed);
  return req;
}

}  // namespace echo::host
