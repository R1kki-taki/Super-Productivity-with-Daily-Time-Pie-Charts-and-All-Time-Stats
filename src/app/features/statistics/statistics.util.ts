import { Task } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { hslToHex, isValidHexColor, normalizeHexColor } from '../../util/color.util';

export interface TaskTimeSlice {
  /** Normalized title, used to merge tasks that share a name. */
  key: string;
  /** Title as first encountered (original casing, trimmed). */
  label: string;
  /** Milliseconds. */
  value: number;
}

export interface SameNameTotal {
  key: string;
  title: string;
  totalTimeSpent: number;
  taskCount: number;
}

/** A pie slice: one same-name group for the selected day, or the folded remainder. */
export interface PieSlice {
  /** Normalized task title, or `OTHER_SLICE_KEY` for the remainder slice. */
  key: string;
  label: string;
  /** Milliseconds. */
  value: number;
}

/** Key of the single slice that folds every cut-off task name. Not a task name. */
export const OTHER_SLICE_KEY = '__other__';

/** Per-slice color choices, keyed the same way as `PieSlice.key`. */
export type TaskColorOverrides = Record<string, string>;

/**
 * One day of a per-task heatmap. Structurally identical to the `heatmap` UI
 * component's `DayData`, redeclared here so this module stays a pure util.
 */
export interface TaskHeatmapDay {
  date: Date;
  dateStr: string;
  taskCount: number;
  timeSpent: number;
  /** 0–4 color intensity. */
  level: number;
}

export interface TaskHeatmapWeek {
  days: (TaskHeatmapDay | null)[];
}

export interface TaskHeatmapData {
  weeks: TaskHeatmapWeek[];
  monthLabels: string[];
}

/**
 * Same-name detection ignores casing and surrounding whitespace, because the
 * same logical task re-appears with a fresh id on every repeat and users do not
 * retype the capitalisation identically.
 */
export const normalizeTaskTitle = (title: string): string => title.trim().toLowerCase();

/** Guard for titles that carry no information (freshly created, untitled tasks). */
const isTitled = (title: string): boolean => title.trim().length > 0;

/**
 * Time spent per task name on a single day, longest first.
 *
 * Aggregating by name rather than by id keeps the chart legend readable: a
 * repeated task has a new id every instance, so id-based slices would all read
 * the same. Days with no tracked time produce an empty array.
 */
export const getTimeSlicesForDay = (
  tasks: readonly Task[],
  dayStr: string,
): TaskTimeSlice[] => {
  const byKey = new Map<string, TaskTimeSlice>();

  for (const task of tasks) {
    const value = task.timeSpentOnDay?.[dayStr];
    if (!value || !isTitled(task.title)) {
      continue;
    }

    const key = normalizeTaskTitle(task.title);
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing
        ? { ...existing, value: existing.value + value }
        : { key, label: task.title.trim(), value },
    );
  }

  return [...byKey.values()].sort((a, b) => b.value - a.value);
};

/**
 * Lifetime time spent per task name, longest first. Not limited to tracked days,
 * so a task that was only ever paused mid-session still shows up.
 */
export const getSameNameTotals = (tasks: readonly Task[]): SameNameTotal[] => {
  const byKey = new Map<string, SameNameTotal>();

  for (const task of tasks) {
    if (!isTitled(task.title)) {
      continue;
    }

    const key = normalizeTaskTitle(task.title);
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing
        ? {
            ...existing,
            totalTimeSpent: existing.totalTimeSpent + task.timeSpent,
            taskCount: existing.taskCount + 1,
          }
        : { key, title: task.title.trim(), totalTimeSpent: task.timeSpent, taskCount: 1 },
    );
  }

  return [...byKey.values()].sort((a, b) => b.totalTimeSpent - a.totalTimeSpent);
};

/**
 * Per-day time for one same-name group between two dates, as the `heatmap` UI
 * component wants it. Only tasks whose name matches `key` count, so the grid
 * reflects a single task rather than all tracked activity. Every day in the
 * range is seeded so gaps render as empty cells; `hasData` is false when the
 * group never tracked time, letting the caller show an empty state.
 */
