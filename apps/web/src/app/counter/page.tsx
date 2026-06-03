import CounterView from "./_components/counter-view";

export default function CounterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Contador Simple</h1>
      <CounterView />
    </main>
  );
}
