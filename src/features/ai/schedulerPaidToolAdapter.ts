import { jsonSchema as aiJsonSchema, tool as aiTool } from "ai";

import type {
  SchedulerToolDefinition,
  SchedulerToolRegistry,
} from "./schedulerToolDefinition";

function adaptTool(definition: SchedulerToolDefinition<any>) {
  return aiTool({
    description: definition.description,
    inputSchema: aiJsonSchema<any>(
      definition.inputSchema as Record<string, unknown>
    ),
    ...(definition.execute
      ? {
          execute: async (input: any, options: any) =>
            definition.execute?.(input, {
              toolCallId: options?.toolCallId,
              messages: options?.messages,
            }),
        }
      : {}),
  });
}

export function adaptSchedulerToolsForPaid(
  registry: SchedulerToolRegistry
): Record<string, ReturnType<typeof adaptTool>> {
  return Object.fromEntries(
    Object.entries(registry).map(([name, definition]) => [
      name,
      adaptTool(definition),
    ])
  );
}
