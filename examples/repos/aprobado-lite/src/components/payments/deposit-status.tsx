import type { DepositStatus } from "../../payments/deposits/deposit-service";

export interface DepositStatusViewProps {
  status: DepositStatus;
  remainingCents: number;
}

export function DepositStatusView(props: DepositStatusViewProps): string {
  return `${props.status}: ${props.remainingCents}`;
}
