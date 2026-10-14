import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputColorPickerComponent } from '../../../ui/input-color-picker/input-color-picker.component';
import { T } from '../../../t.const';

export interface DialogTaskDetailsSettingsData {
  /** Group title the name field starts on. */
  title: string;
  /** Saved color override, or `null` when the group still uses the generated default. */
  savedColor: string | null;
  /** Generated default the reset button restores. */
  defaultColor: string;
}

export interface DialogTaskDetailsSettingsResult {
  /** The (possibly renamed) title to apply to every task in the group. */
  title: string;
  /** The chosen color, or `null` to drop the override and fall back to the default. */
  color: string | null;
}

/**
 * Name and color editor for one same-name group. Opened from the details
 * dialog's gear, so those two fields are out of the way until asked for; the
 * caller applies the result to its own pending state and still commits on save.
 */
@Component({
  selector: 'dialog-task-details-settings',
  templateUrl: './dialog-task-details-settings.component.html',
  styleUrls: ['./dialog-task-details-settings.component.scss'],
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
  ],
})
export class DialogTaskDetailsSettingsComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogTaskDetailsSettingsComponent>>(MatDialogRef);

  readonly data = inject<DialogTaskDetailsSettingsData>(MAT_DIALOG_DATA);
  readonly T = T;

  readonly name = signal(this.data.title);
  readonly color = signal(this.data.savedColor ?? this.data.defaultColor);

  private readonly _isColorReset = signal(false);
  /** False until the user touches the color, so a rename-only edit keeps the override as-is. */
  private readonly _isColorTouched = signal(false);

  readonly canSave = computed(() => this.name().trim().length > 0);

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
    const result: DialogTaskDetailsSettingsResult = {
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
    return this._isColorTouched() ? this.color() : this.data.savedColor;
  }

  close(): void {
    this._matDialogRef.close(undefined);
  }
}
