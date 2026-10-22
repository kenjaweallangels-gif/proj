// Test-only JSON Schema validator for the subset used by schemas/*.json (type, const, enum, pattern,
// minLength/maxLength, minimum/maximum, required, properties, additionalProperties, items, minItems/maxItems,
// uniqueItems). Lets the tests check core output against the real schema files.
#pragma once

#include <string>
#include <vector>

#include "echo/json.hpp"

namespace echo::test {

// Returns human-readable violations (empty = valid).
std::vector<std::string> validate_schema(const json::Value& schema, const json::Value& value, const std::string& path = "$");

}  // namespace echo::test
