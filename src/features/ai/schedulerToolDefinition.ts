export type SchedulerJsonSchema<TInput> = Record<string, unknown> & {
  readonly __schedulerInputType?: TInput;
};

export type SchedulerToolExecutionOptions = {
  toolCallId?: string;
  messages?: unknown[];
};

export type SchedulerToolDefinition<TInput = any> = {
  description: string;
  inputSchema: SchedulerJsonSchema<TInput>;
  execute?: (
    input: TInput,
    options?: SchedulerToolExecutionOptions
  ) => unknown | Promise<unknown>;
};

export type SchedulerToolRegistry = Record<
  string,
  SchedulerToolDefinition<any>
>;

export function jsonSchema<TInput>(
  schema: Record<string, unknown>
): SchedulerJsonSchema<TInput> {
  return schema as SchedulerJsonSchema<TInput>;
}

export function tool<TInput>(
  definition: SchedulerToolDefinition<TInput>
): SchedulerToolDefinition<TInput> {
  return definition;
}
