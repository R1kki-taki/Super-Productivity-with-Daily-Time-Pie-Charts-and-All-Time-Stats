import { Task } from '../tasks/task.model';
import {
  buildPieSlices,
  getBarPercent,
  getBarScaleMax,
  getPieColors,
  getSameNameTotals,
  getSliceColors,
  getTimeSlicesForDay,
  isValidHexColor,
  limitTimeSlices,
  normalizeHexColor,
  normalizeTaskTitle,
  OTHER_SLICE_KEY,
  sanitizeColorOverrides,
} from './statistics.util';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: 'Task',
    timeSpent: 0,
    timeSpentOnDay: {},
    subTaskIds: [],
    tagIds: [],
    ...overrides,
  }) as Task;

// ISO date literals are rejected as object-literal property names by the repo's
// naming-convention rule, so the day keys go through computed names.
const DAY = '2026-03-15';
const OTHER_DAY = '2026-03-14';

describe('normalizeTaskTitle', () => {
  it('should ignore casing and surrounding whitespace', () => {
    expect(normalizeTaskTitle('  Stand Up  ')).toBe('stand up');
  });
});

describe('getTimeSlicesForDay', () => {
  it('should return an empty array for no tasks', () => {
    expect(getTimeSlicesForDay([], DAY)).toEqual([]);
  });

  it('should only include tasks with time tracked on that day', () => {
    const tasks = [
      createTask({ id: 'a', title: 'Tracked', timeSpentOnDay: { [DAY]: 60000 } }),
      createTask({
        id: 'b',
        title: 'Other day',
        timeSpentOnDay: { [OTHER_DAY]: 60000 },
      }),
      createTask({ id: 'c', title: 'Never tracked', timeSpentOnDay: {} }),
    ];

    expect(getTimeSlicesForDay(tasks, DAY)).toEqual([
      { key: 'tracked', label: 'Tracked', value: 60000 },
    ]);
  });

  it('should tolerate a task without timeSpentOnDay', () => {
    const tasks = [createTask({ title: 'Legacy', timeSpentOnDay: undefined as never })];
    expect(getTimeSlicesForDay(tasks, DAY)).toEqual([]);
  });

  it('should merge same-name tasks and keep the first casing', () => {
    const tasks = [
      createTask({ id: 'a', title: 'Standup', timeSpentOnDay: { d: 60000 } }),
      createTask({ id: 'b', title: '  standup ', timeSpentOnDay: { d: 120000 } }),
    ];

    expect(getTimeSlicesForDay(tasks, 'd')).toEqual([
      { key: 'standup', label: 'Standup', value: 180000 },
    ]);
  });

  it('should sort by descending time spent', () => {
    const tasks = [
      createTask({ id: 'a', title: 'Small', timeSpentOnDay: { d: 1000 } }),
      createTask({ id: 'b', title: 'Big', timeSpentOnDay: { d: 5000 } }),
      createTask({ id: 'c', title: 'Middle', timeSpentOnDay: { d: 3000 } }),
    ];

    expect(getTimeSlicesForDay(tasks, 'd').map((slice) => slice.label)).toEqual([
      'Big',
      'Middle',
      'Small',
    ]);
  });

  it('should skip untitled tasks', () => {
    const tasks = [
      createTask({ id: 'a', title: '   ', timeSpentOnDay: { d: 1000 } }),
      createTask({ id: 'b', title: 'Kept', timeSpentOnDay: { d: 1000 } }),
    ];

    expect(getTimeSlicesForDay(tasks, 'd').map((slice) => slice.label)).toEqual(['Kept']);
  });
});

describe('getSameNameTotals', () => {
  it('should sum lifetime time per name across projects and days', () => {
    const tasks = [
      createTask({ id: 'a', title: 'Standup', timeSpent: 60000 }),
      createTask({ id: 'b', title: 'standup', timeSpent: 90000 }),
      createTask({ id: 'c', title: 'Report', timeSpent: 10000 }),
    ];

    expect(getSameNameTotals(tasks)).toEqual([
      { key: 'standup', title: 'Standup', totalTimeSpent: 150000, taskCount: 2 },
      { key: 'report', title: 'Report', totalTimeSpent: 10000, taskCount: 1 },
    ]);
  });

  it('should include tasks that were never tracked on a day', () => {
    const tasks = [createTask({ title: 'Paused', timeSpent: 5000, timeSpentOnDay: {} })];
    expect(getSameNameTotals(tasks).length).toBe(1);
  });

  it('should skip untitled tasks', () => {
    const tasks = [createTask({ title: ' \t ' }), createTask({ id: 'b', title: 'Kept' })];
    expect(getSameNameTotals(tasks).map((entry) => entry.title)).toEqual(['Kept']);
  });

  it('should return an empty array for no tasks', () => {
    expect(getSameNameTotals([])).toEqual([]);
  });
});