export const getTaskHeatmapDayMap = (
  tasks: readonly Task[],
  key: string,
  startDate: Date,
  endDate: Date,
): { dayMap: Map<string, TaskHeatmapDay>; hasData: boolean } => {
  const dayMap = new Map<string, TaskHeatmapDay>();
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateStr = getDbDateStr(cursor);
    dayMap.set(dateStr, {
      date: new Date(cursor),
      dateStr,
      taskCount: 0,
      timeSpent: 0,
      level: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const taskIdsPerDay = new Map<string, Set<string>>();
  let maxTime = 0;
  let hasData = false;

  for (const task of tasks) {
    if (normalizeTaskTitle(task.title) !== key) {
      continue;
    }
    const perDay = task.timeSpentOnDay ?? {};
    for (const dateStr of Object.keys(perDay)) {
      const timeSpent = perDay[dateStr];
      const day = dayMap.get(dateStr);
      if (!day || !(timeSpent > 0)) {
        continue;
      }
      day.timeSpent += timeSpent;
      maxTime = Math.max(maxTime, day.timeSpent);
      hasData = true;
      const ids = taskIdsPerDay.get(dateStr) ?? new Set<string>();
      ids.add(task.id);
      taskIdsPerDay.set(dateStr, ids);
    }
  }

  for (const [dateStr, ids] of taskIdsPerDay) {
    const day = dayMap.get(dateStr);
    if (day) {
      day.taskCount = ids.size;
    }
  }

  for (const day of dayMap.values()) {
    day.level = maxTime > 0 ? getHeatmapLevel(day.timeSpent / maxTime) : 0;
  }

  return { dayMap, hasData };
};

const getHeatmapLevel = (ratio: number): number => {
  if (!(ratio > 0)) {
    return 0;
  }
  if (ratio > 0.75) {
    return 4;
  }
  if (ratio > 0.5) {
    return 3;
  }
  if (ratio > 0.25) {
    return 2;
  }
  return 1;
};

/**
 * Lays the day map out as calendar weeks, padding the first and last week with
 * `null` days so the grid is rectangular. `firstDayOfWeek` and `monthNames`
 * come from the app's `DateAdapter`, keeping this pure.
 */
export const buildHeatmapWeeks = (
  dayMap: ReadonlyMap<string, TaskHeatmapDay>,
  startDate: Date,
  endDate: Date,
  firstDayOfWeek: number,
  monthNames: readonly string[],
): TaskHeatmapData => {
  const weeks: TaskHeatmapWeek[] = [];
  const monthLabels: string[] = [];
  let currentMonth = -1;

  const firstDay = new Date(startDate);
  const daysToGoBack = (firstDay.getDay() - firstDayOfWeek + 7) % 7;
  firstDay.setDate(firstDay.getDate() - daysToGoBack);

  const cursor = new Date(firstDay);
  let weekCount = 0;

  while (cursor <= endDate || weeks.length === 0) {
    const week: TaskHeatmapWeek = { days: [] };

    for (let i = 0; i < 7; i++) {
      const dateStr = getDbDateStr(cursor);
      const dayData = dayMap.get(dateStr);

      if (cursor >= startDate && cursor <= endDate) {
        week.days.push(dayData ?? null);

        const month = cursor.getMonth();
        if (month !== currentMonth && cursor.getDate() <= 7 && weekCount > 0) {
          monthLabels.push(monthNames[month]);
          currentMonth = month;
        } else if (monthLabels.length === 0 && weekCount === 0) {
          monthLabels.push(monthNames[month]);
          currentMonth = month;
        }
      } else {
        week.days.push(null);
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push(week);
    weekCount++;

    if (weeks.length > 54) {
      break;
    }
  }

  return { weeks, monthLabels };
};

/**
 * Caps a sorted slice list at `maxSlices` entries, folding the tail into a
 * single remainder. `maxSlices` counts the remainder slice: when truncation is
 * needed, `maxSlices - 1` named slices survive and the rest are summed into
 * `otherTotal` (0 when nothing was folded).
 */
export const limitTimeSlices = (
  slices: readonly TaskTimeSlice[],
  maxSlices: number,
): { topSlices: TaskTimeSlice[]; otherTotal: number } => {
  if (slices.length <= maxSlices) {
    return { topSlices: [...slices], otherTotal: 0 };
  }

  const otherTotal = slices
    .slice(maxSlices - 1)
    .reduce((sum, slice) => sum + slice.value, 0);

  return { topSlices: slices.slice(0, maxSlices - 1), otherTotal };
};

/**
 * Builds the pie slices for one day: same-name groups, longest first, capped so
 * the legend stays readable. Anything cut off is folded into a single remainder
 * slice carrying `OTHER_SLICE_KEY` and `otherLabel`.
 */
export const buildPieSlices = (
  tasks: readonly Task[],
  dayStr: string,
  otherLabel: string,
  maxSlices: number,
): PieSlice[] => {
  const { topSlices, otherTotal } = limitTimeSlices(
    getTimeSlicesForDay(tasks, dayStr),
    maxSlices,
  );

  const slices: PieSlice[] = topSlices.map((slice) => ({
    key: slice.key,
    label: slice.label,
    value: slice.value,
  }));

  if (otherTotal > 0) {
    slices.push({ key: OTHER_SLICE_KEY, label: otherLabel, value: otherTotal });
  }

  return slices;
};

/**
 * One color per slice: the user's override when there is one, otherwise the
 * generated default for that position. Applying overrides by key keeps a task's
 * color stable as slices appear, drop off or reorder between days.
 */
export const getSliceColors = (
  slices: readonly PieSlice[],
  overrides: Readonly<TaskColorOverrides>,
): string[] => {
  const defaults = getPieColors(slices.length);
  return slices.map((slice, i) => overrides[slice.key] ?? defaults[i]);
};

/** Keeps only well-formed hex entries, so a corrupt or stale store can't poison the UI. */
export const sanitizeColorOverrides = (value: unknown): TaskColorOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const overrides: TaskColorOverrides = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (typeof color === 'string' && isValidHexColor(color)) {
      overrides[key] = normalizeHexColor(color);
    }
  }
  return overrides;
};

/** A value's share of the bar scale, clamped to 0–100 so a stale scale can't overflow. */
export const getBarPercent = (value: number, scaleMax: number): number => {
  if (!(scaleMax > 0) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / scaleMax) * 100));
};

/**
 * Distinct, evenly spread pie colors in hex. Steps by the golden angle so
 * neighbours stay distinguishable at any slice count — a fixed hue step
 * degenerates once the slice count is not a divisor of 360. Hex (not `hsl()`)
 * because the same string feeds the color input and the code field.
 */
export const getPieColors = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => hslToHex((i * 137.508) % 360, 65, 55));
