import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, firstValueFrom, from, Observable } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { Update } from '@ngrx/entity';
import { Task, TaskArchive } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { dedupeByKey } from '../../util/de-dupe-by-key';
import { normalizeTaskTitle } from './statistics.util';
import { Log } from '../../core/log';

/**
 * Store side and archive side kept apart, because a merge has to know which
 * service owns each task. Only the merged view is published.
 */
type StoreAndArchiveTasks = [Task[], Task[]];

/**
 * Global task view for the statistics page: tasks still in the store plus every
 * archived task, merged and de-duplicated.
 *
 * The archive lives in IndexedDB, so it is not reactive — it is read once when
 * data init finishes and again whenever `refresh()` is called. The store side
 * stays live, so time tracked while the page is open shows up immediately.
 */
@Injectable({ providedIn: 'root' })
export class StatisticsService {
  private readonly _taskService = inject(TaskService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _dataInitStateService = inject(DataInitStateService);

  private readonly _refreshTrigger$ = new BehaviorSubject<void>(undefined);

  private readonly _tasksAndArchive$: Observable<StoreAndArchiveTasks> = combineLatest([
    this._taskService.allTasks$,
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      switchMap(() => this._refreshTrigger$),
      switchMap(() => from(this._loadArchivedTasks())),
    ),
  ]);

  readonly allTasksIncludingArchive$: Observable<Task[]> = this._tasksAndArchive$.pipe(
    map(([storeTasks, archivedTasks]) =>
      dedupeByKey([...storeTasks, ...archivedTasks], 'id'),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** Re-reads the archive; the store side is already live. */
  refresh(): void {
    this._refreshTrigger$.next();
  }

  /**
   * Sets one task's tracked time for a single day, recomputing its lifetime
   * total so the change shows up everywhere time is read from (pie chart, totals
   * table, heatmap). A non-positive `timeSpentMs` clears that day instead.
   *
   * Store tasks go through the normal task update, which routes through the
   * reducer's `updateTimeSpentForTask` and keeps parent aggregates in sync.
   * Archived tasks no longer exist in the store, so they are patched in place
   * with a manually recomputed total.
   */
  async setTaskTimeSpent(
    taskId: string,
    dayStr: string,
    timeSpentMs: number,
  ): Promise<void> {
    const [storeTasks, archivedTasks] = await firstValueFrom(this._tasksAndArchive$);
    const task =
      storeTasks.find((candidate) => candidate.id === taskId) ??
      archivedTasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }

    const timeSpentOnDay = { ...task.timeSpentOnDay };
    if (timeSpentMs > 0) {
      timeSpentOnDay[dayStr] = timeSpentMs;
    } else {
      delete timeSpentOnDay[dayStr];
    }

    if (storeTasks.some((candidate) => candidate.id === taskId)) {
      this._taskService.update(taskId, { timeSpentOnDay });
      return;
    }

    const timeSpent = Object.values(timeSpentOnDay).reduce(
      (sum, value) => sum + value,
      0,
    );
    await this._taskArchiveService.updateTasks([
      { id: taskId, changes: { timeSpentOnDay, timeSpent } },
    ]);
    this.refresh();
  }

  /**
   * Replaces one task's details. Same store/archive split as
   * `setTaskTimeSpent`: store tasks go through the normal task update, archived
   * ones through the archive service, which the store cannot reach.
   */
  async setTaskNotes(taskId: string, notes: string): Promise<void> {
    const [storeTasks, archivedTasks] = await firstValueFrom(this._tasksAndArchive$);

    if (storeTasks.some((candidate) => candidate.id === taskId)) {
      this._taskService.update(taskId, { notes });
      return;
    }

    if (!archivedTasks.some((candidate) => candidate.id === taskId)) {
      return;
    }

    await this._taskArchiveService.updateTasks([{ id: taskId, changes: { notes } }]);
    this.refresh();
  }

  /**
   * Renames every task whose name matches `sourceKey` to `targetTitle`, so the
   * two groups aggregate as one afterwards. Returns how many tasks were renamed.
   *
   * Store tasks go through the normal task update; archived ones do not exist in
   * the store and would be silently skipped, so they go through the archive
   * service in one batch.
   */
  async mergeTaskNames(sourceKey: string, targetTitle: string): Promise<number> {
    const [storeTasks, archivedTasks] = await firstValueFrom(this._tasksAndArchive$);
    const storeTaskIds = new Set(storeTasks.map((task) => task.id));

    const archiveUpdates: Update<Task>[] = [];
    let renamedCount = 0;

    for (const task of [...storeTasks, ...archivedTasks]) {
      if (normalizeTaskTitle(task.title) !== sourceKey) {
        continue;
      }
      renamedCount++;
      if (storeTaskIds.has(task.id)) {
        this._taskService.update(task.id, { title: targetTitle });
      } else {
        archiveUpdates.push({ id: task.id, changes: { title: targetTitle } });
      }
    }

    if (archiveUpdates.length) {
      await this._taskArchiveService.updateTasks(archiveUpdates);
    }

    this.refresh();
    return renamedCount;
  }

  private async _loadArchivedTasks(): Promise<Task[]> {
    try {
      const archive: TaskArchive = await this._taskArchiveService.load();
      return (archive.ids as string[])
        .map((id) => archive.entities[id])
        .filter((task): task is Task => !!task);
    } catch (e) {
      Log.err('StatisticsService: Failed to load archived tasks', e);
      return [];
    }
  }
}
