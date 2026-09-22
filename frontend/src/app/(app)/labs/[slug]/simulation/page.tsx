"use client";
import { useParams } from "next/navigation";
import { SimulationLab } from "@/components/sim/SimulationLab";

export default function SimulationPage() {
  const { slug } = useParams<{ slug: string }>();
  return <SimulationLab slug={slug} />;
}
