import { Task } from '../tasks/task.model';

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

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for the 3- or 6-digit hex forms the color code field accepts. */
export const isValidHexColor = (value: string): boolean =>
  HEX_COLOR_RE.test(value.trim());

/**
 * Normalizes an accepted color to the lowercase `#rrggbb` the color input
 * requires: the input silently shows black for `#rgb` or upper-case values.
 */
export const normalizeHexColor = (value: string): string => {
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return color;
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

/**
 * The full-width value of the cumulative-time bars: the longest total rounded up
 * to the next round step within its own order of magnitude (1.23h → 2h, 12.3m →
 * 20m), so the bars read at a glance instead of hugging 100%.
 */
export const getBarScaleMax = (maxValue: number): number => {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  return Math.ceil(maxValue / magnitude) * magnitude;
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

const hslToHex = (h: number, s: number, l: number): string => {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const twoL = 2 * lNorm;
  const c = (1 - Math.abs(twoL - 1)) * sNorm;
  const hue = h / 60;
  const x = c * (1 - Math.abs((hue % 2) - 1));

  let rgb: [number, number, number];
  if (hue < 1) {
    rgb = [c, x, 0];
  } else if (hue < 2) {
    rgb = [x, c, 0];
  } else if (hue < 3) {
    rgb = [0, c, x];
  } else if (hue < 4) {
    rgb = [0, x, c];
  } else if (hue < 5) {
    rgb = [x, 0, c];
  } else {
    rgb = [c, 0, x];
  }

  const halfC = c / 2;
  const m = lNorm - halfC;
  const toHex = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
};
