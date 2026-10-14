import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ActiveElement, ChartData, ChartOptions } from 'chart.js';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { DateAdapter } from '@angular/material/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LazyChartComponent } from '../../features/metric/lazy-chart/lazy-chart.component';
import { DatePickerInputComponent } from '../../ui/date-picker-input/date-picker-input.component';
import { DayData, HeatmapComponent } from '../../ui/heatmap/heatmap.component';
import { MsToStringPipe, msToString } from '../../ui/duration/ms-to-string.pipe';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { StatisticsService } from '../../features/statistics/statistics.service';
import { DialogMergeTaskNameComponent } from '../../features/statistics/dialog-merge-task-name/dialog-merge-task-name.component';
import {
  DialogTaskDetailsComponent,
  DialogTaskDetailsResult,
} from '../../features/statistics/dialog-task-details/dialog-task-details.component';
import {
  buildPieSlices,
  buildHeatmapWeeks,
  getActivityHeatmapDayMap,
  getBarPercent,
  getPieColors,
  getSameNameTotals,
  getSliceColors,
  normalizeTaskTitle,
  OTHER_SLICE_KEY,
  PieSlice,
  SameNameTotal,
  sanitizeColorOverrides,
  TaskColorOverrides,
  TaskHeatmapData,
} from '../../features/statistics/statistics.util';
import { Task } from '../../features/tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { SnackService } from '../../core/snack/snack.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { loadFromRealLs, saveToRealLs } from '../../core/persistence/local-storage';
import { Log } from '../../core/log';
import { T } from '../../t.const';

/** Named slices are capped so the legend stays readable; the tail becomes one "other" slice. */
const MAX_PIE_SLICES = 12;

const EMPTY_PIE_CHART: ChartData<'pie', number[], string> = {
  labels: [],
  datasets: [],
};

const loadColorOverrides = (): TaskColorOverrides => {
  try {
    return sanitizeColorOverrides(loadFromRealLs(LS.STATISTICS_TASK_COLORS));
  } catch (e) {
    Log.err('Statistics: could not read saved slice colors', e);
    return {};
  }
};

const saveColorOverrides = (overrides: TaskColorOverrides): void => {
  try {
    saveToRealLs(LS.STATISTICS_TASK_COLORS, overrides);
  } catch (e) {
    Log.err('Statistics: could not save slice colors', e);
  }
};

@Component({
  selector: 'statistics-page',
  templateUrl: './statistics-page.component.html',
  styleUrls: ['./statistics-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    MatIcon,
    MatIconButton,
    MatTooltip,
    MatFormFieldModule,
    MatSelectModule,
    TranslatePipe,
    LazyChartComponent,
    DatePickerInputComponent,
    MsToStringPipe,
    HeatmapComponent,
  ],
})
export class StatisticsPageComponent {
  readonly T = T;

  private readonly _statisticsService = inject(StatisticsService);
  private readonly _translateService = inject(TranslateService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _dateAdapter = inject(DateAdapter);

  readonly isMerging = signal(false);

  /** A fresh date would be a new object on every change detection run. */
  readonly maxDay = new Date();

  readonly selectedDay = signal<Date>(new Date());
  readonly dayStr = computed(() => getDbDateStr(this.selectedDay()));

  private readonly _allTasks = toSignal(
    this._statisticsService.allTasksIncludingArchive$,
    { initialValue: [] as Task[] },
  );

  private readonly _langChange = toSignal(this._translateService.onLangChange, {
    initialValue: null,
  });

  /** Emits whenever the date locale changes so locale-derived labels re-compute. */
  private readonly _localeChange = toSignal(this._dateAdapter.localeChanges, {
    initialValue: null,
  });

  private readonly _userSelectedYear = signal<number | null>(null);

  /** Years that have any tracked time, newest first. */
  readonly availableYears = computed(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();
    for (const task of this._allTasks()) {
      for (const dateStr of Object.keys(task.timeSpentOnDay ?? {})) {
        const year = Number(dateStr.slice(0, 4));
        if (year > 0 && year <= currentYear) {
          years.add(year);
        }
      }
    }
    return [...years].sort((a, b) => b - a);
  });

