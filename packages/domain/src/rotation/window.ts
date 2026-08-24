const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export type RotationWindow = {
  readonly rotationStartsAt: Date;
  readonly rotationEndsAt: Date;
};

/**
 * The rotation entitlement a confirmed boost buys.
 *
 * The entitlement is participation in the eligible rotation pool for the
 * configured period. It is not a promise of continuous visibility.
 */
export function calculateRotationWindow(confirmedAt: Date, rotationHours: number): RotationWindow {
  if (!Number.isFinite(rotationHours) || rotationHours <= 0) {
    throw new RangeError(`rotationHours must be a positive number, received: ${rotationHours}`);
  }
  return {
    rotationStartsAt: new Date(confirmedAt.getTime()),
    rotationEndsAt: new Date(confirmedAt.getTime() + rotationHours * MILLISECONDS_PER_HOUR),
  };
}

export function isRotationActive(now: Date, window: RotationWindow): boolean {
  return (
    now.getTime() >= window.rotationStartsAt.getTime() &&
    now.getTime() < window.rotationEndsAt.getTime()
  );
}
