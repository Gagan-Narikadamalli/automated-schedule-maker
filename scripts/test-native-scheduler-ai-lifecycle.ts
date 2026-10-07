import assert from "node:assert/strict";

import {
  SCHEDULER_CLOSING_QUESTION,
  assistantInvitedMoreSchedulerWork,
  ensureSchedulerConversationClosing,
  isSchedulerConversationEndReply,
  schedulerAnswerNeedsFollowUp,
} from "../src/features/ai/schedulerConversationLifecycle";

assert.equal(SCHEDULER_CLOSING_QUESTION, "Is there anything else you'd like me to do?");

for (const answer of [
  "done",
  "Done.",
  "no",
  "No thanks!",
  "nothing else",
  "that's all",
  "all done",
  "finished",
  "we're done",
]) {
  assert.equal(isSchedulerConversationEndReply(answer), true, answer);
}

for (const answer of [
  "no, move it to 2 pm",
  "not done",
  "do this too",
  "yes",
]) {
  assert.equal(isSchedulerConversationEndReply(answer), false, answer);
}

assert.equal(
  assistantInvitedMoreSchedulerWork(
    "The schedule was updated.\n\nIs there anything else you'd like me to do?"
  ),
  true
);
assert.equal(
  assistantInvitedMoreSchedulerWork(
    "Is there anything else you'd like help with?"
  ),
  true
);

const closed = ensureSchedulerConversationClosing("The schedule was updated.");
assert.equal(
  closed,
  "The schedule was updated.\n\nIs there anything else you'd like me to do?"
);

const oldClosing = ensureSchedulerConversationClosing(
  "Done.\n\nIs there anything else you'd like help with?"
);
assert.equal(
  oldClosing,
  "Done.\n\nIs there anything else you'd like help with?"
);

const confirm = ensureSchedulerConversationClosing(
  'Proposed change: move CaMe to Areyana. Reply "yes" to confirm.'
);
assert.equal(
  confirm,
  'Proposed change: move CaMe to Areyana. Reply "yes" to confirm.'
);
assert.equal(schedulerAnswerNeedsFollowUp(confirm), true);

const clarification = ensureSchedulerConversationClosing(
  "Please provide the staff role and start date."
);
assert.equal(
  clarification,
  "Please provide the staff role and start date."
);

console.log("Native Scheduler AI conversation lifecycle tests passed.");
