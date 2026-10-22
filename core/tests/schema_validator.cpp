#include "schema_validator.hpp"

#include <regex>

#include "echo/util.hpp"

namespace echo::test {
namespace {

bool type_matches(const std::string& t, const json::Value& v) {
  if (t == "object") return v.is_object();
  if (t == "array") return v.is_array();
  if (t == "string") return v.is_string();
  if (t == "number") return v.is_number();
  if (t == "integer") return v.is_integer();
  if (t == "boolean") return v.is_bool();
  if (t == "null") return v.is_null();
  return false;
}

}  // namespace

std::vector<std::string> validate_schema(const json::Value& s, const json::Value& v, const std::string& path) {
  std::vector<std::string> errs;
  auto err = [&](const std::string& m) { errs.push_back(path + ": " + m); };
  if (const json::Value* t = s.find("type")) {
    bool ok = false;
    if (t->is_string()) ok = type_matches(t->as_string(), v);
    for (const auto& alt : t->items()) ok = ok || type_matches(alt.as_string(), v);
    if (!ok) {
      err("неверный тип");
      return errs;
    }
  }
  if (const json::Value* c = s.find("const"); c != nullptr && !(*c == v)) err("не равно const");
  if (const json::Value* e = s.find("enum")) {
    bool found = false;
    for (const auto& x : e->items()) found = found || x == v;
    if (!found) err("значение вне enum");
  }
  if (v.is_string()) {
    const std::size_t len = utf8_length(v.as_string());
    if (const json::Value* m = s.find("minLength"); m != nullptr && len < static_cast<std::size_t>(m->as_int())) err("короче minLength");
    if (const json::Value* m = s.find("maxLength"); m != nullptr && len > static_cast<std::size_t>(m->as_int())) err("длиннее maxLength");
    if (const json::Value* p = s.find("pattern")) {
      const std::regex re(p->as_string());
      if (!std::regex_search(v.as_string(), re)) err("не соответствует pattern " + p->as_string());
    }
  }
  if (v.is_number()) {
    if (const json::Value* m = s.find("minimum"); m != nullptr && v.as_number() < m->as_number()) err("меньше minimum");
    if (const json::Value* m = s.find("maximum"); m != nullptr && v.as_number() > m->as_number()) err("больше maximum");
  }
  if (v.is_array()) {
    if (const json::Value* m = s.find("minItems"); m != nullptr && v.size() < static_cast<std::size_t>(m->as_int())) err("меньше minItems");
    if (const json::Value* m = s.find("maxItems"); m != nullptr && v.size() > static_cast<std::size_t>(m->as_int())) err("больше maxItems");
    if (s["uniqueItems"].as_bool()) {
      for (std::size_t i = 0; i < v.size(); ++i) {
        for (std::size_t j = i + 1; j < v.size(); ++j) {
          if (v.at(i) == v.at(j)) err("повторяющиеся элементы");
        }
      }
    }
    if (const json::Value* items = s.find("items"); items != nullptr && items->is_object()) {
      for (std::size_t i = 0; i < v.size(); ++i) {
        for (auto& e : validate_schema(*items, v.at(i), path + "[" + std::to_string(i) + "]")) errs.push_back(e);
      }
    }
  }
  if (v.is_object()) {
    for (const auto& r : s["required"].items()) {
      if (!v.has(r.as_string())) err("нет обязательного поля " + r.as_string());
    }
    const json::Value& props = s["properties"];
    const json::Value* additional = s.find("additionalProperties");
    for (const auto& m : v.members()) {
      if (const json::Value* ps = props.find(m.key)) {
        for (auto& e : validate_schema(*ps, m.value, path + "." + m.key)) errs.push_back(e);
      } else if (additional != nullptr) {
        if (additional->is_bool() && !additional->as_bool()) err("лишнее поле " + m.key);
        else if (additional->is_object()) {
          for (auto& e : validate_schema(*additional, m.value, path + "." + m.key)) errs.push_back(e);
        }
      }
    }
  }
  return errs;
}

}  // namespace echo::test
