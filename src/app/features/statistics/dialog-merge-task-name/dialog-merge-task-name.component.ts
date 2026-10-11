import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { SameNameTotal } from '../statistics.util';
import { T } from '../../../t.const';

export interface DialogMergeTaskNameData {
  /** Title of the group that will be renamed, shown so the user can confirm the pick. */
  sourceTitle: string;
  /** Every other group; the chosen one keeps its name and absorbs the source. */
  candidates: SameNameTotal[];
}

@Component({
  selector: 'dialog-merge-task-name',
  templateUrl: './dialog-merge-task-name.component.html',
  styleUrls: ['./dialog-merge-task-name.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    MsToStringPipe,
  ],
})
export class DialogMergeTaskNameComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogMergeTaskNameComponent>>(MatDialogRef);

  readonly data = inject<DialogMergeTaskNameData>(MAT_DIALOG_DATA);
  readonly T = T;

  choose(target: SameNameTotal): void {
    this._matDialogRef.close(target);
  }

  close(): void {
    this._matDialogRef.close(undefined);
  }
}