describe('limitTimeSlices', () => {
  const slices = [
    { key: 'a', label: 'A', value: 10 },
    { key: 'b', label: 'B', value: 8 },
    { key: 'c', label: 'C', value: 6 },
    { key: 'd', label: 'D', value: 4 },
  ];

  it('should pass everything through when within the limit', () => {
    expect(limitTimeSlices(slices, 4)).toEqual({ topSlices: slices, otherTotal: 0 });
    expect(limitTimeSlices(slices, 9).otherTotal).toBe(0);
  });

  it('should fold the tail so the named slices plus the remainder stay within the limit', () => {
    const result = limitTimeSlices(slices, 3);

    expect(result.topSlices.map((slice) => slice.label)).toEqual(['A', 'B']);
    expect(result.otherTotal).toBe(10);
    expect(result.topSlices.length + 1).toBe(3);
  });

  it('should not mutate the input', () => {
    limitTimeSlices(slices, 2);
    expect(slices.map((slice) => slice.label)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('getPieColors', () => {
  it('should return one color per slice', () => {
    expect(getPieColors(5).length).toBe(5);
    expect(getPieColors(0)).toEqual([]);
  });

  it('should return distinct colors', () => {
    expect(new Set(getPieColors(12)).size).toBe(12);
  });

  it('should return colors a native color input accepts (#rrggbb)', () => {
    for (const color of getPieColors(12)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('buildPieSlices', () => {
  it('should return slices ordered by time and fold the tail into one remainder', () => {
    const tasks = [
      createTask({ id: 'a', title: 'A', timeSpentOnDay: { d: 40 } }),
      createTask({ id: 'b', title: 'B', timeSpentOnDay: { d: 30 } }),
      createTask({ id: 'c', title: 'C', timeSpentOnDay: { d: 20 } }),
      createTask({ id: 'd', title: 'D', timeSpentOnDay: { d: 10 } }),
    ];

    const slices = buildPieSlices(tasks, 'd', 'Other', 3);

    expect(slices).toEqual([
      { key: 'a', label: 'A', value: 40 },
      { key: 'b', label: 'B', value: 30 },
      { key: OTHER_SLICE_KEY, label: 'Other', value: 30 },
    ]);
  });

  it('should omit the remainder slice when everything fits', () => {
    const tasks = [createTask({ id: 'a', title: 'A', timeSpentOnDay: { d: 40 } })];

    expect(buildPieSlices(tasks, 'd', 'Other', 12)).toEqual([
      { key: 'a', label: 'A', value: 40 },
    ]);
  });
});

describe('getSliceColors', () => {
  const slices = [
    { key: 'a', label: 'A', value: 40 },
    { key: 'b', label: 'B', value: 30 },
  ];

  it('should fall back to the generated default when there is no override', () => {
    expect(getSliceColors(slices, {})).toEqual(getPieColors(2));
  });

  it('should apply an override by key and keep the default elsewhere', () => {
    const colors = getSliceColors(slices, { b: '#123456' });
    expect(colors[0]).toBe(getPieColors(2)[0]);
    expect(colors[1]).toBe('#123456');
  });
});

describe('isValidHexColor / normalizeHexColor', () => {
  it('should accept 3- and 6-digit hex regardless of case', () => {
    expect(isValidHexColor('#abc')).toBe(true);
    expect(isValidHexColor('#AABBCC')).toBe(true);
    expect(isValidHexColor(' #aabbcc ')).toBe(true);
    expect(isValidHexColor('aabbcc')).toBe(false);
    expect(isValidHexColor('#aabbc')).toBe(false);
  });

  it('should expand 3-digit and lowercase', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('  #A1B2C3 ')).toBe('#a1b2c3');
  });
});

describe('sanitizeColorOverrides', () => {
  it('should keep only well-formed hex entries and normalize them', () => {
    expect(
      sanitizeColorOverrides({ a: '#ABC', b: 'red', c: '#123456', d: 5, e: null }),
    ).toEqual({ a: '#aabbcc', c: '#123456' });
  });

  it('should return an empty object for junk', () => {
    expect(sanitizeColorOverrides(null)).toEqual({});
    expect(sanitizeColorOverrides('nope')).toEqual({});
    expect(sanitizeColorOverrides(['#123456'])).toEqual({});
  });
});

describe('getBarScaleMax', () => {
  it('should round the max up within its own order of magnitude', () => {
    expect(getBarScaleMax(12_345_678)).toBe(20_000_000);
    expect(getBarScaleMax(150)).toBe(200);
    expect(getBarScaleMax(5)).toBe(5);
    expect(getBarScaleMax(1_000_000)).toBe(1_000_000);
    expect(getBarScaleMax(999_999)).toBe(1_000_000);
  });

  it('should return 0 for no/zero/negative input', () => {
    expect(getBarScaleMax(0)).toBe(0);
    expect(getBarScaleMax(-5)).toBe(0);
    expect(getBarScaleMax(Number.NaN)).toBe(0);
  });
});

describe('getBarPercent', () => {
  it('should size a value against the scale', () => {
    expect(getBarPercent(50, 200)).toBe(25);
    expect(getBarPercent(200, 200)).toBe(100);
  });

  it('should clamp and guard a zero scale', () => {
    expect(getBarPercent(400, 200)).toBe(100);
    expect(getBarPercent(-1, 200)).toBe(0);
    expect(getBarPercent(10, 0)).toBe(0);
  });
});
