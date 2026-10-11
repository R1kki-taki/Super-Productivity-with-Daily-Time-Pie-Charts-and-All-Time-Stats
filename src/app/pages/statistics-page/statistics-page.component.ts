import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ChartData, ChartOptions } from 'chart.js';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LazyChartComponent } from '../../features/metric/lazy-chart/lazy-chart.component';
import { DatePickerInputComponent } from '../../ui/date-picker-input/date-picker-input.component';
import { InputColorPickerComponent } from '../../ui/input-color-picker/input-color-picker.component';
import { MsToStringPipe, msToString } from '../../ui/duration/ms-to-string.pipe';
import { StatisticsService } from '../../features/statistics/statistics.service';
import { DialogMergeTaskNameComponent } from '../../features/statistics/dialog-merge-task-name/dialog-merge-task-name.component';
import {
  buildPieSlices,
  getBarPercent,
  getBarScaleMax,
  getSameNameTotals,
  getSliceColors,
  isValidHexColor,
  normalizeHexColor,
  OTHER_SLICE_KEY,
  PieSlice,
  sanitizeColorOverrides,
  SameNameTotal,
  TaskColorOverrides,
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
    TranslatePipe,
    LazyChartComponent,
    DatePickerInputComponent,
    InputColorPickerComponent,
    MsToStringPipe,
  ],
})
export class StatisticsPageComponent {
  readonly T = T;

  private readonly _statisticsService = inject(StatisticsService);
  private readonly _translateService = inject(TranslateService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);

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

  /** Pie colors the user picked, keyed by normalized task name. Device-local. */
  readonly sliceColorOverrides = signal<TaskColorOverrides>(loadColorOverrides());

  /**
   * Raw text per color field, present only while a half-typed code is in the
   * field. Without it the field is rewritten from the applied color on every
   * keystroke, so typing `#ff0000` breaks at the third digit: `#ff0` is already
   * a valid 3-digit color and snaps to `#ffff00`.
   */
  private readonly _colorDrafts = signal<Record<string, string>>({});
  readonly colorDrafts = this._colorDrafts.asReadonly();

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

  /** Recolorable slices — the folded remainder has no color of its own. */
  readonly colorRows = computed(() => {
    const slices = this.pieSlices();
    const colors = getSliceColors(slices, this.sliceColorOverrides());
    return slices
      .map((slice, i) => ({ key: slice.key, label: slice.label, color: colors[i] }))
      .filter((row) => row.key !== OTHER_SLICE_KEY);
  });

  readonly totalForDay = computed(() =>
    (this.pieChartData().datasets[0]?.data ?? []).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    ),
  );

  readonly sameNameTotals = computed(() => getSameNameTotals(this._allTasks()));

  /** Each cumulative row plus its bar width, scaled to the longest total rounded up. */
  readonly sameNameRows = computed(() => {
    const totals = this.sameNameTotals();
    const scaleMax = getBarScaleMax(
      totals.reduce((max, row) => Math.max(max, row.totalTimeSpent), 0),
    );
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

  /** Applies a color from the swatch picker or the code field; junk is ignored. */
  onColorChange(key: string, value: string): void {
    if (!isValidHexColor(value)) {
      this._setDraft(key, value);
      return;
    }

    const color = normalizeHexColor(value);
    // A finished code or a swatch click needs no draft: the field already shows
    // exactly this value, so the applied color can write straight back.
    if (value.trim() === color) {
      this._clearDraft(key);
    } else {
      this._setDraft(key, value);
    }
    this._setColor(key, color);
  }

  /** Leaving the field drops half-typed text, so the field shows what is applied. */
  onColorBlur(key: string): void {
    this._clearDraft(key);
  }

  resetColor(key: string): void {
    this._clearDraft(key);
    const next = { ...this.sliceColorOverrides() };
    delete next[key];
    this._persist(next);
  }

  private _setDraft(key: string, draft: string): void {
    this._colorDrafts.update((drafts) => ({ ...drafts, [key]: draft }));
  }

  private _clearDraft(key: string): void {
    this._colorDrafts.update((drafts) => {
      if (!(key in drafts)) {
        return drafts;
      }
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  }

  private _setColor(key: string, color: string): void {
    this._persist({ ...this.sliceColorOverrides(), [key]: color });
  }

  private _persist(overrides: TaskColorOverrides): void {
    this.sliceColorOverrides.set(overrides);
    saveColorOverrides(overrides);
  }

  /**
   * Renames every task behind `source` to the name the user picks, which folds
   * the two rows into one. The target keeps its own name, so a merge never
   * rewrites the group the user is merging into.
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
