const stage = document.querySelector('.turn-stage');
const card = document.querySelector('.turn-card');
const front = document.querySelector('.face--front');
const back = document.querySelector('.face--back');
const questionButton = document.querySelector('#show-question');
const answerButton = document.querySelector('#show-answer');
const turnButton = document.querySelector('.turn-action');
const status = document.querySelector('#side-status');
const longSampleButton = document.querySelector('#long-sample');
const motionButton = document.querySelector('#preview-motion');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let angle = 0;
let settledAngle = 0;
let activeSide = 0;
let gesture = null;
let spring = null;
let frame = 0;
let suppressClick = false;
let suppressClickTimer = 0;
let motionPreview = false;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const sideAt = value => ((Math.round(value / 180) % 2) + 2) % 2;
const respectsReducedMotion = () => reducedMotion.matches && !motionPreview;

function updateAccessibleSide(side, announce = false) {
  if (side === activeSide && !announce) return;
  activeSide = side;
  front.inert = side === 1;
  back.inert = side === 0;
  front.setAttribute('aria-hidden', String(side === 1));
  back.setAttribute('aria-hidden', String(side === 0));
  questionButton.setAttribute('aria-pressed', String(side === 0));
  answerButton.setAttribute('aria-pressed', String(side === 1));
  turnButton.setAttribute('aria-label', side === 0 ? 'Turn to answer' : 'Turn to question');
  if (announce) status.textContent = side === 0 ? 'Question shown.' : 'Answer shown.';
}

function paint(value) {
  angle = value;
  const side = sideAt(value);
  const radians = value * Math.PI / 180;
  const facing = Math.cos(radians);
  // A broad, quiet material change follows orientation, rather than a floating glow.
  front.style.setProperty('--shade', String(respectsReducedMotion() ? 0 : (1 - Math.max(0, facing)) * .19));
  back.style.setProperty('--shade', String(respectsReducedMotion() ? 0 : (1 - Math.max(0, -facing)) * .16));
  front.hidden = respectsReducedMotion() && side === 1;
  back.hidden = respectsReducedMotion() && side === 0;
  card.style.transform = `rotateY(${value}deg)`;
  updateAccessibleSide(side);
}

function cancelSpring() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  spring = null;
}

function finishAt(target) {
  cancelSpring();
  settledAngle = target;
  paint(target);
  card.classList.remove('is-moving');
  updateAccessibleSide(sideAt(target), true);
}

function settle(target, initialVelocity = 0) {
  cancelSpring();
  if (respectsReducedMotion() || document.hidden || Math.abs(target - angle) < .01) {
    finishAt(target);
    return;
  }
  card.classList.add('is-moving');
  // Degrees/second. Critically damped enough to settle without a rubbery overshoot.
  // Velocity affects the release feel, never which face a short drag chooses.
  spring = {
    target,
    velocity:clamp(initialVelocity, -620, 620),
    previous:performance.now(),
    started:performance.now(),
  };
  const tick = now => {
    if (!spring) return;
    const elapsed = Math.min((now - spring.previous) / 1000, .032);
    spring.previous = now;
    // Small integration steps retain the same response on 60Hz/120Hz displays.
    const steps = Math.max(1, Math.ceil(elapsed / .008));
    const dt = elapsed / steps;
    let nextAngle = angle;
    for (let step = 0; step < steps; step += 1) {
      const acceleration = (spring.target - nextAngle) * 520 - spring.velocity * 44;
      spring.velocity += acceleration * dt;
      nextAngle += spring.velocity * dt;
    }
    paint(nextAngle);
    if ((Math.abs(spring.target - nextAngle) < .06 && Math.abs(spring.velocity) < 1.5)
      || now - spring.started > 650) {
      finishAt(spring.target);
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

function turn(direction = 1) {
  if (gesture) return;
  const basis = spring ? spring.target : settledAngle;
  settle(basis + direction * 180);
}

function suppressFollowingClick() {
  suppressClick = true;
  window.clearTimeout(suppressClickTimer);
  suppressClickTimer = window.setTimeout(() => { suppressClick = false; }, 420);
}

stage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || gesture) return;
  if (event.target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
  const basis = 180 * Math.round(angle / 180);
  cancelSpring();
  gesture = {
    id:event.pointerId,
    x:event.clientX,
    y:event.clientY,
    basis,
    startAngle:angle,
    offset:0,
    horizontal:false,
    lastX:event.clientX,
    lastTime:event.timeStamp,
    lastMoved:event.timeStamp,
    velocity:0,
  };
});

stage.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.horizontal) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      const target = gesture.basis;
      gesture = null;
      suppressFollowingClick();
      settle(target);
      return;
    }
    if (Math.abs(dx) <= 8 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    gesture.horizontal = true;
    stage.setPointerCapture(event.pointerId);
    card.classList.add('is-moving');
  }
  event.preventDefault();
  const degreesPerPixel = 180 / stage.clientWidth;
  const timeDelta = event.timeStamp - gesture.lastTime;
  if (timeDelta > 0) {
    const velocity = (event.clientX - gesture.lastX) * degreesPerPixel / timeDelta * 1000;
    gesture.velocity = gesture.velocity * .35 + velocity * .65;
  }
  gesture.lastX = event.clientX;
  gesture.lastTime = event.timeStamp;
  gesture.lastMoved = event.timeStamp;
  const rawOffset = dx * degreesPerPixel;
  // One turn per drag. Resistance beyond the end keeps it a tangible single card.
  const absolute = Math.abs(rawOffset);
  const resisted = absolute <= 180 ? absolute : 180 + (absolute - 180) * .16;
  gesture.offset = Math.sign(rawOffset) * Math.min(200, resisted);
  paint(gesture.startAngle + gesture.offset);
});

