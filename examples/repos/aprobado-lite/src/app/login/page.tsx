import { MagicLinkRequestForm } from "../../components/auth/magic-link-form";

export function LoginPage(): unknown {
  return MagicLinkRequestForm({
    onSubmit: async () => undefined
  });
}
