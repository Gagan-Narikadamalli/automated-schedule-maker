import assert from "node:assert/strict";

import {
  planNativeSchedulerAction,
  type NativeSchedulerIntent,
} from "../src/features/ai/schedulerNativeAi";

type Case = {
  prompt: string;
  intent: NativeSchedulerIntent;
  tool: string;
};

const cases: Case[] = [
  { prompt: "generate today's schedule", intent: "GENERATE", tool: "generate_schedule" },
  { prompt: "build the schedule for Friday", intent: "GENERATE", tool: "generate_schedule" },
  { prompt: "auto generate the work week schedule", intent: "GENERATE", tool: "generate_schedule" },
  { prompt: "regenerate this schedule", intent: "GENERATE", tool: "generate_schedule" },
  { prompt: "fix the schedule", intent: "REPAIR", tool: "repair_schedule" },
  { prompt: "repair the schedule", intent: "REPAIR", tool: "repair_schedule" },
  { prompt: "minimal fix this schedule", intent: "REPAIR", tool: "repair_schedule" },
  { prompt: "cover the uncovered blocks", intent: "REPAIR", tool: "repair_schedule" },
  { prompt: "make sure all clients are covered", intent: "REPAIR", tool: "repair_schedule" },
  { prompt: "Ania called out", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "Ania is absent from 9 am to 2 pm", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "mark Ania as absent", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "call out for Danna from 8 am to 12 pm", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "remove call out for Ania", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "cancel call-out for Danna", intent: "CALL_OUT", tool: "record_call_out" },
  { prompt: "give Danna a break at 1 pm", intent: "BREAK_EDIT", tool: "edit_schedule_cells" },
  { prompt: "add Danna break at 1:30 pm", intent: "BREAK_EDIT", tool: "edit_schedule_cells" },
  { prompt: "schedule a break for Danna at 2 pm", intent: "BREAK_EDIT", tool: "edit_schedule_cells" },
  { prompt: "remove Danna's break at 1 pm", intent: "BREAK_EDIT", tool: "edit_schedule_cells" },
  { prompt: "clear the break for Danna at 1 pm", intent: "BREAK_EDIT", tool: "edit_schedule_cells" },
  { prompt: "replace all Ania blocks with Areyana", intent: "BULK_REPLACE", tool: "replace_schedule_blocks" },
  { prompt: "replace client CaMe with ZiBo", intent: "BULK_REPLACE", tool: "replace_schedule_blocks" },
  { prompt: "show schedule templates", intent: "TEMPLATE", tool: "manage_schedule_template" },
  { prompt: "list templates", intent: "TEMPLATE", tool: "manage_schedule_template" },
  { prompt: "apply schedule template Monday Standard", intent: "TEMPLATE", tool: "manage_schedule_template" },
  { prompt: "use the template Friday Base for today", intent: "TEMPLATE", tool: "manage_schedule_template" },
  { prompt: "what is still unplaced", intent: "UNPLACED", tool: "get_unplaced_assignments" },
  { prompt: "show unassigned clients", intent: "UNPLACED", tool: "get_unplaced_assignments" },
  { prompt: "what still needs scheduling", intent: "UNPLACED", tool: "get_unplaced_assignments" },
  { prompt: "check the schedule for conflicts", intent: "HEALTH", tool: "check_schedule" },
  { prompt: "validate the schedule", intent: "HEALTH", tool: "check_schedule" },
  { prompt: "are there coverage gaps", intent: "HEALTH", tool: "check_schedule" },
  { prompt: "is the schedule incomplete", intent: "HEALTH", tool: "check_schedule" },
  { prompt: "who is free from 12 pm to 1 pm", intent: "FREE_STAFF", tool: "lookup_schedule" },
  { prompt: "who's available from 1 pm to 2 pm", intent: "FREE_STAFF", tool: "lookup_schedule" },
  { prompt: "show free staff between 10 am and 11 am", intent: "FREE_STAFF", tool: "lookup_schedule" },
  { prompt: "who is Ania with from 8 am to 2 pm", intent: "STAFF_LOOKUP", tool: "lookup_schedule" },
  { prompt: "what clients does Ania have today", intent: "STAFF_LOOKUP", tool: "lookup_schedule" },
  { prompt: "when is Danna on break", intent: "STAFF_LOOKUP", tool: "lookup_schedule" },
  { prompt: "show Ania's schedule", intent: "STAFF_LOOKUP", tool: "lookup_schedule" },
  { prompt: "schedule for Ania today", intent: "STAFF_LOOKUP", tool: "lookup_schedule" },
  { prompt: "who is covering CaMe at 10 am", intent: "CLIENT_LOOKUP", tool: "lookup_schedule" },
  { prompt: "coverage for CaMe from 10 am to 12 pm", intent: "CLIENT_LOOKUP", tool: "lookup_schedule" },
  { prompt: "who is with ZiBo at 2 pm", intent: "CLIENT_LOOKUP", tool: "lookup_schedule" },
  { prompt: "which staff are missing breaks", intent: "STAFF_SUMMARY", tool: "get_staff" },
  { prompt: "show staff call-outs", intent: "STAFF_SUMMARY", tool: "get_staff" },
  { prompt: "staff overview", intent: "STAFF_SUMMARY", tool: "get_staff" },
  { prompt: "show client nap requirements", intent: "CLIENT_SUMMARY", tool: "get_clients" },
  { prompt: "show speech times for clients", intent: "CLIENT_SUMMARY", tool: "get_clients" },
  { prompt: "client attendance overview", intent: "CLIENT_SUMMARY", tool: "get_clients" },
  { prompt: "what normally happens on Mondays", intent: "HISTORICAL", tool: "__native_history__" },
  { prompt: "show historical staff client patterns", intent: "HISTORICAL", tool: "__native_history__" },
  { prompt: "what did we usually do for breaks", intent: "HISTORICAL", tool: "__native_history__" },
  { prompt: "use previous schedules as a reference", intent: "HISTORICAL", tool: "__native_history__" },
  { prompt: "what were the typical pairings last year", intent: "HISTORICAL", tool: "__native_history__" },
  { prompt: "what is happening on this schedule", intent: "DAY_SUMMARY", tool: "get_day_schedule" },
  { prompt: "show me today's schedule", intent: "DAY_SUMMARY", tool: "get_day_schedule" },
  { prompt: "what is on the selected day", intent: "DAY_SUMMARY", tool: "get_day_schedule" },
];

for (const item of cases) {
  const result = planNativeSchedulerAction({
    message: item.prompt,
    history: [],
    writeToolsEnabled: true,
  });
  assert.equal(result.intent, item.intent, item.prompt);
  assert.equal(result.toolName, item.tool, item.prompt);
}

console.log(`Native Scheduler AI language matrix passed (${cases.length} prompts).`);
