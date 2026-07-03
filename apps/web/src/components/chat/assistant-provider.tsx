import { useExternalStoreRuntime, AssistantRuntimeProvider, type AppendMessage, type ThreadMessage } from "@assistant-ui/react";
import { type ReactNode, useMemo, useState } from "react";
import type { RunEvent } from "@/lib/run-model/types";
import { buildThreadMessages, type MyMessage } from "./thread-messages";

export function ChatRuntimeProvider({
  children,
  events
}: {
  children: ReactNode;
  events: RunEvent[];
}): React.ReactElement {
  const [customMessages, setCustomMessages] = useState<MyMessage[]>([]);

  // Convert ManyHands RunEvents to assistant-ui messages (pure, tested in
  // tests/thread-messages.test.ts).
  const mappedMessages = useMemo(() => buildThreadMessages(events), [events]);

  const allMessages = useMemo(() => {
    return [...mappedMessages, ...customMessages];
  }, [mappedMessages, customMessages]);

  const adapter = useMemo(() => ({
    messages: allMessages,
    convertMessage: (message: MyMessage) => {
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      } as unknown as ThreadMessage;
    },
    // Appends the human's own message to the thread. The REAL side effect
    // (answering a planning question) is owned by the thread component, which
    // knows the pending decision; this provider never fakes a reply.
    onNew: async (message: AppendMessage) => {
      const userMsg: MyMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message.content.map((c) => {
          if (c.type === "text") return { type: "text", text: c.text };
          return { type: "text", text: "" };
        }),
        createdAt: new Date()
      };
      setCustomMessages((prev) => [...prev, userMsg]);
    }
  }), [allMessages]);

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
