/**
 * Which pane currently owns the files slot.
 *
 * `compact` is this extension's pane; `native` is not a second rendering but a
 * hand-back, where the pane steps aside and Hunk's own files pane takes the slot
 * again. Kept here, pure, so the cycle order is testable without a terminal.
 */

export const COMPACT_MODE = "compact";
export const NATIVE_MODE = "native";

export type PresentationMode = typeof COMPACT_MODE | typeof NATIVE_MODE;

export const MODES: readonly PresentationMode[] = [COMPACT_MODE, NATIVE_MODE];

export function isNative(mode: PresentationMode): mode is typeof NATIVE_MODE {
  return mode === NATIVE_MODE;
}

/** Next mode in the cycle; an unknown mode restarts at the first. */
export function nextMode(current: PresentationMode): PresentationMode {
  const index = MODES.indexOf(current);
  const next = MODES[(index + 1) % MODES.length];
  return next ?? MODES[0] ?? NATIVE_MODE;
}
