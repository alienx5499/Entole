import type {
  AgentMessage,
  AgentModel,
  AgentToolSpec,
  ChatModel,
  ChatReply,
  ChatRequest,
  Taste,
  TasteRepository,
} from "@entole/shopping";

type AgentTurn = Awaited<ReturnType<AgentModel["next"]>>;

export class ScriptedAgentModel implements AgentModel {
  seen: { messages: AgentMessage[]; tools: AgentToolSpec[] }[] = [];
  constructor(private readonly turns: AgentTurn[]) {}

  async next(messages: AgentMessage[], tools: AgentToolSpec[]) {
    this.seen.push({ messages, tools });
    const turn = this.turns.shift();
    if (!turn) throw new Error("ScriptedAgentModel has no more turns");
    return turn;
  }
}

export class InMemoryTasteRepository implements TasteRepository {
  private readonly tastes = new Map<string, Taste>();
  async get(userId: string) {
    return this.tastes.get(userId) ?? null;
  }
  async save(userId: string, t: Taste) {
    this.tastes.set(userId, t);
  }
}

// Records every request and answers with the next scripted reply (or a fixed "ok").
export class ScriptedChatModel implements ChatModel {
  seen: ChatRequest[] = [];
  constructor(private readonly replies: (ChatReply | Error)[] = []) {}

  async complete(req: ChatRequest) {
    this.seen.push(req);
    const next = this.replies.shift() ?? {
      message: { role: "assistant" as const, content: "ok" },
      finish_reason: "stop",
    };
    if (next instanceof Error) throw next;
    return next;
  }
}
