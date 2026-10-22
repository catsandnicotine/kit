import type { CardFace } from '../types/editorUi';
import type { CardTurnAxis, CardTurnSpring, CardTurnSpringStep } from '../types/cardTurn';

/** Decide gesture intent once, favouring native scrolling for diagonal movement.
 * @param x - Horizontal travel from pointer-down.
 * @param y - Vertical travel from pointer-down.
 * @returns Pending below 12px, otherwise a decisive horizontal or vertical intent.
 */
export function cardTurnAxis(x: number, y: number): CardTurnAxis {
  if (Math.max(Math.abs(x), Math.abs(y)) < 12) return 'pending';
  return Math.abs(x) >= Math.abs(y) * 1.4 ? 'horizontal' : 'vertical';
}

/** Keep deliberate card travel thumb-reachable across compact and large screens.
 * @param width - Card viewport width captured at the start of the gesture.
 * @returns Full-turn travel: 80% of the starting width, capped at 360 CSS pixels.
 */
export function cardTurnTravel(width: number): number {
  return width > 0 && Number.isFinite(width) ? Math.min(width * .8, 360) : 0;
}

/** Latch the first readable answer and choose its nearest flat orientation.
 * @param controlledFace - Session face before the next visual update.
 * @param angle - Proposed visual rotation.
 * @param revealed - Whether this gesture has already exposed the answer.
 * @returns The nearest back angle after exposure, otherwise no latch.
 */
export function cardTurnRevealAngle(controlledFace: CardFace, angle: number, revealed: boolean): number | null {
  return revealed || (controlledFace === 'front' && cardTurnFace(angle) === 'back')
    ? cardTurnFaceAngle('back', angle) : null;
}

/** Find the visible side of a continuous rotation, including negative turns.
 * @param angle - Y rotation in degrees.
 * @returns The front or back face nearest the viewer.
 */
export function cardTurnFace(angle: number): CardFace {
  return ((Math.round(angle / 180) % 2) + 2) % 2 === 0 ? 'front' : 'back';
}

/** Find the nearest flat angle showing the controlled face.
 * @param face - Required visible face.
 * @param angle - Current continuous rotation.
 * @returns A congruent front/back angle near the current turn.
 */
export function cardTurnFaceAngle(face: CardFace, angle: number): number {
  const offset = face === 'front' ? 0 : 180;
  return offset + Math.round((angle - offset) / 360) * 360;
}

/** Map one card-width of travel to a turn, resisting travel beyond its end.
 * @param distance - Horizontal finger travel in CSS pixels.
 * @param width - Actual card viewport width.
 * @returns Rotation offset, bounded to one turn plus a small resistant overshoot.
 */
export function cardTurnDragAngle(distance: number, width: number): number {
  const travel = cardTurnTravel(width);
  if (!travel || !Number.isFinite(distance)) return 0;
  const raw = distance / travel * 180;
  const magnitude = Math.abs(raw);
  return Math.sign(raw) * Math.min(200, magnitude <= 180 ? magnitude : 180 + (magnitude - 180) * .16);
}

/** Commit only after halfway; finger speed never turns a short drag into a flip.
 * @param basis - Flat face nearest the start of the drag.
 * @param angle - Rotation on release.
 * @returns The same face below halfway, or the adjacent face beyond it.
 */
export function cardTurnReleaseAngle(basis: number, angle: number): number {
  const difference = angle - basis;
  return Math.abs(difference) >= 90 ? basis + Math.sign(difference) * 180 : basis;
}

/** Advance a nearly critically damped spring with stable substeps across refresh rates.
 * @param spring - Current rotation, degrees/second velocity and flat target.
 * @param elapsed - Time since the preceding frame in seconds.
 * @returns Updated spring and whether the remaining motion is imperceptible.
 */
export function stepCardTurnSpring(spring: CardTurnSpring, elapsed: number): CardTurnSpringStep {
  const time = Math.max(0, Math.min(elapsed, .032));
  const steps = Math.max(1, Math.ceil(time / .006));
  const delta = time / steps;
  let { angle, velocity } = spring;
  for (let index = 0; index < steps; index += 1) {
    velocity += ((spring.target - angle) * 900 - velocity * 60) * delta;
    angle += velocity * delta;
  }
  const done = Math.abs(spring.target - angle) < .12 && Math.abs(velocity) < 3;
  return { angle:done ? spring.target : angle, velocity:done ? 0 : velocity, target:spring.target, done };
}
