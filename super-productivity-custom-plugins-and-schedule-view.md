# Research Report: Super Productivity Custom Plugins & Keeping Completed Tasks in Schedule View

**Target Application:** [Super Productivity](https://github.com/johannesjo/super-productivity) (GitHub: `johannesjo/super-productivity` / `super-productivity/super-productivity`)  
**Investigated Topics:**
1. Custom plugin architecture & capabilities
2. Feasibility of extending/modifying built-in views (specifically the "Schedule" / Calendar view)
3. Source-code diagnosis of why completed tasks disappear from Schedule view and how to implement a "keep completed & crossed off" feature

---

## Executive Summary

1. **Are custom plugins supported?**  
   **Yes.** Super Productivity has a dedicated Plugin Architecture (introduced in v14+, documented in [`docs/plugin-development.md`](https://github.com/johannesjo/super-productivity/blob/master/docs/plugin-development.md) and typed in [`@super-productivity/plugin-api`](https://github.com/johannesjo/super-productivity/blob/master/packages/plugin-api/src/types.ts)).
2. **Can a custom plugin achieve what you want (keep completed tasks visible & crossed off in Schedule view)?**  
   **No.** The Plugin API only supports adding new isolated UI elements (header buttons, side panels, standalone iframe routes, task context menu actions) and reacting to data hooks. It **cannot** modify core Angular templates, inject CSS into internal components, or alter the internal NgRx selectors that govern the built-in Schedule/Timeline view.
3. **Is it possible to modify the tool / create the feature directly in source code?**  
   **Yes, and it is relatively straightforward.** Super Productivity is completely open source (MIT license, Angular + NgRx + Electron). The disappearance of completed tasks in the Schedule view is caused by a hardcoded `!t.isDone` filter inside a single NgRx selector (`selectTimelineTasks` in `src/app/features/work-context/store/work-context.selectors.ts`).

---

## 1. Custom Plugin Architecture

### Plugin Architecture Overview
The plugin system allows developers to build extensions using either:
* **Host Scripts (`plugin.js`)**: Executes inside the host renderer context with access to the global `PluginAPI` object.
* **Isolated UI Embeds (`index.html`)**: Renders custom views in sandboxed `<iframe>` panels or routes (templates like SolidJS are provided).

### What Plugins CAN Do (API Surface)
Per `packages/plugin-api/src/types.ts`:
* **UI Injections**:
  * `PluginAPI.registerHeaderButton(...)`: Adds buttons to the main header bar.
  * `PluginAPI.registerSidePanelButton(...)`: Adds tabs to the right-hand panel.
  * `PluginAPI.registerTaskContextMenuEntry(...)`: Adds items to the task context menu.
  * `PluginAPI.showIndexHtmlAsView()` / `PluginAPI.showInWorkContext()`: Renders standalone custom views in place of or beside the task list.
  * `PluginAPI.showSnack(...)`, `PluginAPI.notify(...)`, `PluginAPI.openDialog(...)`.
* **Data Access & Hooks**:
  * Hooks: `taskCreated`, `taskComplete`, `taskUpdate`, `taskDelete`, `currentTaskChange`, `finishDay`, `workContextChange`.
  * Task CRUD: `getTasks()`, `addTask()`, `updateTask()`, `deleteTask()`, `getAppState()`.
* **Issue Providers**: Custom trackers for Jira, GitHub, GitLab, etc.

### What Plugins CANNOT Do
* Plugins **cannot** intercept, re-render, or inject markup/CSS into core built-in Angular components (such as `ScheduleComponent` or `ScheduleEventComponent`).
* Plugins **cannot** modify NgRx state selectors or override how the built-in views query and display tasks.
* **Conclusion**: You cannot use a plugin to prevent completed tasks from disappearing in the core Schedule view.

---

## 2. Why Tasks Disappear in the Schedule View

### The Scheduling Architecture
Super Productivity's Schedule view (under `src/app/features/schedule/`) relies on `ScheduleService` (`src/app/features/schedule/schedule.service.ts`), which queries tasks from the NgRx store via `selectTimelineTasks`.

### The Culprit: `selectTimelineTasks`
In [`src/app/features/work-context/store/work-context.selectors.ts`](https://github.com/johannesjo/super-productivity/blob/master/src/app/features/work-context/store/work-context.selectors.ts#L394-L432):

```typescript
export const selectTimelineTasks = createSelector(
  selectTodayTaskIds,
  selectMapOfAllTasksInActiveProjects,
  (
    todayIds,
    activeTaskMap,
  ): {
    planned: TaskWithDueTime[];
    unPlanned: TaskWithSubTasks[];
  } => {
    const allPlannedTasks: TaskWithDueTime[] = [];
    activeTaskMap.forEach((t) => {
      // 1. Scheduled tasks explicitly filter out completed tasks:
      if (!t.isDone && t.dueWithTime) {
        allPlannedTasks.push(t as TaskWithDueTime);
      }
    });
    const allPlannedIdSet = new Set(allPlannedTasks.map((t) => t.id));

    const taskIdsToTasks = (taskIds: string[]): Task[] =>
      taskIds.map((id) => activeTaskMap.get(id)).filter((t): t is Task => !!t);

    return {
      planned: allPlannedTasks,
      // 2. Unplanned / Today tasks explicitly filter out completed tasks:
      unPlanned: taskIdsToTasks(todayIds)
        .map(
          (t): TaskWithSubTasks => ({
            ...t,
            subTasks: taskIdsToTasks(t.subTaskIds),
          }),
        )
        .filter((t) => !t.isDone && !allPlannedIdSet.has(t.id)),
    };
  },
);
```

### Why it was designed this way
The Schedule view was conceptually designed as a forward-looking capacity planner / timebox calculator. Once a task is completed, Super Productivity assumes it no longer requires future time allocation in your daily capacity budget, so it is filtered out of the schedule calculation to free up remaining hours for unfinished tasks.

---

## 3. How to Implement the Feature (Source Code Modification)

Modifying Super Productivity directly is very feasible. The project is an Angular single-page application packaged with Electron for desktop.

### Files Requiring Modification:

### 1. Include completed tasks in `selectTimelineTasks`
**File:** `src/app/features/work-context/store/work-context.selectors.ts`
* Allow tasks where `t.isDone === true` to remain in `planned` and `unPlanned` (or conditionally based on a configuration setting).

### 2. Prevent completed tasks from consuming future remaining capacity
**Files:**
* `src/app/features/schedule/map-schedule-data/create-schedule-days.ts`
* `src/app/features/schedule/map-schedule-data/get-tasks-within-and-beyond-budget.ts`
* When a task has `isDone: true`:
  * Its scheduled position on the timeline should reflect when it was scheduled or when it was executed (`timeSpent`).
  * It should not be treated as "flow tasks" pushed into tomorrow if it exceeds the remaining budget.

### 3. Visual Strikethrough & Styling in Schedule View
**Files:**
* `src/app/features/schedule/schedule-event/schedule-event.component.ts`
* `src/app/features/schedule/schedule-event/schedule-event.component.scss`

In `ScheduleEventComponent`:
```typescript
readonly isDone = computed(() => !!this.task()?.isDone);

readonly cssClass = computed(() => {
  const evt = this.se();
  let addClass = '';
  ...
  if (this.isDone()) {
    addClass += ' is-done';
  }
  return evt.type + ' ' + addClass;
});
```

In `schedule-event.component.scss`:
```scss
:host.is-done {
  opacity: 0.6;
  .title-text {
    text-decoration: line-through;
  }
}
```

---

## 4. Development Workflow & Next Steps

If you want to run or customize Super Productivity locally:

1. **Clone the repo:**
   ```bash
   git clone https://github.com/johannesjo/super-productivity.git
   cd super-productivity
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run in development mode:**
   ```bash
   # Web browser mode:
   npm start
   # Or Electron desktop mode:
   npm run electron
   ```
4. **Package desktop build:**
   ```bash
   npm run dist
   ```

### Recommended Upstream Contribution
Consider opening a Feature Request or Discussion on [Super Productivity GitHub Discussions](https://github.com/johannesjo/super-productivity/discussions):
* **Proposal:** Add a toggle in `Settings > Schedule Timeline` titled *"Show completed tasks in Schedule view"*.
* Johannes Millan (the creator) actively reviews and merges cleanly implemented features that add configurable options for users.
