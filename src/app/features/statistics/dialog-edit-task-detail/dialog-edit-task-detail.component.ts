import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { InlineMarkdownComponent } from '../../../ui/inline-markdown/inline-markdown.component';
import { T } from '../../../t.const';

export interface DialogEditTaskDetailData {
  /** Task title, used as the dialog heading. */
  title: string;
  /** Persisted details the editor starts on. */
  notes: string;
  /** Lets the editor key its undo history to the task. */
  taskId: string;
}

@Component({
  selector: 'dialog-edit-task-detail',
  templateUrl: './dialog-edit-task-detail.component.html',
  styleUrls: ['./dialog-edit-task-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    InlineMarkdownComponent,
  ],
})
export class DialogEditTaskDetailComponent {
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogEditTaskDetailComponent>>(MatDialogRef);

  readonly data = inject<DialogEditTaskDetailData>(MAT_DIALOG_DATA);
  readonly T = T;

  /**
   * Pinned to what was loaded: the editor reports edits only on blur, so
   * re-seeding the model mid-edit would fight the caret.
   */
  readonly initialNotes = this.data.notes;

  private readonly _editedNotes = signal<string | null>(null);

  onNotesChange(notes: string): void {
    this._editedNotes.set(notes);
  }

  /**
   * Closes with the edited text, or with `undefined` when nothing changed —
   * deciding that here keeps the caller from writing back an identical value.
   */
  save(): void {
    const edited = this._editedNotes();
    this._matDialogRef.close(
      edited !== null && edited !== this.initialNotes ? edited : undefined,
    );
  }

  close(): void {
    this._matDialogRef.close(undefined);
  }
}
