import { readFile } from "node:fs/promises";

export interface Caps {
  readonly lintCycles: number;
  readonly criticRounds: number;
  readonly implementerAttempts: number;
  readonly testWriterRework: number;
  readonly plannerRecuts: number;
  readonly architectRepairs: number;
  readonly criticAssumptionsPerId: number;
  readonly assemblyRounds: number;
  readonly handoffRerun: number;
}

export interface Timeouts {
  readonly specStageMs: number;
  readonly apiRoleMs: number;
  readonly cliRoleMs: number;
  readonly verifierMs: number;
  readonly shutdownMs: number;
}

export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

export interface RoleModels {
  readonly default: string;
  readonly critic: string;
  readonly triage: string;
  readonly lane: string | null;
}

export interface FactoryConfig {
  readonly caps: Caps;
  readonly timeouts: Timeouts;
  readonly maxParallelLanes: number;
  readonly models: RoleModels;
  readonly pricing: Readonly<Record<string, ModelPricing>>;
}

export const DEFAULT_CONFIG: FactoryConfig = {
  caps: {
    lintCycles: 5,
    criticRounds: 2,
    implementerAttempts: 3,
    testWriterRework: 1,
    plannerRecuts: 1,
    architectRepairs: 1,
    criticAssumptionsPerId: 1,
    assemblyRounds: 2,
    handoffRerun: 1,
  },
  timeouts: {
    specStageMs: 20 * 60 * 1000,
    apiRoleMs: 15 * 60 * 1000,
    cliRoleMs: 25 * 60 * 1000,
    verifierMs: 5 * 60 * 1000,
    shutdownMs: 10 * 1000,
  },
  maxParallelLanes: 4,
  models: {
    default: "claude-sonnet-5-5",
    critic: "claude-haiku-4-5",
    triage: "claude-haiku-4-5",
    lane: null,
  },
  pricing: {},
};

type Json = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(override: Json, key: string): Json {
  const value = override[key];
  return isRecord(value) ? value : {};
}

function pickInteger(source: Json, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function pickString(source: Json, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function pickStringOrNull(source: Json, key: string, fallback: string | null): string | null {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isPricing(value: unknown): value is ModelPricing {
  return isRecord(value) && typeof value["inputPerMillion"] === "number" && typeof value["outputPerMillion"] === "number";
}

export function mergeConfig(base: FactoryConfig, override: unknown): FactoryConfig {
  if (!isRecord(override)) {
    return base;
  }
  const caps = section(override, "caps");
  const timeouts = section(override, "timeouts");
  const models = section(override, "models");
  const pricing: Record<string, ModelPricing> = { ...base.pricing };
  for (const [model, price] of Object.entries(section(override, "pricing"))) {
    if (isPricing(price)) {
      pricing[model] = { inputPerMillion: price.inputPerMillion, outputPerMillion: price.outputPerMillion };
    }
  }
  return {
    caps: {
      lintCycles: pickInteger(caps, "lintCycles", base.caps.lintCycles),
      criticRounds: pickInteger(caps, "criticRounds", base.caps.criticRounds),
      implementerAttempts: pickInteger(caps, "implementerAttempts", base.caps.implementerAttempts),
      testWriterRework: pickInteger(caps, "testWriterRework", base.caps.testWriterRework),
      plannerRecuts: pickInteger(caps, "plannerRecuts", base.caps.plannerRecuts),
      architectRepairs: pickInteger(caps, "architectRepairs", base.caps.architectRepairs),
      criticAssumptionsPerId: pickInteger(caps, "criticAssumptionsPerId", base.caps.criticAssumptionsPerId),
      assemblyRounds: pickInteger(caps, "assemblyRounds", base.caps.assemblyRounds),
      handoffRerun: pickInteger(caps, "handoffRerun", base.caps.handoffRerun),
    },
    timeouts: {
      specStageMs: pickInteger(timeouts, "specStageMs", base.timeouts.specStageMs),
      apiRoleMs: pickInteger(timeouts, "apiRoleMs", base.timeouts.apiRoleMs),
      cliRoleMs: pickInteger(timeouts, "cliRoleMs", base.timeouts.cliRoleMs),
      verifierMs: pickInteger(timeouts, "verifierMs", base.timeouts.verifierMs),
      shutdownMs: pickInteger(timeouts, "shutdownMs", base.timeouts.shutdownMs),
    },
    maxParallelLanes: pickInteger(override, "maxParallelLanes", base.maxParallelLanes),
    models: {
      default: pickString(models, "default", base.models.default),
      critic: pickString(models, "critic", base.models.critic),
      triage: pickString(models, "triage", base.models.triage),
      lane: pickStringOrNull(models, "lane", base.models.lane),
    },
    pricing,
  };
}

export async function loadConfig(path: string): Promise<FactoryConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  const parsed: unknown = JSON.parse(text);
  return mergeConfig(DEFAULT_CONFIG, parsed);
}
