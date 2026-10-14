import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DateAdapter } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { DayData, HeatmapComponent } from '../../../ui/heatmap/heatmap.component';
import { MsToStringPipe, msToString } from '../../../ui/duration/ms-to-string.pipe';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { DialogEditTaskDetailComponent } from '../dialog-edit-task-detail/dialog-edit-task-detail.component';
import {
  DialogTaskDetailsSettingsComponent,
  DialogTaskDetailsSettingsResult,
} from '../dialog-task-details-settings/dialog-task-details-settings.component';
import { StatisticsService } from '../statistics.service';
import {
  buildHeatmapWeeks,
  getGroupRosterForDay,
  getTaskHeatmapDayMap,
  TaskDayRosterEntry,
  TaskHeatmapData,
} from '../statistics.util';
import { T } from '../../../t.const';

export interface DialogTaskDetailsData {
  /** Normalized task name the group is keyed by, echoed back in the result. */
  key: string;
  /** Display title, also the initial value of the name field. */
  title: string;
  /** Day the dialog's roster opens on; `''` hides the roster entirely. */
  dayStr: string;
  /** Saved color override, or `null` when the group still uses the generated default. */
  color: string | null;
  /** Generated default the reset button restores. */
  defaultColor: string;
}

export interface DialogTaskDetailsResult {
  key: string;
  /** The (possibly renamed) title to apply to every task in the group. */
  title: string;
  /** The chosen color, or `null` to drop the override and fall back to the default. */
  color: string | null;
}

@Component({
  selector: 'dialog-task-details',
  templateUrl: './dialog-task-details.component.html',
  styleUrls: ['./dialog-task-details.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MsToStringPipe,
    LocaleDatePipe,
    HeatmapComponent,
  ],
})
export class DialogTaskDetailsComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogTaskDetailsComponent>>(MatDialogRef);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _statisticsService = inject(StatisticsService);
  private readonly _matDialog = inject(MatDialog);

  readonly data = inject<DialogTaskDetailsData>(MAT_DIALOG_DATA);
  readonly T = T;

  /** Live task list, so edits and deletions made here are reflected immediately. */
  private readonly _allTasks = toSignal(
    this._statisticsService.allTasksIncludingArchive$,
    { initialValue: [] },
  );

  /**
   * Day the roster shows. It starts on the day the dialog was opened with and
   * only moves when the user picks another day in this dialog's own heatmap, so
   * the statistics page keeps showing the date it was on.
   */
  private readonly _selectedDayStr = signal(this.data.dayStr);
  readonly selectedDayStr = this._selectedDayStr.asReadonly();

  /** The group's individual instances that tracked time on the selected day. */
  readonly rosterEntries = computed<TaskDayRosterEntry[]>(() =>
    this._selectedDayStr()
      ? getGroupRosterForDay(this._allTasks(), this.data.key, this._selectedDayStr())
      : [],
  );

  readonly name = signal(this.data.title);

  /** Saved color override, or `null` to fall back to the generated default. */
  private readonly _colorOverride = signal(this.data.color);
  /** Effective color, e.g. for the roster dots. */
  readonly color = computed(() => this._colorOverride() ?? this.data.defaultColor);

  /** Emits whenever the date locale changes so locale-derived labels re-compute. */
  private readonly _localeChange = toSignal(this._dateAdapter.localeChanges, {
    initialValue: null,
  });

  readonly canSave = computed(() => this.name().trim().length > 0);

  /** Rolling 12-month heatmap of the group's own tracked time. */
  readonly heatmapData = computed<TaskHeatmapData | null>(() => {
    this._localeChange();
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() + 1);

    const { dayMap, hasData } = getTaskHeatmapDayMap(
      this._allTasks(),
      this.data.key,
      startDate,
      endDate,
    );
    if (!hasData) {
      return null;
    }

    return buildHeatmapWeeks(
      dayMap,
      startDate,
      endDate,
      this._dateAdapter.getFirstDayOfWeek(),
      this._dateAdapter.getMonthNames('short'),
    );
  });

  save(): void {
    const title = this.name().trim();
    if (!title) {
      return;
    }
    const result: DialogTaskDetailsResult = {
      key: this.data.key,
      title,
      color: this._colorOverride(),
    };
    this._matDialogRef.close(result);
  }

  /**
   * Marks a day in this dialog's heatmap as the roster's day. Scoped to the
   * dialog: the statistics page keeps the date it was showing.
   */
  onHeatmapDayClick(day: DayData): void {
    this._selectedDayStr.set(day.dateStr);
  }

  /**
   * Opens the group's name/color editor. Its result becomes this dialog's
   * pending values — still committed by the Save button here, so cancelling the
   * editor leaves them untouched.
   */
  async openSettings(): Promise<void> {
    const result = (await firstValueFrom(
      this._matDialog
        .open(DialogTaskDetailsSettingsComponent, {
          restoreFocus: true,
          data: {
            title: this.name(),
            savedColor: this._colorOverride(),
            defaultColor: this.data.defaultColor,
          },
        })
        .afterClosed(),
    )) as DialogTaskDetailsSettingsResult | undefined;

    if (!result) {
      return;
    }

    this.name.set(result.title);
    this._colorOverride.set(result.color);
  }

  /**
   * Opens one roster row's details for editing. The dialog closes with the new
   * text, or with nothing when it was left as it was.
   */
  async openRosterDetail(entry: TaskDayRosterEntry): Promise<void> {
    const result = (await firstValueFrom(
      this._matDialog
        .open(DialogEditTaskDetailComponent, {
          restoreFocus: true,
          data: {
            title: entry.task.title,
            notes: entry.task.notes ?? '',
            taskId: entry.task.id,
          },
        })
        .afterClosed(),
    )) as string | undefined;

    if (result === undefined) {
      return;
    }

    await this._statisticsService.setTaskNotes(entry.task.id, result);
  }

  /** Clears the task's time for the shown day, after a second confirmation. */
  async deleteRosterEntry(entry: TaskDayRosterEntry, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            title: T.F.STATISTICS.DELETE_DAY_TITLE,
            message: T.F.STATISTICS.DELETE_DAY_CONFIRM,
            translateParams: {
              title: entry.detail || entry.task.title,
              time: msToString(entry.timeSpent),
            },
          },
        })
        .afterClosed(),
    );

    if (!confirmed) {
      return;
    }

    await this._statisticsService.setTaskTimeSpent(
      entry.task.id,
      this._selectedDayStr(),
      0,
    );
  }

  close(): void {
    this._matDialogRef.close(undefined);
  }
}
