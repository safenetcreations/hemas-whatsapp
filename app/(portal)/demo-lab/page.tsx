import type { Metadata } from "next";
import { ScenarioRunner } from "@/components/demo-lab/scenario-runner";

export const metadata: Metadata = { title: "Demo Lab" };

export default function DemoLabPage() {
  return <ScenarioRunner />;
}
