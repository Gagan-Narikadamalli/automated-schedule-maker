import type { NativeSchedulerPlan } from "./schedulerNativeAi";

export type NativeShadowEvaluation = {
  nativeIntent: string;
  nativeTool: string;
  nativeConfidence: number;
  nativeInput: Record<string, unknown>;
  nativeAgreement: boolean | null;
};

export function evaluateNativeShadowPlan(
  plan: NativeSchedulerPlan,
  gatewayToolsUsed: string[]
): NativeShadowEvaluation {
  const executable =
    !plan.toolName.startsWith("__native_") &&
    plan.intent !== "CLARIFICATION";

  const firstGatewayTool = gatewayToolsUsed[0] || "";
  const nativeAgreement =
    executable && firstGatewayTool
      ? firstGatewayTool === plan.toolName
      : null;

  return {
    nativeIntent: plan.intent,
    nativeTool: plan.toolName,
    nativeConfidence: plan.confidence,
    nativeInput: plan.input,
    nativeAgreement,
  };
}
