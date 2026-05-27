import type { handleMagicLinkCallback } from "../../app/auth/callback/route";

export type MagicLinkFeedback = {
  status: "idle" | "success" | "error";
  message: string;
};

export function MagicLinkFeedbackView(props: {
  feedback: MagicLinkFeedback;
  onCallback?: typeof handleMagicLinkCallback;
}): unknown {
  return props;
}
