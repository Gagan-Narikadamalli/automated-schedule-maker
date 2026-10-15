import { jsonSchema as aiJsonSchema, tool as aiTool } from "ai";

import type {
  SchedulerToolDefinition,
  SchedulerToolRegistry,
} from "./schedulerToolDefinition";
import type { SchedulerPrivacy } from "./schedulerPrivacy";

function adaptTool(definition: SchedulerToolDefinition<any>, privacy?: SchedulerPrivacy): any {
  const adapted = {
    description: privacy?.encodeText(definition.description) ?? definition.description,
    inputSchema: aiJsonSchema(
      (privacy ? JSON.parse(privacy.encodeText(JSON.stringify(definition.inputSchema))) : definition.inputSchema) as Record<string, unknown>
    ),
    ...(definition.execute
      ? {
          execute: async (input: any, options: any) => {
            try {
              const output = await definition.execute?.(privacy ? privacy.decode(input) : input, {
              toolCallId: options?.toolCallId,
              messages: options?.messages,
              });
              return privacy ? privacy.encode(JSON.parse(JSON.stringify(output ?? null))) : output;
            } catch (error) {
              if (!privacy) throw error;
              console.error("Anonymous scheduler tool failed", error);
              return {ok:false,error:"The scheduler tool failed. No successful change was confirmed; retry or check the website."};
            }
          },
        }
      : {}),
  };

  return aiTool(adapted as any);
}

export function adaptSchedulerToolsForPaid(
  registry: SchedulerToolRegistry,
  privacy?: SchedulerPrivacy
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(registry).map(([name, definition]) => [
      name,
      adaptTool(definition, privacy),
    ])
  );
}
