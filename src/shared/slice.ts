import type { Human } from "@mozaik-ai/core";
import type { FactoryRuntime } from "../bus/adapters/mozaik/runtime.js";
import type { Effect, TransitionRule } from "../bus/domain/transition.js";
import type { EffectContext, EffectRunner } from "../bus/ports/outbound/effect-runner.js";
import type { FactoryConfig } from "./config.js";
import type { ApiRoleRunner } from "./llm/api-role-runner.js";
import type { CliRoleRunner } from "./llm/cli-role-runner.js";
import type { PromptLibrary } from "./prompts.js";

export interface RunPaths {
  readonly repoRoot: string;
  readonly runDir: string;
  readonly productDir: string;
  readonly worktreesDir: string;
  readonly handoffsDir: string;
  readonly traceDir: string;
  readonly specSourcePath: string;
  readonly outputDir: string;
}

export interface SliceContext {
  readonly config: FactoryConfig;
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly push: boolean;
  readonly paths: RunPaths;
  readonly runtime: FactoryRuntime;
  readonly apiRoles: ApiRoleRunner;
  readonly cliRoles: CliRoleRunner;
  readonly prompts: PromptLibrary;
  readonly log: (line: string) => void;
  readonly now: () => Date;
}

export type EffectHandler = (effect: Effect, context: EffectContext, slice: SliceContext) => Promise<void>;

export interface Slice {
  readonly name: string;
  readonly rules: readonly TransitionRule[];
  readonly effects: Readonly<Record<string, EffectHandler>>;
  participants(context: SliceContext): readonly Human[];
}

export type SliceFactory = (context: SliceContext) => Slice;

export class UnknownEffectError extends Error {
  override readonly name = "UnknownEffectError";
}

export function composeEffectRunner(slices: readonly Slice[], context: SliceContext): EffectRunner {
  const handlers = new Map<string, EffectHandler>();
  for (const slice of slices) {
    for (const [kind, handler] of Object.entries(slice.effects)) {
      if (handlers.has(kind)) {
        throw new Error(`effect kind ${kind} declared by two slices`);
      }
      handlers.set(kind, handler);
    }
  }
  return {
    async run(effect, effectContext) {
      const handler = handlers.get(effect.kind);
      if (handler === undefined) {
        throw new UnknownEffectError(effect.kind);
      }
      await handler(effect, effectContext, context);
    },
  };
}

export function composeRules(slices: readonly Slice[]): readonly TransitionRule[] {
  const rules = slices.flatMap((slice) => slice.rules);
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.eventType)) {
      throw new Error(`event type ${rule.eventType} handled by two rules`);
    }
    seen.add(rule.eventType);
  }
  return rules;
}
