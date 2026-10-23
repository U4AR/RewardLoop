import { dateWithin } from "./clock";

export type AcceptedDay = { date: string; goalVersion: number; rubricVersion: number };

export function qualifyingDistinctDays(input: {
  days: AcceptedDay[];
  goalVersion: number;
  rubricVersion: number;
  startDate: string;
  endDateExclusive: string;
}): string[] {
  return [...new Set(input.days
    .filter((day) => day.goalVersion === input.goalVersion && day.rubricVersion === input.rubricVersion)
    .map((day) => day.date)
    .filter((date) => dateWithin(date, input.startDate, input.endDateExclusive)))].sort();
}

export function isGoalQualified(input: Parameters<typeof qualifyingDistinctDays>[0] & { requiredDays: number }): boolean {
  return qualifyingDistinctDays(input).length >= input.requiredDays;
}

