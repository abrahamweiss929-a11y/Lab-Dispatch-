"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  PRESET_LABEL,
  isPayrollPreset,
  type PayrollPreset,
} from "@/lib/payroll";

interface DateRangePickerProps {
  initialPreset: PayrollPreset;
  initialStartDate: string;
  initialEndDate: string;
}

const PRESET_ORDER: PayrollPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "custom",
];

export function DateRangePicker({
  initialPreset,
  initialStartDate,
  initialEndDate,
}: DateRangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preset, setPreset] = useState<PayrollPreset>(initialPreset);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [pending, startTransition] = useTransition();

  function navigate(nextPreset: PayrollPreset, nextStart: string, nextEnd: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("preset", nextPreset);
    if (nextPreset === "custom") {
      params.set("start", nextStart);
      params.set("end", nextEnd);
    } else {
      params.delete("start");
      params.delete("end");
    }
    startTransition(() => {
      router.push(`/admin/payroll?${params.toString()}`);
    });
  }

  function handlePresetChange(value: string) {
    if (!isPayrollPreset(value)) return;
    setPreset(value);
    if (value !== "custom") {
      navigate(value, "", "");
    }
  }

  function handleApplyCustom(e: React.FormEvent) {
    e.preventDefault();
    navigate("custom", startDate, endDate);
  }

  return (
    <form
      onSubmit={handleApplyCustom}
      noValidate
      className="app-card mb-6 flex flex-wrap items-end gap-3 p-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-bold uppercase tracking-wide text-[var(--muted)]">
          Range
        </span>
        <select
          name="preset"
          className="form-select"
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={pending}
        >
          {PRESET_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold uppercase tracking-wide text-[var(--muted)]">
              Start
            </span>
            <input
              type="date"
              name="start"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold uppercase tracking-wide text-[var(--muted)]">
              End
            </span>
            <input
              type="date"
              name="end"
              className="form-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={pending}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary disabled:opacity-60"
            disabled={pending}
          >
            {pending ? "Applying…" : "Apply"}
          </button>
        </>
      ) : null}
    </form>
  );
}
