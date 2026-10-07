import { jsonSchema as aiJsonSchema, tool as aiTool } from "ai";

import type {
  SchedulerToolDefinition,
  SchedulerToolRegistry,
} from "./schedulerToolDefinition";

function adaptTool(definition: SchedulerToolDefinition<any>): any {
  const adapted = {
    description: definition.description,
    inputSchema: aiJsonSchema(
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
  };

  return aiTool(adapted as any);
}

export function adaptSchedulerToolsForPaid(
  registry: SchedulerToolRegistry
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(registry).map(([name, definition]) => [
      name,
      adaptTool(definition),
    ])
  );
}
