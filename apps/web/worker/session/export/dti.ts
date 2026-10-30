import type { Event, Session } from "../types";
import { toConversation } from "../convert/index";

/** DTI "AI Conversation History" (schemas.pub/schemas/24, id.schemas.pub/o/DTI/ai-personal-history). */
export interface DtiConversation {
  details: { createdBy: string; createdAt: string; startTime: string; endTime: string; modality: "text" };
  identifiers: { name: string; identifier: string; type?: "email" }[];
  messages: { sentAt: string; sender: string; text: string }[];
}

const iso = (t: number) => new Date(Number.isFinite(t) && t > 0 ? t : 0).toISOString();

export function toDti(session: Session, events: Event[]): DtiConversation {
  const who = session.source.account ?? "user";
  const person = { name: who, identifier: who, ...(/^[^\s@]+@[^\s@]+$/.test(who) ? { type: "email" as const } : {}) };
  return {
    details: { createdBy: session.source.product, createdAt: iso(session.updatedAt), startTime: iso(session.createdAt), endTime: iso(session.updatedAt), modality: "text" },
    identifiers: [person],
    messages: toConversation(events).map((m) => ({ sentAt: iso(m.at || session.updatedAt), sender: m.role === "user" ? person.identifier : "AI", text: m.text })),
  };
}
