// Host-side helper: reads the D0 data directory into the `data` object of the init command. The core itself
// never touches the filesystem (the WebAssembly module is built without one); hosts pass parsed JSON.
#pragma once

#include <string>

#include "echo/json.hpp"

namespace echo::host {

bool read_file(const std::string& path, std::string& out);
bool parse_file(const std::string& path, json::Value& out, std::string& error);
// {world, npcs, actions, profiles, speech, director, biography[, layout]} from `dir`.
bool load_data_dir(const std::string& dir, json::Value& data, std::string& error, bool with_layout = true);
// Full init request.
json::Value init_request(const json::Value& data, double seed = -1);

}  // namespace echo::host
