# 2026-10-17: a same-task pass in `./rr check`

## Done

- **`./rr check` same-task pass** (`harness/serve/panel.js`, `rrPanel.sameTask`; on by default,
  `--no-same-task` skips it). The script awaits `settled()` after every step, so it never saw a
  second event land before an app's batched update. The pass replays the script and, at sampled
  points planned on the reference alone, runs two actions in one task (no await between them):
  - **twice:** a click step clicked twice, one per control shape, row and list controls first;
  - **next:** a step and the step after it, structural steps first (navigation, tab, dialog,
    external event), and two dispatches in a row;
  - **stale:** a step that removes a control with its scope (its keyed ancestors: an item, a page,
    a tab panel, a dialog), then a click on that control's old element;
  - **event:** at the end of the script, each panel event that removes a control so, then a click
    on it;
  - **rewrite:** after each step typing an invalid value (`exemptValue`), a whole-state snapshot
    of the same state; every input must show its model value again. routed-app's snapshot only
    covers `global`, so it is skipped there (said in the report line);
  - **mid-script dispose** at the busiest point of the script run (most intervals, then
    listeners), which must leave nothing, then a remount and three steps.
- **Rules.** B's element is looked up after A ran (for stale, the element from before A). An element
  no longer in the page is not clicked (a browser cannot). The reference applies A, then B only if B
  fired and the state after A still renders its target: an action on a gone control is a no-op. A
  control that merely stops being shown while its scope stays is never sampled, because a
  synchronous app never receives that click. A virtual-clock tick in the same task as a step that
  mounts a timer may or may not reach it (in a browser a new interval's first tick comes in a later
  task), so either state is accepted there.
- **Cost.** A sample that leaves the reference where the script expects it continues the replay;
  one that diverges restarts from mount, and a toggle-like twice gets one more click to resync.
  Replays skip comparisons. A plan that queried the reference DOM per control was quadratic
  (big-table timed out at 10 minutes); per-state sets made it 5 s. A run that does not finish in
  10 minutes now fails instead of hanging, and the ready wait is 60 s (the machine was loaded).
- **big-table reference:** a row control on a missing row threw; it is now a no-op (README says
  so). This changes the inputs hash of every big-table measurement; the outputs are the same.

## Failures found, and fixes

| implementation | failure | fix | size (brotli, N=16 / 64) |
|---|---|---|---|
| tea-inline, dashboards (3 scenarios) | remove twice: `splice(indexOf(item))` with -1 drops the last item; toggle after a snapshot writes a detached object | look the item up by id, return when gone | shared +29/+32, unique +4/+35, big-component +40/+26 |
| tea-inline, big-table | select on a row a push dropped: selection on a missing id | return when the row is gone | +27/+31 |
| tea-local, big-table | same select; toggle/bump on a gone row threw in `edit()` | both keep the model | -9/-4 (noise) |
| Elm, big-table | same select (stale view for one frame) | `hasRow` guard, shared with `keepSelected` | -12/+46 |

Reported, not fixed (other agents' emitters, or upstream):

- **Solid:** rewrite, in shared-components, unique-components and big-component (fixed on main for
  derived-graph only).
- **digest:** rewrite, in shared-components, unique-components, big-component and derived-graph.
- **Marko:** stale clicks in shared-components (toggle of a removed item; twice too), big-table
  (select of a gone row) and routed-app (the old page's button writes the cart).
- **tea-local, routed-app:** a click on the old page's button after a navigation writes global
  state.
- **beni-tea, beni-direct:** next (a dispatch, then a click) in big-component and derived-graph.
  beni delivers a `Sub.on` listener's value on a queued microtask (`Hosted.hear`), while DOM
  handlers run at once, so the click overtakes the event. It needs an upstream change. beni's
  big-table does not build with the installed compiler, and routed-app replaces nav buttons in
  the plain script; neither comes from this pass.
- **Elm, routed-app:** the mid-script dispose caught an interval left running; fixed on main
  (`fb4a2ee`) before the final run.
- **digest locality** (big-component, derived-graph) fails as documented before.

## Learned

- A stale click has a defined meaning only when its scope is gone. For a conditional button in a
  live widget, a synchronous app drops the click and a lazy one applies it, and both are fair.
- A dispatch and a click in one task is an ordering test as much as a stale-DOM test. In practice
  a server push arrives in its own task, so beni's microtask delivery shows only under programmatic
  sequences.
