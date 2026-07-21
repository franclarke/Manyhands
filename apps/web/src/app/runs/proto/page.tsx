import { Logo } from "@/components/logo";

export default function ProtoIndexPage(): React.ReactElement {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      role="img"
      aria-label="ManyHands"
    >
      <Logo type="mark" className="h-16 w-16" />
    </div>
  );
}
