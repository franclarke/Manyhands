"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function CounterView() {
  const [count, setCount] = useState(0);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const savedCount = localStorage.getItem("simple-counter-value");
    if (savedCount !== null) {
      setCount(JSON.parse(savedCount));
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem("simple-counter-value", JSON.stringify(count));
    }
  }, [count, isClient]);

  const handleIncrement = () => {
    setCount((prevCount) => prevCount + 1);
  };

  const handleDecrement = () => {
    setCount((prevCount) => (prevCount > 0 ? prevCount - 1 : 0));
  };

  const handleReset = () => {
    setCount(0);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-6xl font-bold">{isClient ? count : 0}</div>
      <div className="flex gap-4">
        <Button onClick={handleDecrement}>Decrementar</Button>
        <Button onClick={handleIncrement}>Incrementar</Button>
      </div>
      <Button onClick={handleReset} variant="ghost">
        Resetear
      </Button>
    </div>
  );
}