  /** The user's pick while it is still valid, otherwise the most recent year with data. */
  readonly selectedYear = computed(() => {
    const userSelection = this._userSelectedYear();
    const years = this.availableYears();
    if (userSelection !== null && years.includes(userSelection)) {
      return userSelection;
    }
    return years.length > 0 ? years[0] : new Date().getFullYear();
  });

  /** All tracked time for the selected year, as the top-of-page activity heatmap. */
  readonly activityHeatmapData = computed<TaskHeatmapData>(() => {
    this._localeChange();
    const year = this.selectedYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    const { dayMap } = getActivityHeatmapDayMap(this._allTasks(), startDate, endDate);
    return buildHeatmapWeeks(
      dayMap,
      startDate,
      endDate,
      this._dateAdapter.getFirstDayOfWeek(),
      this._dateAdapter.getMonthNames('short'),
    );
  });

  onYearChange(year: number): void {
    this._userSelectedYear.set(year);
  }

  /** Picking a day on the heatmap drives the pie chart and task table below. */
  onHeatmapDayClick(day: DayData): void {
    this.selectedDay.set(day.date);
  }

  /** Pie colors the user picked, keyed by normalized task name. Device-local. */
  readonly sliceColorOverrides = signal<TaskColorOverrides>(loadColorOverrides());

  readonly pieSlices = computed<PieSlice[]>(() => {
    // Read so the remainder slice's label is re-translated on language change.
    this._langChange();
    return buildPieSlices(
      this._allTasks(),
      this.dayStr(),
      this._translateService.instant(T.F.STATISTICS.OTHER),
      MAX_PIE_SLICES,
    );
  });

  readonly pieChartData = computed<ChartData<'pie', number[], string>>(() => {
    const slices = this.pieSlices();
    if (!slices.length) {
      return EMPTY_PIE_CHART;
    }

    return {
      labels: slices.map((slice) => slice.label),
      datasets: [
        {
          data: slices.map((slice) => slice.value),
          backgroundColor: getSliceColors(slices, this.sliceColorOverrides()),
        },
      ],
    };
  });

