import type { requestMagicLink } from "../../auth/magic-link/request-action";

export type MagicLinkRequest = {
  email: string;
};

export type MagicLinkRequestFormProps = {
  onSubmit: typeof requestMagicLink;
};

export function MagicLinkRequestForm(props: MagicLinkRequestFormProps): unknown {
  return props;
}
