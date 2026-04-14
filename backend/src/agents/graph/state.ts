import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  currentAgent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "router",
  }),
  userId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  userRole: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  orgScope: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  csvContext: Annotation<{
    fileId: string;
    fileName: string;
    columns: string[];
    rowCount: number;
  } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