  readonly totalForDay = computed(() =>
    (this.pieChartData().datasets[0]?.data ?? []).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    ),
  );

  readonly sameNameTotals = computed(() => getSameNameTotals(this._allTasks()));

  /**
   * Each cumulative row plus its bar width. The bar is the row's share of all
   * tracked time, so the whole column reads as a percentage breakdown instead of
   * being scaled to the longest row.
   */
  readonly sameNameRows = computed(() => {
    const totals = this.sameNameTotals();
    const scaleMax = totals.reduce((sum, row) => sum + row.totalTimeSpent, 0);
    return totals.map((row) => ({
      row,
      barPercent: getBarPercent(row.totalTimeSpent, scaleMax),
    }));
  });

  readonly pieChartOptions: ChartOptions<'pie'> = {
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = typeof ctx.parsed === 'number' ? ctx.parsed : 0;
            const total = (ctx.dataset.data as number[]).reduce(
              (sum, entry) => sum + (entry ?? 0),
              0,
            );
            const percent = total > 0 ? Math.round((value / total) * 100) : 0;
            return `${ctx.label}: ${msToString(value)} (${percent}%)`;
          },
        },
      },
    },
  };

  onDayChange(date: Date | null): void {
    this.selectedDay.set(date ?? new Date());
  }

  refresh(): void {
    this._statisticsService.refresh();
  }

  /** Opens the details dialog for the slice the user clicked on the pie. */
  onPieSliceClick(event: { active: ActiveElement[] }): void {
    const index = event.active[0]?.index;
    if (typeof index !== 'number') {
      return;
    }
    const slice = this.pieSlices()[index];
    if (!slice) {
      return;
    }
    void this.openTaskDetails(slice.key, slice.label);
  }

  /**
   * Opens the heatmap / color / rename dialog for one same-name group. The
   * folded remainder slice has no task behind it, so it is skipped.
   */
  async openTaskDetails(key: string, title: string): Promise<void> {
    if (key === OTHER_SLICE_KEY) {
      return;
    }

    const result = (await firstValueFrom(
      this._matDialog
        .open(DialogTaskDetailsComponent, {
          restoreFocus: true,
          data: {
            key,
            title,
            dayStr: this.dayStr(),
            color: this.sliceColorOverrides()[key] ?? null,
            defaultColor: this._defaultColorFor(key),
          },
        })
        .afterClosed(),
    )) as DialogTaskDetailsResult | undefined;

    if (!result) {
      return;
    }

    await this._applyTaskDetails(result);
  }

  /** Stored color if the user set one, otherwise the color the slice would use. */
  private _defaultColorFor(key: string): string {
    const slices = this.pieSlices();
    const index = slices.findIndex((slice) => slice.key === key);
    const defaults = getPieColors(Math.max(slices.length, 1));
    return index >= 0 ? defaults[index] : defaults[0];
  }

  /**
   * Applies the dialog result: the color moves to the (possibly renamed) group,
   * and a changed name renames every task in the group, which folds it into any
   * existing group of that name.
   */
  private async _applyTaskDetails(result: DialogTaskDetailsResult): Promise<void> {
    const title = result.title.trim();
    const nextKey = normalizeTaskTitle(title);

    const overrides = { ...this.sliceColorOverrides() };
    delete overrides[result.key];
    if (result.color) {
      overrides[nextKey] = result.color;
    }
    this._persist(overrides);

    if (nextKey === result.key) {
      return;
    }

    this.isMerging.set(true);
    try {
      const renamedCount = await this._statisticsService.mergeTaskNames(
        result.key,
        title,
      );
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.STATISTICS.RENAME_DONE,
        translateParams: { count: renamedCount, title },
      });
    } catch (e) {
      Log.err('Statistics: renaming task group failed', e);
      this._snackService.open({ type: 'ERROR', msg: T.F.STATISTICS.MERGE_FAILED });
    } finally {
      this.isMerging.set(false);
    }
  }

  private _persist(overrides: TaskColorOverrides): void {
    this.sliceColorOverrides.set(overrides);
    saveColorOverrides(overrides);
  }

  /**
   * Renames every task behind `source` to the name the user picks, which folds
   * the two rows into one. The target keeps its own name, so a merge never
   * rewrites the group the user is merging into. A second confirmation guards
   * the choice, since the rename cannot be undone from here.
   */
  async mergeInto(source: SameNameTotal): Promise<void> {
    const candidates = this.sameNameTotals().filter((entry) => entry.key !== source.key);

    if (!candidates.length) {
      this._snackService.open({ msg: T.F.STATISTICS.MERGE_EMPTY });
      return;
    }

    const target = (await firstValueFrom(
      this._matDialog
        .open(DialogMergeTaskNameComponent, {
          restoreFocus: true,
          data: { sourceTitle: source.title, candidates },
        })
        .afterClosed(),
    )) as SameNameTotal | undefined;

    if (!target) {
      return;
    }

    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.STATISTICS.MERGE_CONFIRM_TITLE,
            message: T.F.STATISTICS.MERGE_CONFIRM,
            translateParams: {
              count: source.taskCount,
              source: source.title,
              target: target.title,
            },
          },
        })
        .afterClosed(),
    );

    if (!confirmed) {
      return;
    }

    this.isMerging.set(true);
    try {
      const renamedCount = await this._statisticsService.mergeTaskNames(
        source.key,
        target.title,
      );
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.STATISTICS.MERGE_DONE,
        translateParams: { count: renamedCount, title: target.title },
      });
    } catch (e) {
      Log.err('Statistics: merging task names failed', e);
      this._snackService.open({ type: 'ERROR', msg: T.F.STATISTICS.MERGE_FAILED });
    } finally {
      this.isMerging.set(false);
    }
  }
}
