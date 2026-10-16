import { jsonSchema as aiJsonSchema, tool as aiTool } from "ai";

import type {
  SchedulerToolDefinition,
  SchedulerToolRegistry,
} from "./schedulerToolDefinition";
import type { SchedulerPrivacy } from "./schedulerPrivacy";

export type SchedulerExecutedTool = {toolName:string;input:Record<string,unknown>;output:unknown};
type ResultObserver = (result:SchedulerExecutedTool)=>void;

function adaptTool(name:string, definition: SchedulerToolDefinition<any>, privacy?: SchedulerPrivacy, onResult?:ResultObserver): any {
  const adapted = {
    description: privacy?.encodeText(definition.description) ?? definition.description,
    inputSchema: aiJsonSchema(
      (privacy ? JSON.parse(privacy.encodeText(JSON.stringify(definition.inputSchema))) : definition.inputSchema) as Record<string, unknown>
    ),
    ...(definition.execute
      ? {
          execute: async (input: any, options: any) => {
            const localInput=privacy ? privacy.decode(input) : input;
            try {
              const output = await definition.execute?.(localInput, {
              toolCallId: options?.toolCallId,
              messages: options?.messages,
              });
              // Keep confirmed website results even if the next model call fails.
              onResult?.({toolName:name,input:localInput,output});
              return privacy ? privacy.encode(JSON.parse(JSON.stringify(output ?? null))) : output;
            } catch (error) {
              if (!privacy) throw error;
              console.error("Anonymous scheduler tool failed", error);
              const output={ok:false,error:"The scheduler tool failed. Check the website before retrying; a successful change was not confirmed."};
              onResult?.({toolName:name,input:localInput,output});
              return output;
            }
          },
        }
      : {}),
  };

  return aiTool(adapted as any);
}

export function adaptSchedulerToolsForPaid(
  registry: SchedulerToolRegistry,
  privacy?: SchedulerPrivacy,
  onResult?:ResultObserver
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(registry).map(([name, definition]) => [
      name,
      adaptTool(name, definition, privacy, onResult),
    ])
  );
}
