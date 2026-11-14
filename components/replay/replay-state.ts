import type { SimEvent } from "@/lib/sim/contracts";

export function replayAt(events: readonly SimEvent[], minute: number) {
  const arrivals = new Map<string, Extract<SimEvent, { type: "arrival" }>>();
  const waiting = new Set<string>();
  const serving = new Map<string, number>();
  let served = 0;
  let left = 0;

  for (const event of events) {
    if (event.timeMin > minute) break;
    const { customerId } = event;
    switch (event.type) {
      case "arrival":
        arrivals.set(customerId, event);
        if (event.decision === "leave") left++;
        break;
      case "queue_entry":
        waiting.add(customerId);
        break;
      case "service_start":
        waiting.delete(customerId);
        serving.set(customerId, event.stationIndex);
        break;
      case "completion":
        serving.delete(customerId);
        served++;
        break;
      case "abandonment":
        waiting.delete(customerId);
        left++;
        break;
    }
  }

  return {
    arrivals,
    waiting: [...waiting],
    serving: [...serving],
    served,
    left,
  };
}
