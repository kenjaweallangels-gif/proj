/* Echo Runtime core — C ABI (docs/SPEC.md §1). Identical for native builds, WebAssembly and tests.
 * echo_call returns UTF-8 JSON owned by the core, valid until the next echo_call on the same core. */
#ifndef ECHO_C_API_H
#define ECHO_C_API_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EchoCore EchoCore;

EchoCore* echo_create(void);
void echo_destroy(EchoCore*);
const char* echo_call(EchoCore*, const char* request_json); /* returns UTF-8 JSON, valid until next echo_call on the same core */

#ifdef __cplusplus
}
#endif

#endif /* ECHO_C_API_H */
