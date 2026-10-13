import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DateAdapter } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputColorPickerComponent } from '../../../ui/input-color-picker/input-color-picker.component';
import { HeatmapComponent } from '../../../ui/heatmap/heatmap.component';
import { Task } from '../../tasks/task.model';
import {
  buildHeatmapWeeks,
  getTaskHeatmapDayMap,
  TaskHeatmapData,
} from '../statistics.util';
import { T } from '../../../t.const';

export interface DialogTaskDetailsData {
  /** Normalized task name the group is keyed by, echoed back in the result. */
  key: string;
  /** Display title, also the initial value of the name field. */
  title: string;
  /** Every task (store + archive), so the heatmap can pick out this group. */
  tasks: Task[];
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
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    InputColorPickerComponent,
    HeatmapComponent,
  ],
})
export class DialogTaskDetailsComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogTaskDetailsComponent>>(MatDialogRef);
  private readonly _dateAdapter = inject(DateAdapter);

  readonly data = inject<DialogTaskDetailsData>(MAT_DIALOG_DATA);
  readonly T = T;

  readonly name = signal(this.data.title);
  readonly color = signal(this.data.color ?? this.data.defaultColor);

  private readonly _isColorReset = signal(false);
  /** False until the user touches the color, so a rename-only edit keeps the override as-is. */
  private readonly _isColorTouched = signal(false);

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
      this.data.tasks,
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

  /** Applies a color from the picker, which only ever emits normalized hex values. */
  onColorChange(color: string): void {
    this.color.set(color);
    this._isColorReset.set(false);
    this._isColorTouched.set(true);
  }

  resetColor(): void {
    this.color.set(this.data.defaultColor);
    this._isColorReset.set(true);
    this._isColorTouched.set(true);
  }

  save(): void {
    const title = this.name().trim();
    if (!title) {
      return;
    }
    const result: DialogTaskDetailsResult = {
      key: this.data.key,
      title,
      color: this._resolveColor(),
    };
    this._matDialogRef.close(result);
  }

  /** `null` drops the override; a string pins the group to that color. */
  private _resolveColor(): string | null {
    if (this._isColorReset()) {
      return null;
    }
    return this._isColorTouched() ? this.color() : this.data.color;
  }

  close(): void {
    this._matDialogRef.close(undefined);
  }
}
