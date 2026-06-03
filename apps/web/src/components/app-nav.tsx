"use client";

import Link from "next/link";
import Image from "next/image";
import logotipo from "@/app/logotipo.png";

export function AppNav(): React.ReactElement {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--rule)",
        background: "rgba(15, 16, 18, 0.82)",
        backdropFilter: "blur(10px)"
      }}
    >
      <div className="mh-container flex h-[58px] items-center justify-center">
        <Link href="/" className="flex items-center">
          <Image
            src={logotipo}
            alt="ManyHands Logo"
            height={24}
            style={{ width: "auto", height: "24px" }}
            priority
          />
        </Link>
      </div>
    </header>
  );
}
