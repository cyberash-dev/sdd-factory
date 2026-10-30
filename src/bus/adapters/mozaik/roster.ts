import { createAgent, createHuman, type Participant } from "@mozaik-ai/core";
import { isProducer, PRODUCERS, type Producer } from "../../domain/envelope.js";

export const LANE_ROLES = ["test-writer", "implementer", "simple-fixer"] as const;
export type LaneRole = (typeof LANE_ROLES)[number];
const HUMAN_PRODUCERS: ReadonlySet<string> = new Set(["foreman", "assembler", "tracer"]);

/* A lane's unit is its task id for test-writer and implementer, and owner:unit (fixerLaneUnit, factory:CST-005 unit) for simple-fixer. */
export interface LaneParticipant {
  readonly role: LaneRole;
  readonly unit: string;
  readonly id: string;
}

export interface Membership {
  join(participant: Participant): void;
  leave(participant: Participant): void;
}

export function isLaneRole(producer: string): producer is LaneRole {
  return (LANE_ROLES as readonly string[]).includes(producer);
}

/* bus:BEH-007 (DLT-006): two owners fix the same unit independently, so the fixer lane is keyed by owner and unit. */
export function fixerLaneUnit(owner: string, unit: string): string {
  return `${owner}:${unit}`;
}

function fixUnitOf(laneUnit: string): string {
  return laneUnit.slice(laneUnit.indexOf(":") + 1);
}

function laneKey(role: LaneRole, unit: string): string {
  return `${role}:${unit}`;
}

function laneCapability(role: LaneRole, unit: string): string {
  return role === "simple-fixer" ? `unit:${fixUnitOf(unit)}` : `task:${unit}`;
}

/* bus:BEH-007: the payload field naming the lane that sent an event; null when the event cannot name one. */
export function laneUnitOf(role: LaneRole, payload: Readonly<Record<string, unknown>>): string | null {
  if (role === "simple-fixer") {
    const owner = payload["owner"];
    const unit = payload["unit"];
    return typeof owner === "string" && typeof unit === "string" ? fixerLaneUnit(owner, unit) : null;
  }
  const taskId = payload["taskId"];
  return typeof taskId === "string" ? taskId : null;
}

function rosterParticipant(producer: Producer): Participant {
  const capabilities = [`role:${producer}`];
  if (HUMAN_PRODUCERS.has(producer)) {
    return createHuman({ name: producer, capabilities, handlers: [] });
  }
  return createAgent({ name: producer, capabilities, instruction: `Factory role ${producer}. Each invocation runs as its own inference loop.`, tools: [], handlers: [] });
}

/* bus:BEH-007: one joined participant per producer name; lane roles join per task. */
export class ParticipantRoster {
  private readonly byProducer = new Map<Producer, Participant>();
  private readonly lanes = new Map<string, Participant>();

  constructor(private readonly membership: Membership) {
    for (const producer of PRODUCERS) {
      if (!isLaneRole(producer)) {
        const participant = rosterParticipant(producer);
        membership.join(participant);
        this.byProducer.set(producer, participant);
      }
    }
  }

  adopt(participant: Participant): void {
    const name = participant.getManifest().name;
    if (!isProducer(name) || isLaneRole(name)) {
      throw new Error(`cannot adopt participant ${name}: not a roster producer`);
    }
    const placeholder = this.byProducer.get(name);
    if (placeholder !== undefined) {
      this.membership.leave(placeholder);
    }
    this.membership.join(participant);
    this.byProducer.set(name, participant);
  }

  joinLane(role: LaneRole, unit: string): LaneParticipant {
    const participant = createAgent({
      name: role,
      capabilities: ["lane", laneCapability(role, unit)],
      instruction: `Factory lane ${role} for ${unit}. Its loop runs in a Claude Code subprocess.`,
      tools: [],
      handlers: [],
    });
    this.membership.join(participant);
    this.lanes.set(laneKey(role, unit), participant);
    return { role, unit, id: participant.getId() };
  }

  leaveLane(lane: LaneParticipant): void {
    const key = laneKey(lane.role, lane.unit);
    const participant = this.lanes.get(key);
    if (participant !== undefined && participant.getId() === lane.id) {
      this.membership.leave(participant);
      this.lanes.delete(key);
    }
  }

  senderIdOf(producer: Producer, payload: Readonly<Record<string, unknown>>): string | null {
    if (isLaneRole(producer)) {
      const unit = laneUnitOf(producer, payload);
      return unit === null ? null : (this.lanes.get(laneKey(producer, unit))?.getId() ?? null);
    }
    return this.byProducer.get(producer)?.getId() ?? null;
  }
}
