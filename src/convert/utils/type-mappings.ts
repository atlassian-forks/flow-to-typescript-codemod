export const ReactTypes = {
  Node: "ReactNode",
  ElementProps: "ComponentProps",
  StatelessFunctionalComponent: `FC`,
} as const;

export const SyntheticEvents = {
  SyntheticEvent: "SyntheticEvent",
  SyntheticUIEvent: "UIEvent",
  SyntheticFocusEvent: "FocusEvent",
  SyntheticKeyboardEvent: "KeyboardEvent",
  SyntheticMouseEvent: "MouseEvent",
  SyntheticWheelEvent: "WheelEvent",
  SyntheticPointerEvent: "PointerEvent",
  SyntheticTransitionEvent: "TransitionEvent",
} as const;

export const MomentTypes = {
  MomentDuration: "Duration",
} as const;

/**
 * Magma, add your time-mappings from Flow to TS here.
 * It will generate code replacing the given type references
 * by the name you provide.
 */
export const FlowTypeMappings: Record<string, string> = {
  TimeoutID: "number",
  IntervalID: "number",
};