function endDrag(event, cancelled) {
  if (!gesture || event.pointerId !== gesture.id) return;
  const finished = gesture;
  gesture = null;
  if (!finished.horizontal) {
    settle(finished.basis);
    return;
  }
  event.preventDefault();
  suppressFollowingClick();
  // An exact halfway rule: no velocity shortcut and no accidental small-flick turn.
  const displacement = angle - finished.basis;
  const target = !cancelled && Math.abs(displacement) >= 90
    ? finished.basis + Math.sign(displacement) * 180
    : finished.basis;
  const velocity = !cancelled && event.timeStamp - finished.lastMoved < 85
    ? finished.velocity : 0;
  settle(target, velocity);
}

stage.addEventListener('pointerup', event => endDrag(event, false));
stage.addEventListener('pointercancel', event => endDrag(event, true));
stage.addEventListener('lostpointercapture', event => endDrag(event, true));
stage.addEventListener('click', event => {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    return;
  }
  if (event.target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
  turn();
});
stage.addEventListener('keydown', event => {
  if (event.target !== stage || !['ArrowLeft','ArrowRight','Enter',' '].includes(event.key)) return;
  event.preventDefault();
  turn(event.key === 'ArrowLeft' ? -1 : 1);
});

turnButton.addEventListener('click', () => turn());
questionButton.addEventListener('click', () => {
  const basis = spring ? spring.target : settledAngle;
  if (sideAt(basis) === 1) settle(basis - 180);
});
answerButton.addEventListener('click', () => {
  const basis = spring ? spring.target : settledAngle;
  if (sideAt(basis) === 0) settle(basis + 180);
});
longSampleButton.addEventListener('click', () => {
  const long = longSampleButton.getAttribute('aria-pressed') !== 'true';
  longSampleButton.setAttribute('aria-pressed', String(long));
  longSampleButton.textContent = long ? 'Use the short question' : 'Try a long question';
  document.querySelector('.long-question').hidden = !long;
  front.classList.toggle('is-long', long);
  document.querySelector('.face--front .face-content').scrollTop = 0;
  const basis = spring ? spring.target : settledAngle;
  if (sideAt(basis) === 1) settle(basis - 180);
});

function applyMotionPreference() {
  document.documentElement.classList.toggle('is-reduced-motion', respectsReducedMotion());
  motionButton.hidden = !reducedMotion.matches;
  motionButton.textContent = motionPreview ? 'Respect Reduce Motion' : 'Preview motion';
  motionButton.setAttribute('aria-pressed', String(motionPreview));
  document.querySelector('#motion-note').textContent = reducedMotion.matches
    ? motionPreview ? 'Motion preview on' : 'Reduce Motion is on'
    : '';
  if (respectsReducedMotion() && spring) finishAt(spring.target);
  paint(angle);
}
motionButton.addEventListener('click', () => {
  motionPreview = !motionPreview;
  applyMotionPreference();
});
reducedMotion.addEventListener('change', () => {
  motionPreview = false;
  applyMotionPreference();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (gesture) {
    const target = gesture.basis;
    gesture = null;
    finishAt(target);
  } else if (spring) finishAt(spring.target);
});

// Reduced Motion keeps the same drag/cancel rule but replaces perspective travel
// with an immediate face change. It also responds to preference changes while open.
applyMotionPreference();
updateAccessibleSide(0, true);
paint(0);
