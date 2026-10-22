// ControlledSpeech (Документ §12 «Контролируемая речь»): NPC lines are built ONLY from authored templates in
// data/speech_ru.json plus substitutions (declined names, target labels, texts of allowed facts). Free model
// text is never spoken. Fact texts are inserted only when the fact is known to the speaker, not protected and
// (when a request context exists) was offered to the model in visible_facts.
#pragma once

#include <string>
#include <vector>

#include "echo/state.hpp"

namespace echo {

struct Speech {
  std::string actor, text, style, gesture, template_id, kind;  // kind: immediate | line | fallback | evidence
  std::vector<std::string> fact_ids;
};

struct SpeechRequest {
  std::string actor;
  std::string kind = "line";
  std::string stage;  // react | propose | start | say | accepted | rejected | replanned | reassigned | expired | done | alarm | ambient | evidence
  std::string action, style, gesture, target, companion;
  std::vector<std::string> fact_ids;
  const std::vector<std::string>* allowed_facts = nullptr;  // visible_facts of the request; null = speaker knowledge only
  std::string situation;    // alarm | echo | order | say | initiative | calm
  std::string reason;       // refusal reason (power, secret, eva, busy, role, route, resource, invalid, generic)
  std::string result_fact;  // for the done stage: a fact revealed by the task
  std::string say_intent;
};

// Picks a template (most specific first, avoiding the speaker's recent lines) and fills its slots.
// Never fails: when no template matches, returns a neutral built-in line (counted in metrics).
Speech render_speech(Core& c, const SpeechRequest& req);
// Emits a `speech` event, updates the actor's gesture/style/talking state and speech metrics.
void say(Core& c, const Speech& s, const std::string& source);
json::Value speech_json(const Speech& s);

// Situation tag for speech selection derived from world state and the request situation.
std::string speech_situation(const Core& c, const Situation& sit);

// True when `text` contains the text of any protected fact (used by tests and the invariant auditor).
bool contains_protected_text(const Core& c, const std::string& text);

}  // namespace echo
