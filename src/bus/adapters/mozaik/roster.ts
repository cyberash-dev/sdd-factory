import { createAgent, createHuman, type Participant } from "@mozaik-ai/core";
import { isProducer, PRODUCERS, type Producer } from "../../domain/envelope.js";

export const LANE_ROLES = ["test-writer", "implementer"] as const;
export type LaneRole = (typeof LANE_ROLES)[number];
const HUMAN_PRODUCERS: ReadonlySet<string> = new Set(["foreman", "assembler", "tracer"]);

export interface LaneParticipant {
  readonly role: LaneRole;
  readonly taskId: string;
  readonly id: string;
}

export interface Membership {
  join(participant: Participant): void;
  leave(participant: Participant): void;
}

export function isLaneRole(producer: string): producer is LaneRole {
  return (LANE_ROLES as readonly string[]).includes(producer);
}

function laneKey(role: LaneRole, taskId: string): string {
  return `${role}:${taskId}`;
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

  joinLane(role: LaneRole, taskId: string): LaneParticipant {
    const participant = createAgent({
      name: role,
      capabilities: ["lane", `task:${taskId}`],
      instruction: `Factory lane ${role} for ${taskId}. Its loop runs in a Claude Code subprocess.`,
      tools: [],
      handlers: [],
    });
    this.membership.join(participant);
    this.lanes.set(laneKey(role, taskId), participant);
    return { role, taskId, id: participant.getId() };
  }

  leaveLane(lane: LaneParticipant): void {
    const key = laneKey(lane.role, lane.taskId);
    const participant = this.lanes.get(key);
    if (participant !== undefined && participant.getId() === lane.id) {
      this.membership.leave(participant);
      this.lanes.delete(key);
    }
  }

  senderIdOf(producer: Producer, taskId: string | null): string | null {
    if (isLaneRole(producer)) {
      return taskId === null ? null : (this.lanes.get(laneKey(producer, taskId))?.getId() ?? null);
    }
    return this.byProducer.get(producer)?.getId() ?? null;
  }
}
