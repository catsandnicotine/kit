import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { KitHeader } from '/src/components/KitHeader.tsx';
import { DeckGlyph } from '/src/components/DeckGlyph.tsx';
import { LibraryDock } from '/src/components/LibraryDock.tsx';
import { UiIcon } from '/src/components/UiIcon.tsx';
import { ShowAnswerButton } from '/src/components/ShowAnswerButton.tsx';
import { hapticTap, hapticNavigate } from '/src/lib/platform/haptics.ts';

const $ = selector => document.querySelector(selector);
const rows = [...document.querySelectorAll('.deck')];
const folios = rows.map(row => createRoot(row.querySelector('.folio')));
const dock = createRoot($('#dock'));
const eye = createRoot($('#eye'));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let searchOpen = false;
let entering = false;
let selected = 0;
let suppressClick = -1;
const explain = message => { $('#notes').textContent = message; };

createRoot($('#brand')).render(h(KitHeader));
createRoot($('#card-folio')).render(h(DeckGlyph, { open:true }));

function drawDock() {
  dock.render(h(LibraryDock, {
    searchOpen, addDisabled:false,
    onSearch: () => {
      searchOpen = !searchOpen;
      $('#search').hidden = !searchOpen;
      if (searchOpen) $('#search input').focus();
      else { $('#search input').value = ''; rows.forEach(row => { row.hidden = false; }); }
      drawDock();
    },
    onSettings: () => explain('Settings keep their existing screen. This preview focuses on opening a deck.'),
    onAdd: () => explain('The existing full-screen creation route stays here. This preview never creates or changes decks.'),
  }));
}

function setOpenDeck(index, opening) {
  rows.forEach((row, i) => {
    const open = i === index && opening;
    row.classList.toggle('is-open', open);
    row.querySelector('.deck-title').setAttribute('aria-expanded', String(open));
    row.querySelector('.deck-actions').hidden = !open;
    folios[i].render(h(DeckGlyph, { open }));
  });
  selected = index;
}

function showView(id) {
  ['library', 'card', 'manage'].forEach(view => { $('#'+view).hidden = view !== id; });
}

async function enterCard(index, practice, direction = 0) {
  if (entering) return;
  selected = index;
  $('#card-name').textContent = rows[index].dataset.name;
  $('.preview-answer').hidden = true;
  $('.preview-return').hidden = true;
  $('#eye').hidden = false;
  eye.render(h(ShowAnswerButton, { onReveal: () => {
    $('.preview-answer').hidden = false;
    $('.preview-return').hidden = false;
    $('#eye').hidden = true;
  } }));
  explain(practice
    ? 'Practice: work through the cards without changing their schedule. Back returns to the same deck.'
    : 'Study: scheduled cards. Back returns to the same deck. This preview does not save progress.');
  const card = $('#card');
  if (direction && !reducedMotion.matches) {
    entering = true;
    card.hidden = false;
    card.inert = true;
    card.classList.add('is-entering');
    try {
      // Both real views remain visible during entry; no blank placeholder page.
      await card.animate([
        { transform:`translateX(${-direction * 100}%)` },
        { transform:'translateX(0)' },
      ], { duration:220, easing:'cubic-bezier(.2,.75,.25,1)' }).finished;
    } finally {
      card.inert = false;
      card.classList.remove('is-entering');
      entering = false;
    }
  }
  showView('card');
  setOpenDeck(index, true);
}

rows.forEach((row, index) => {
  const front = document.createElement('div');
  front.className = 'swipe-front';
  while (row.firstChild) front.append(row.firstChild);
  const under = document.createElement('div');
  under.className = 'swipe-under';
  under.setAttribute('aria-hidden', 'true');
  row.append(under, front);
  const title = row.querySelector('.deck-title');
  let gesture = null;
  folios[index].render(h(DeckGlyph));

  const restore = (animate = true) => {
    const from = front.style.transform || 'translateX(0)';
    front.classList.remove('is-dragging');
    front.style.transform = 'translateX(0)';
    under.style.opacity = '0';
    if (animate && !reducedMotion.matches) front.animate([
      { transform:from }, { transform:'translateX(0)' },
    ], { duration:160, easing:'cubic-bezier(.2,.8,.2,1)' });
  };
  title.addEventListener('pointerdown', event => {
    if (entering || !event.isPrimary || event.button !== 0) return;
    front.getAnimations().forEach(animation => animation.cancel());
    gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, offset:0, horizontal:false, ticked:false };
  });
  title.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      if (Math.abs(dx) <= 8 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      gesture.horizontal = true;
      title.setPointerCapture(event.pointerId);
      front.classList.add('is-dragging');
    }
    event.preventDefault();
    const width = row.clientWidth;
    gesture.offset = Math.max(-width * .8, Math.min(width * .8, dx));
    const threshold = Math.min(110, width * .27);
    const armed = Math.abs(gesture.offset) >= threshold;
    const right = gesture.offset > 0;
    under.textContent = right ? 'Study' : 'Practice';
    under.className = `swipe-under ${right ? 'is-right' : 'is-left'}${armed ? ' is-armed' : ''}`;
    under.style.opacity = String(Math.min(1, Math.abs(gesture.offset) / 55));
    front.style.transform = `translateX(${gesture.offset}px)`;
    if (armed && !gesture.ticked) {
      gesture.ticked = true;
      // A single threshold tick on native iOS; a deliberate no-op in this browser preview.
      void hapticTap();
    }
  });
  const finish = (event, cancelled) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const finished = gesture;
    gesture = null;
    if (!finished.horizontal) return;
    event.preventDefault();
    suppressClick = index;
    setTimeout(() => { if (suppressClick === index) suppressClick = -1; }, 350);
    const commit = !cancelled && Math.abs(finished.offset) >= Math.min(110, row.clientWidth * .27);
    if (commit) {
      void enterCard(index, finished.offset < 0, Math.sign(finished.offset));
      restore(false);
    } else restore();
  };
  title.addEventListener('pointerup', event => finish(event, false));
  title.addEventListener('pointercancel', event => finish(event, true));
  title.addEventListener('lostpointercapture', event => { if (gesture) finish(event, true); });
  title.addEventListener('click', () => {
    if (suppressClick === index) { suppressClick = -1; return; }
    setOpenDeck(index, !row.classList.contains('is-open'));
    explain('Swipe right for Study, left for Practice. Stop short and it returns. Tapping a deck reveals both actions too. Browser haptics are disabled.');
  });
  row.querySelector('.start-study').addEventListener('click', () => { void hapticNavigate(); void enterCard(index, false); });
  row.querySelector('.start-practice').addEventListener('click', () => { void hapticNavigate(); void enterCard(index, true); });
  row.querySelector('.more').addEventListener('click', () => {
    selected = index;
    $('#manage-name').textContent = row.dataset.name;
    showView('manage');
    explain('One Manage deck route. This preview is read-only.');
  });
});

document.querySelectorAll('.back').forEach(button => {
  createRoot(button).render(h(UiIcon, { name:'back' }));
  button.addEventListener('click', () => {
    showView('library');
    rows[selected].querySelector('.deck-title').focus({ preventScroll:true });
    explain('One library. Swipe a deck in either direction, or tap to see its actions.');
  });
});
$('.preview-return').addEventListener('click', () => showView('library'));
$('#search input').addEventListener('input', event => {
  const query = event.target.value.toLowerCase().trim();
  rows.forEach(row => { row.hidden = !row.dataset.name.toLowerCase().includes(query); });
});
drawDock();
