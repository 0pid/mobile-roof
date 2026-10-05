const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const sidebar = $('#sidebar');
const chatPanel = $('#chatPanel');
const roofModal = $('#roofModal');
const profileModal = $('#profileModal');
const scrim = $('#scrim');

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function showView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  sidebar.classList.remove('open');
  if (name === 'agent') openChat();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncScrim() {
  scrim.classList.toggle('visible', chatPanel.classList.contains('open') || roofModal.classList.contains('open') || profileModal.classList.contains('open') || sidebar.classList.contains('open'));
}

function openChat(prompt = '') {
  chatPanel.classList.add('open');
  chatPanel.setAttribute('aria-hidden', 'false');
  syncScrim();
  if (prompt) sendMessage(prompt);
  setTimeout(() => $('#chatInput').focus(), 250);
}

function closeChat() {
  chatPanel.classList.remove('open');
  chatPanel.setAttribute('aria-hidden', 'true');
  syncScrim();
}

const answers = {
  roof: 'Your roof appears to be about 19 years old. Replacing it before solar avoids removing and reinstalling panels later, and lets both projects share planning and permitting.',
  solar: 'Based on your roof shape and local sunlight, an 8.4 kW system could offset about 92% of your usage—roughly $146 per month at today’s rates.',
  afford: 'I can walk you through cash, loan and lease options. When you’re ready, a soft credit check can show real terms without affecting your credit score.',
  battery: 'A home battery could keep your essentials running for around 8 hours during an outage. I can size it more precisely after we review your utility bill.'
};

function answerFor(text) {
  const query = text.toLowerCase();
  if (query.includes('roof')) return answers.roof;
  if (query.includes('solar') || query.includes('save')) return answers.solar;
  if (query.includes('afford') || query.includes('financ') || query.includes('cost')) return answers.afford;
  if (query.includes('battery') || query.includes('outage')) return answers.battery;
  return 'I can help with that. I’ll use your home details, aerial design and local options to give you a clear answer—then you decide what happens next.';
}

function sendMessage(text) {
  if (!text.trim()) return;
  const body = $('#chatBody');
  body.insertAdjacentHTML('beforeend', `<div class="message user">${text.replace(/[<>]/g, '')}</div><div class="typing"><i></i><i></i><i></i></div>`);
  body.scrollTop = body.scrollHeight;
  setTimeout(() => {
    $('.typing', body)?.remove();
    body.insertAdjacentHTML('beforeend', `<div class="message agent">${answerFor(text)}</div>`);
    body.scrollTop = body.scrollHeight;
  }, 650);
}

$$('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
$$('[data-open-chat]').forEach(button => button.addEventListener('click', () => openChat()));
$('#closeChat').addEventListener('click', closeChat);
$('#menuBtn').addEventListener('click', () => { sidebar.classList.add('open'); syncScrim(); });
$('#closeMenu').addEventListener('click', () => { sidebar.classList.remove('open'); syncScrim(); });
scrim.addEventListener('click', () => { closeChat(); roofModal.classList.remove('open'); profileModal.classList.remove('open'); sidebar.classList.remove('open'); syncScrim(); });

$$('.quick-replies button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.remove();
  sendMessage(button.textContent);
}));
$('#chatForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#chatInput');
  sendMessage(input.value);
  input.value = '';
});

$$('[data-option]').forEach(button => button.addEventListener('click', () => {
  const option = button.dataset.option;
  if (button.classList.contains('option')) {
    $$('.option').forEach(item => item.classList.toggle('selected', item === button));
    toast(`${option} added to your plan`);
  } else {
    showView('home');
    const target = $(`.option[data-option="${option}"]`);
    $$('.option').forEach(item => item.classList.toggle('selected', item === target));
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}));

$$('.step').forEach(step => step.addEventListener('click', () => {
  const number = Number(step.dataset.step);
  if (number === 1) openProfileModal();
  else if (number === 2) toast('You are exploring your options now');
  else if (number === 3) openRoofModal();
  else toast('Complete your design to unlock this step');
}));

const storedProfile = JSON.parse(localStorage.getItem('soloHomeProfile') || 'null');

function setProfileProgress(complete) {
  const first = $('.step[data-step="1"]');
  const second = $('.step[data-step="2"]');
  first.classList.toggle('complete', complete);
  first.classList.toggle('active', !complete);
  first.querySelector('span').innerHTML = complete ? '<svg><use href="#i-check"/></svg>' : '<b>1</b>';
  first.querySelector('em').textContent = complete ? 'Complete · edit anytime' : 'Complete profile';
  second.classList.toggle('active', complete);
  second.querySelector('em').textContent = complete ? 'In progress' : 'Up next';
}

function applyProfile(profile) {
  if (!profile) { setProfileProgress(false); return; }
  $('#profileName').textContent = profile.name;
  $('#profileAddress').textContent = profile.address;
  $('#roofMapAddress').textContent = profile.address;
  $('#roofAgeSummary').textContent = profile.roofAge || 'Not provided';
  $('.hero-row h1').textContent = `Good morning, ${profile.name.split(' ')[0]}.`;
  setProfileProgress(true);
}

function openProfileModal() {
  const profile = JSON.parse(localStorage.getItem('soloHomeProfile') || 'null');
  $('#homeownerName').value = profile?.name || '';
  $('#homeAddress').value = profile?.address || '';
  $('#homeType').value = profile?.type || 'Single-family home';
  $('#electricBill').value = profile?.bill || '';
  $('#roofAge').value = profile?.roofAge || '';
  $('#homeGoal').value = profile?.goal || 'Replace or repair my roof';
  profileModal.classList.add('open');
  profileModal.setAttribute('aria-hidden', 'false');
  syncScrim();
  setTimeout(() => (profile?.name ? $('#homeAddress') : $('#homeownerName')).focus(), 200);
}

function closeProfileModal() {
  profileModal.classList.remove('open');
  profileModal.setAttribute('aria-hidden', 'true');
  syncScrim();
}

$('#editProfile').addEventListener('click', openProfileModal);
$('#closeProfile').addEventListener('click', closeProfileModal);
$('#cancelProfile').addEventListener('click', closeProfileModal);
$('#profileForm').addEventListener('submit', event => {
  event.preventDefault();
  const profile = Object.fromEntries(new FormData(event.currentTarget));
  localStorage.setItem('soloHomeProfile', JSON.stringify(profile));
  applyProfile(profile);
  closeProfileModal();
  toast('Home profile saved — you can edit it anytime');
});

applyProfile(storedProfile);

function openRoofModal() {
  roofModal.classList.add('open');
  roofModal.setAttribute('aria-hidden', 'false');
  syncScrim();
}
$('#reviewRoof').addEventListener('click', openRoofModal);
$('#startDesign').addEventListener('click', openRoofModal);
$('#closeModal').addEventListener('click', () => { roofModal.classList.remove('open'); syncScrim(); });
$('#continueDesign').addEventListener('click', () => {
  roofModal.classList.remove('open'); syncScrim();
  toast('Roof design started — Solo saved your progress');
  setTimeout(() => openChat('Help me design my new roof'), 450);
});
