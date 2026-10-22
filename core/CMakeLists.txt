cmake_minimum_required(VERSION 3.20)
project(echo_core VERSION 0.1.0 LANGUAGES CXX)

# Echo Runtime core: one C++20 codebase for the native build and WebAssembly (Emscripten).
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(ECHO_WERROR "Treat warnings as errors" ON)
set(ECHO_DATA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../data" CACHE PATH "D0 data directory used by tests and the CLI")
get_filename_component(ECHO_DATA_DIR "${ECHO_DATA_DIR}" ABSOLUTE)
set(ECHO_SCHEMA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../schemas")
get_filename_component(ECHO_SCHEMA_DIR "${ECHO_SCHEMA_DIR}" ABSOLUTE)

if(EMSCRIPTEN)
  # Small module: optimise for size with LTO (the core is logic-heavy, not compute-heavy).
  # IEEE semantics are unchanged (no fast-math), so results stay bit-identical to the native build.
  set(CMAKE_CXX_FLAGS_RELEASE "-Oz -flto -DNDEBUG")
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-Oz -flto")
endif()

# Same semantics on every target: no exceptions/RTTI (the core reports errors as values) and no FP
# contraction, so floating-point results and the state hash are identical natively and in WASM.
set(ECHO_COMMON_FLAGS -fno-exceptions -fno-rtti -ffp-contract=off)
set(ECHO_WARNINGS -Wall -Wextra -Wpedantic -Wshadow)
if(ECHO_WERROR)
  list(APPEND ECHO_WARNINGS -Werror)
endif()

add_library(echo_core STATIC
  src/json.cpp
  src/util.cpp
  src/data_load.cpp
  src/world.cpp
  src/rules.cpp
  src/speech.cpp
  src/context.cpp
  src/authority.cpp
  src/tasks.cpp
  src/policy.cpp
  src/admission.cpp
  src/director.cpp
  src/biography.cpp
  src/metrics.cpp
  src/persist.cpp
  src/sim.cpp
  src/engine.cpp
  src/c_api.cpp
)
target_include_directories(echo_core PUBLIC include)
target_compile_options(echo_core PRIVATE ${ECHO_COMMON_FLAGS} ${ECHO_WARNINGS})
target_compile_options(echo_core INTERFACE ${ECHO_COMMON_FLAGS})

add_executable(echo_cli cli/echo_cli.cpp cli/data_files.cpp)
target_link_libraries(echo_cli PRIVATE echo_core)
target_compile_options(echo_cli PRIVATE ${ECHO_WARNINGS})
target_compile_definitions(echo_cli PRIVATE ECHO_DATA_DIR="${ECHO_DATA_DIR}")

add_executable(echo_tests
  tests/main.cpp
  tests/harness.cpp
  tests/fixtures.cpp
  tests/schema_validator.cpp
  tests/test_json.cpp
  tests/test_intent.cpp
  tests/test_authority.cpp
  tests/test_admission.cpp
  tests/test_context.cpp
  tests/test_policy.cpp
  tests/test_speech.cpp
  tests/test_director.cpp
  tests/test_biography.cpp
  tests/test_persist.cpp
  tests/test_metrics.cpp
  tests/test_protocol.cpp
  tests/test_scenario.cpp
  cli/data_files.cpp
)
target_include_directories(echo_tests PRIVATE tests cli)
target_link_libraries(echo_tests PRIVATE echo_core)
target_compile_options(echo_tests PRIVATE ${ECHO_WARNINGS})
target_compile_definitions(echo_tests PRIVATE ECHO_DATA_DIR="${ECHO_DATA_DIR}" ECHO_SCHEMA_DIR="${ECHO_SCHEMA_DIR}")

enable_testing()

if(EMSCRIPTEN)
  # Node-hosted test/CLI binaries read the real data directory through NODERAWFS.
  set(ECHO_NODE_LINK -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1 -sENVIRONMENT=node -sSTACK_SIZE=1048576)
  target_link_options(echo_tests PRIVATE ${ECHO_NODE_LINK})
  target_link_options(echo_cli PRIVATE ${ECHO_NODE_LINK})
  set_target_properties(echo_tests PROPERTIES SUFFIX ".cjs")
  set_target_properties(echo_cli PROPERTIES SUFFIX ".cjs")

  # The browser/worker/node ES module: echo_core.mjs (single file, no filesystem, no exceptions).
  add_executable(echo_core_module src/c_api.cpp)
  target_link_libraries(echo_core_module PRIVATE echo_core)
  target_compile_options(echo_core_module PRIVATE ${ECHO_WARNINGS})
  set_target_properties(echo_core_module PROPERTIES OUTPUT_NAME echo_core SUFFIX ".mjs")
  target_link_options(echo_core_module PRIVATE
    --no-entry
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sSINGLE_FILE_BINARY_ENCODE=0
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576
    -sFILESYSTEM=0
    -sEXPORT_NAME=createEchoCore
    "-sEXPORTED_FUNCTIONS=_echo_create,_echo_destroy,_echo_call,_malloc,_free"
    "-sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8")
  # Node comes with emsdk (it is also the test emulator of the Emscripten toolchain).
  find_program(ECHO_NODE NAMES node HINTS ENV EMSDK_NODE REQUIRED)
  add_custom_command(TARGET echo_core_module POST_BUILD
    COMMAND ${ECHO_NODE} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/strip_node_prefix.mjs $<TARGET_FILE:echo_core_module>
    COMMENT "echo_core.mjs: node:* specifiers -> bundler-friendly names")
endif()

add_test(NAME echo_tests COMMAND echo_tests --data-dir ${ECHO_DATA_DIR} --schema-dir ${ECHO_SCHEMA_DIR})
add_test(NAME echo_cli_scenario COMMAND echo_cli scenario --provider rules --data-dir ${ECHO_DATA_DIR} --seconds 300 --check)
add_test(NAME echo_cli_script_model COMMAND echo_cli scenario --provider script:${CMAKE_CURRENT_SOURCE_DIR}/scenarios/model_mira.jsonl
         --data-dir ${ECHO_DATA_DIR} --seconds 300 --check)
add_test(NAME echo_cli_script_adversarial COMMAND echo_cli scenario --provider script:${CMAKE_CURRENT_SOURCE_DIR}/scenarios/adversarial.jsonl
         --data-dir ${ECHO_DATA_DIR} --seconds 300 --check)
add_test(NAME echo_cli_bench_smoke COMMAND echo_cli bench-authority --n 2000 --data-dir ${ECHO_DATA_DIR})
