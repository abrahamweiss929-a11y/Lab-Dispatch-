"use client";

import { useRouter } from "next/navigation";
import { MapView, type MapPin } from "@/components/Map";

interface OfficesMapProps {
  pins: MapPin[];
  height?: string;
}

export function OfficesMap({ pins, height }: OfficesMapProps) {
  const router = useRouter();
  return (
    <MapView
      pins={pins}
      height={height}
      onPinClick={(id) => router.push(`/admin/offices/${id}`)}
    />
  );
}
