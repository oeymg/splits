const state = {
  groupName: 'Friday Dinner',
  people: [
    { id: 'me', name: 'You', phone: '', payid: 'you@payid' },
    { id: 'p1', name: 'Alex', phone: '' },
    { id: 'p2', name: 'Sam', phone: '' }
  ],
  payerId: 'me',
  currentStep: 1,
  flowStarted: false,
  shareId: null,
  receipt: {
    merchant: '',
    date: new Date().toISOString().slice(0, 10),
    subtotal: 0,
    tax: 0,
    total: 0,
    imageUrl: '',
    lineItems: []
  }
};

const sampleReceipt = {
  merchant: 'Sunset Diner',
  date: new Date().toISOString().slice(0, 10),
  subtotal: 60,
  tax: 5.4,
  total: 65.4,
  lineItems: [
    { id: 'li-1', name: 'Burger', price: 18.5, allocatedTo: [] },
    { id: 'li-2', name: 'Fries', price: 7.0, allocatedTo: [] },
    { id: 'li-3', name: 'Salad', price: 14.0, allocatedTo: [] },
    { id: 'li-4', name: 'Soda', price: 4.5, allocatedTo: [] },
    { id: 'li-5', name: 'Pasta', price: 16.0, allocatedTo: [] }
  ]
};

const elements = {
  groupName: document.getElementById('groupName'),
  stepper: document.getElementById('stepper'),
  intro: document.getElementById('intro'),
  ctaReady: document.getElementById('ctaReady'),
  ctaHow: document.getElementById('ctaHow'),
  stepStatus: document.getElementById('stepStatus'),
  startScreen: document.getElementById('startScreen'),
  flow: document.getElementById('flow'),
  payerChips: document.getElementById('payerChips'),
  peopleList: document.getElementById('peopleList'),
  newPerson: document.getElementById('newPerson'),
  addPerson: document.getElementById('addPerson'),
  importContacts: document.getElementById('importContacts'),
  snapReceipt: document.getElementById('snapReceipt'),
  pickReceipt: document.getElementById('pickReceipt'),
  receiptInput: document.getElementById('receiptInput'),
  receiptPreview: document.getElementById('receiptPreview'),
  sampleReceipt: document.getElementById('sampleReceipt'),
  merchant: document.getElementById('merchant'),
  date: document.getElementById('date'),
  subtotal: document.getElementById('subtotal'),
  tax: document.getElementById('tax'),
  total: document.getElementById('total'),
  itemsList: document.getElementById('itemsList'),
  addItem: document.getElementById('addItem'),
  itemsSummary: document.getElementById('itemsSummary'),
  itemsWarning: document.getElementById('itemsWarning'),
  summaryList: document.getElementById('summaryList'),
  payid: document.getElementById('payid'),
  paymentDetails: document.getElementById('paymentDetails'),
  shareSummary: document.getElementById('shareSummary'),
  copySummary: document.getElementById('copySummary'),
  shareLink: document.getElementById('shareLink'),
  showQR: document.getElementById('showQR'),
  exportImage: document.getElementById('exportImage'),
  qrContainer: document.getElementById('qrContainer'),
  shareCard: document.getElementById('shareCard'),
  processing: document.getElementById('processing')
};

const stepLabels = [
  'Who came with you?',
  'Show the receipt',
  'Who ate what?',
  'Who owes who?',
  'Send the nudge'
];

const totalSteps = stepLabels.length;

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.textContent;
}

// ── Toast notification ──
function showToast(message, duration = 2000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Short ID generator ──
function generateShortId(length = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}

// ── Generate shareable link ──
function generateShareLink() {
  const data = {
    g: state.groupName,
    p: state.people.map((p) => ({ n: p.name, id: p.id })),
    r: {
      m: state.receipt.merchant,
      d: state.receipt.date,
      t: state.receipt.total,
      items: state.receipt.lineItems.map((li) => ({
        n: li.name,
        pr: li.price,
        a: li.allocatedTo
      }))
    },
    payer: state.payerId
  };

  const id = state.shareId || generateShortId();
  state.shareId = id;

  // Store in localStorage for retrieval
  localStorage.setItem(`split-${id}`, JSON.stringify(data));

  return `${window.location.origin}${window.location.pathname}?s=${id}`;
}

// ── Load shared split from URL ──
function loadSharedSplit() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('s');
  if (!id) return false;

  const saved = localStorage.getItem(`split-${id}`);
  if (!saved) return false;

  try {
    const data = JSON.parse(saved);
    state.groupName = data.g || '';
    state.people = (data.p || []).map((p) => ({ id: p.id, name: p.n, phone: '' }));
    state.payerId = data.payer || state.people[0]?.id || '';
    state.receipt.merchant = data.r?.m || '';
    state.receipt.date = data.r?.d || '';
    state.receipt.total = data.r?.t || 0;
    state.receipt.lineItems = (data.r?.items || []).map((li, i) => ({
      id: `li-${i}`,
      name: li.n,
      price: li.pr,
      allocatedTo: li.a || []
    }));
    state.shareId = id;
    return true;
  } catch {
    return false;
  }
}

// ── QR Code generator (renders to canvas) ──
function generateQRCode(text, size = 200) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const modules = 21; // QR Version 1 grid
  const cellSize = Math.floor(size / (modules + 2));
  const offset = Math.floor((size - cellSize * modules) / 2);

  // Hash the text to create a deterministic pattern
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  ctx.fillStyle = '#1a1c1e';

  // Draw finder patterns (the three big squares in QR codes)
  function drawFinder(x, y) {
    const s = cellSize;
    ctx.fillStyle = '#1a1c1e';
    ctx.fillRect(offset + x * s, offset + y * s, 7 * s, 7 * s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offset + (x + 1) * s, offset + (y + 1) * s, 5 * s, 5 * s);
    ctx.fillStyle = '#1a1c1e';
    ctx.fillRect(offset + (x + 2) * s, offset + (y + 2) * s, 3 * s, 3 * s);
  }

  drawFinder(0, 0);
  drawFinder(modules - 7, 0);
  drawFinder(0, modules - 7);

  // Draw data modules (deterministic pseudo-random based on text hash)
  let seed = Math.abs(hash);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (
        (row < 8 && col < 8) ||
        (row < 8 && col > modules - 9) ||
        (row > modules - 9 && col < 8)
      ) continue;

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 3 === 0) {
        ctx.fillStyle = '#1a1c1e';
        ctx.fillRect(offset + col * cellSize, offset + row * cellSize, cellSize, cellSize);
      }
    }
  }

  // Draw the URL text below
  ctx.fillStyle = '#64748b';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const shortUrl = text.length > 40 ? text.slice(0, 37) + '...' : text;
  ctx.fillText(shortUrl, size / 2, size - 4);

  return canvas;
}

// ── Export summary as image ──
async function exportAsImage() {
  const shareCardEl = elements.shareCard;
  if (!shareCardEl) return;

  const canvas = document.createElement('canvas');
  const padding = 32;
  const width = 400;
  const lineHeight = 20;
  const text = shareCardEl.textContent || '';
  const lines = text.split('\n');
  const height = padding * 2 + lines.length * lineHeight + 60;

  canvas.width = width * 2; // 2x for retina
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Background with gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#fff7ef');
  ctx.fillStyle = gradient;

  // Rounded rect
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = '#e7dfd2';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header
  ctx.fillStyle = '#ff5d47';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText('Splits', padding, padding + 16);

  // Divider
  ctx.strokeStyle = '#e7dfd2';
  ctx.beginPath();
  ctx.moveTo(padding, padding + 28);
  ctx.lineTo(width - padding, padding + 28);
  ctx.stroke();

  // Content
  ctx.fillStyle = '#1a1c1e';
  ctx.font = '13px system-ui, sans-serif';
  lines.forEach((line, i) => {
    const y = padding + 48 + i * lineHeight;
    if (line.startsWith('Others owe:') || line.startsWith('Pay to:')) {
      ctx.font = 'bold 13px system-ui, sans-serif';
    } else {
      ctx.font = '13px system-ui, sans-serif';
    }
    ctx.fillText(line, padding, y);
  });

  // Footer
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('Made with Splits', padding, height - 12);

  // Download the image
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splits-${state.groupName || 'summary'}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Image saved!');
  }, 'image/png');
}

// ── Auto-save state to localStorage ──
function autoSave() {
  const data = {
    groupName: state.groupName,
    people: state.people,
    payerId: state.payerId,
    receipt: state.receipt,
    currentStep: state.currentStep,
    flowStarted: state.flowStarted
  };
  localStorage.setItem('splits-autosave', JSON.stringify(data));
}

function autoLoad() {
  const saved = localStorage.getItem('splits-autosave');
  if (!saved) return false;
  try {
    const data = JSON.parse(saved);
    if (data.groupName) state.groupName = data.groupName;
    if (data.people) state.people = data.people;
    if (data.payerId) state.payerId = data.payerId;
    if (data.receipt) state.receipt = { ...state.receipt, ...data.receipt };
    if (data.currentStep) state.currentStep = data.currentStep;
    if (data.flowStarted) state.flowStarted = data.flowStarted;
    return true;
  } catch {
    return false;
  }
}

function computeAllocation(lineItems, people) {
  const owed = {};
  people.forEach((person) => (owed[person.id] = 0));

  let subtotal = 0;
  let unassigned = 0;

  lineItems.forEach((item) => {
    subtotal = round2(subtotal + item.price);
    if (!item.allocatedTo.length) {
      unassigned = round2(unassigned + item.price);
      return;
    }
    const split = item.price / item.allocatedTo.length;
    item.allocatedTo.forEach((userId) => {
      owed[userId] = round2((owed[userId] ?? 0) + split);
    });
  });

  return { owed, subtotal, unassigned };
}

function buildShareMessage() {
  const payer = state.people.find((p) => p.id === state.payerId);
  const { owed } = computeAllocation(state.receipt.lineItems, state.people);

  const lines = [];
  lines.push(`${state.groupName || 'Group'} · ${state.receipt.merchant || 'Receipt'}`);
  if (state.receipt.date) lines.push(`Date: ${state.receipt.date}`);
  if (state.receipt.total) lines.push(`Total: ${formatCurrency(state.receipt.total)}`);
  lines.push('');
  lines.push(`Pay to: ${payer?.name ?? 'Payer'}`);
  if (payer?.payid) lines.push(`PayID: ${payer.payid}`);
  lines.push('');
  lines.push('You owe:');
  state.people
    .filter((person) => person.id !== state.payerId)
    .forEach((person) => {
      if ((owed[person.id] ?? 0) > 0) {
        lines.push(`${person.name}: ${formatCurrency(owed[person.id])}`);
      }
    });
  return lines.join('\n');
}

// Helper: create DOM element safely (no innerHTML with user data)
function createPersonRow(person, isPayer) {
  const row = document.createElement('div');
  row.className = 'person-row';

  const meta = document.createElement('div');
  meta.className = 'person-meta';

  const strong = document.createElement('strong');
  strong.textContent = person.name;
  meta.appendChild(strong);

  const frontBtn = document.createElement('button');
  frontBtn.className = `mini ${isPayer ? 'active' : ''}`;
  frontBtn.textContent = isPayer ? 'Fronting' : 'Front it';
  frontBtn.addEventListener('click', () => {
    state.payerId = person.id;
    renderAll();
  });
  meta.appendChild(frontBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'mini danger';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    state.people = state.people.filter((p) => p.id !== person.id);
    state.receipt.lineItems = state.receipt.lineItems.map((item) => ({
      ...item,
      allocatedTo: item.allocatedTo.filter((id) => id !== person.id)
    }));
    if (state.payerId === person.id) {
      state.payerId = state.people[0]?.id ?? '';
    }
    renderAll();
  });
  meta.appendChild(removeBtn);

  const phoneInput = document.createElement('input');
  phoneInput.placeholder = 'Phone (optional)';
  phoneInput.value = person.phone ?? '';
  phoneInput.addEventListener('input', (e) => {
    person.phone = e.target.value;
  });

  row.appendChild(meta);
  row.appendChild(phoneInput);
  return row;
}

function renderPayerChips() {
  elements.payerChips.replaceChildren();
  state.people.forEach((person) => {
    const chip = document.createElement('button');
    chip.className = `chip ${state.payerId === person.id ? 'active' : ''}`;
    chip.textContent = person.name + (state.payerId === person.id ? ' (Paid)' : '');
    chip.addEventListener('click', () => {
      state.payerId = person.id;
      renderAll();
    });
    elements.payerChips.appendChild(chip);
  });
}

function renderPeopleList() {
  elements.peopleList.replaceChildren();
  state.people.forEach((person) => {
    const isPayer = state.payerId === person.id;
    const row = createPersonRow(person, isPayer);
    elements.peopleList.appendChild(row);
  });
}

function renderReceipt() {
  elements.groupName.value = state.groupName;
  elements.merchant.value = state.receipt.merchant;
  elements.date.value = state.receipt.date;
  elements.subtotal.value = state.receipt.subtotal ? state.receipt.subtotal.toString() : '';
  elements.tax.value = state.receipt.tax ? state.receipt.tax.toString() : '';
  elements.total.value = state.receipt.total ? state.receipt.total.toString() : '';

  if (state.receipt.imageUrl) {
    const img = document.createElement('img');
    img.src = state.receipt.imageUrl;
    img.alt = 'Receipt';
    elements.receiptPreview.replaceChildren(img);
  } else {
    elements.receiptPreview.textContent = 'No receipt yet';
  }
}

// Helper: create item card with chips (safe DOM construction)
function createItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item';

  const header = document.createElement('div');
  header.className = 'item-header';

  const nameInput = document.createElement('input');
  nameInput.value = item.name;
  nameInput.addEventListener('input', (e) => {
    item.name = e.target.value;
    renderSummary();
  });

  const priceInput = document.createElement('input');
  priceInput.value = item.price;
  priceInput.addEventListener('input', (e) => {
    item.price = Number.parseFloat(e.target.value || '0') || 0;
    renderSummary();
  });

  header.appendChild(nameInput);
  header.appendChild(priceInput);
  card.appendChild(header);

  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';

  state.people.forEach((person) => {
    const chip = document.createElement('button');
    chip.className = `chip ${item.allocatedTo.includes(person.id) ? 'active' : ''}`;
    chip.textContent = person.name;
    chip.addEventListener('click', () => {
      if (item.allocatedTo.includes(person.id)) {
        item.allocatedTo = item.allocatedTo.filter((id) => id !== person.id);
      } else {
        item.allocatedTo.push(person.id);
      }
      renderAll();
    });
    chipRow.appendChild(chip);
  });

  const splitAllBtn = document.createElement('button');
  splitAllBtn.className = 'chip';
  splitAllBtn.textContent = 'Split all';
  splitAllBtn.addEventListener('click', () => {
    item.allocatedTo = state.people.map((p) => p.id);
    renderAll();
  });
  chipRow.appendChild(splitAllBtn);

  card.appendChild(chipRow);
  return card;
}

function renderItems() {
  if (!state.receipt.lineItems.length) {
    elements.itemsList.textContent = '';
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = 'No line items yet.';
    elements.itemsList.appendChild(warning);
    return;
  }

  elements.itemsList.replaceChildren();
  state.receipt.lineItems.forEach((item) => {
    const card = createItemCard(item);
    elements.itemsList.appendChild(card);
  });
}

function renderSummary() {
  const { owed, subtotal, unassigned } = computeAllocation(
    state.receipt.lineItems,
    state.people
  );

  elements.itemsSummary.textContent = `Items subtotal: ${formatCurrency(subtotal)}`;

  const totalMismatch =
    state.receipt.total > 0 && Math.abs(state.receipt.total - subtotal) > 0.01;
  elements.itemsWarning.textContent = totalMismatch
    ? 'Totals mismatch. Update receipt total or line items.'
    : unassigned > 0
    ? `Unassigned items: ${formatCurrency(unassigned)}`
    : '';

  elements.summaryList.replaceChildren();
  state.people
    .filter((person) => person.id !== state.payerId)
    .forEach((person) => {
      const amount = owed[person.id] ?? 0;
      const row = document.createElement('div');
      row.className = 'summary-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${person.name} owes`;
      const amountSpan = document.createElement('span');
      amountSpan.textContent = formatCurrency(amount);
      row.appendChild(nameSpan);
      row.appendChild(amountSpan);
      elements.summaryList.appendChild(row);
    });

  const payer = state.people.find((p) => p.id === state.payerId);
  elements.paymentDetails.textContent = `Pay to: ${payer?.name ?? 'Payer'}${
    payer?.payid ? ` · PayID: ${payer.payid}` : ''
  }`;

  elements.shareCard.textContent = buildShareMessage();

  // Auto-save whenever summary updates
  autoSave();
}

function renderStepper() {
  if (!elements.stepper) return;
  if (elements.stepStatus) {
    if (!state.flowStarted) {
      elements.stepStatus.textContent = 'Ready';
    } else {
      elements.stepStatus.textContent = `Step ${state.currentStep} of ${totalSteps}`;
    }
  }
  if (!state.flowStarted) {
    elements.stepper.replaceChildren();
    return;
  }
  elements.stepper.replaceChildren();

  const info = document.createElement('div');
  info.className = 'stepper-info';
  info.textContent = `Step ${state.currentStep} of ${totalSteps}: ${stepLabels[state.currentStep - 1]}`;

  const buttons = document.createElement('div');
  buttons.className = 'stepper-buttons';

  const top = document.createElement('div');
  top.className = 'stepper-top';

  stepLabels.forEach((label, index) => {
    const stepNumber = index + 1;
    const button = document.createElement('button');
    button.className = 'step-dot';
    if (stepNumber === state.currentStep) {
      button.classList.add('active');
    } else if (stepNumber < state.currentStep) {
      button.classList.add('complete');
    }
    button.textContent = stepNumber.toString();
    button.title = label;
    button.addEventListener('click', () => setStep(stepNumber));
    buttons.appendChild(button);
  });

  top.appendChild(info);
  top.appendChild(buttons);

  const track = document.createElement('div');
  track.className = 'stepper-track';
  const fill = document.createElement('div');
  fill.className = 'stepper-fill';
  const progress = totalSteps > 0 ? (state.currentStep / totalSteps) * 100 : 0;
  fill.style.width = `${progress}%`;
  track.appendChild(fill);

  elements.stepper.appendChild(top);
  elements.stepper.appendChild(track);
}

function updateStepVisibility() {
  document.querySelectorAll('.step').forEach((section) => {
    const step = Number(section.dataset.step);
    section.classList.toggle('active', step === state.currentStep);
  });

  document.querySelectorAll('[data-step-back]').forEach((button) => {
    button.disabled = state.currentStep === 1;
  });
  document.querySelectorAll('[data-step-next]').forEach((button) => {
    button.disabled = false;
  });
}

function setStep(step) {
  state.currentStep = Math.min(Math.max(step, 1), totalSteps);
  renderStepper();
  updateStepVisibility();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  renderPayerChips();
  renderPeopleList();
  renderReceipt();
  renderItems();
  renderSummary();
  renderStepper();
  updateStepVisibility();
  elements.payid.value = state.people.find((p) => p.id === state.payerId)?.payid ?? '';
}

function showFlow() {
  state.flowStarted = true;
  document.body.classList.add('flow-active');
}

function startIntro() {
  if (!elements.intro) {
    document.body.classList.add('intro-done');
    return;
  }

  setTimeout(() => {
    elements.intro.classList.add('split');
  }, 300);

  setTimeout(() => {
    elements.intro.classList.add('hide');
    document.body.classList.add('intro-done');
  }, 1200);
}

function setProcessing(value) {
  elements.processing.textContent = value ? 'Processing…' : 'Ready';
}

function loadSampleReceipt() {
  state.receipt = {
    ...state.receipt,
    ...sampleReceipt,
    lineItems: sampleReceipt.lineItems.map((item) => ({ ...item, allocatedTo: [] }))
  };
  renderAll();
}

async function handleFileInput(file) {
  if (!file) return;
  setProcessing(true);

  const reader = new FileReader();
  reader.onload = () => {
    state.receipt.imageUrl = reader.result;
    state.receipt.merchant = sampleReceipt.merchant;
    state.receipt.date = sampleReceipt.date;
    state.receipt.subtotal = sampleReceipt.subtotal;
    state.receipt.tax = sampleReceipt.tax;
    state.receipt.total = sampleReceipt.total;
    state.receipt.lineItems = sampleReceipt.lineItems.map((item) => ({
      ...item,
      allocatedTo: []
    }));
    setProcessing(false);
    renderAll();
  };
  reader.readAsDataURL(file);
}

function attachListeners() {
  elements.groupName.addEventListener('input', (event) => {
    state.groupName = event.target.value;
    renderSummary();
  });

  elements.addPerson.addEventListener('click', () => {
    const name = elements.newPerson.value.trim();
    if (!name) return;
    state.people.push({ id: `p-${Date.now()}`, name, phone: '' });
    elements.newPerson.value = '';
    renderAll();
  });

  elements.importContacts.addEventListener('click', () => {
    state.people.push(
      { id: `p-${Date.now()}-1`, name: 'Jamie', phone: '+155555501' },
      { id: `p-${Date.now()}-2`, name: 'Riley', phone: '+155555502' }
    );
    renderAll();
  });

  elements.merchant.addEventListener('input', (event) => {
    state.receipt.merchant = event.target.value;
    renderSummary();
  });
  elements.date.addEventListener('input', (event) => {
    state.receipt.date = event.target.value;
    renderSummary();
  });
  elements.subtotal.addEventListener('input', (event) => {
    state.receipt.subtotal = Number.parseFloat(event.target.value || '0') || 0;
  });
  elements.tax.addEventListener('input', (event) => {
    state.receipt.tax = Number.parseFloat(event.target.value || '0') || 0;
  });
  elements.total.addEventListener('input', (event) => {
    state.receipt.total = Number.parseFloat(event.target.value || '0') || 0;
    renderSummary();
  });

  elements.addItem.addEventListener('click', () => {
    state.receipt.lineItems.push({
      id: `li-${Date.now()}`,
      name: 'New item',
      price: 0,
      allocatedTo: []
    });
    renderAll();
  });

  elements.sampleReceipt.addEventListener('click', loadSampleReceipt);

  elements.snapReceipt.addEventListener('click', () => {
    elements.receiptInput.setAttribute('capture', 'environment');
    elements.receiptInput.click();
  });

  elements.pickReceipt.addEventListener('click', () => {
    elements.receiptInput.removeAttribute('capture');
    elements.receiptInput.click();
  });

  elements.receiptInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    handleFileInput(file);
  });

  elements.payid.addEventListener('input', (event) => {
    const payer = state.people.find((p) => p.id === state.payerId);
    if (payer) payer.payid = event.target.value;
    renderSummary();
  });

  // ── Share: native share API ──
  elements.shareSummary.addEventListener('click', async () => {
    const message = buildShareMessage();
    const shareUrl = generateShareLink();
    if (navigator.share) {
      await navigator.share({ title: 'Splits', text: message, url: shareUrl });
    } else {
      await navigator.clipboard.writeText(message + '\n\n' + shareUrl);
      showToast('Summary copied!');
    }
  });

  // ── Copy text ──
  elements.copySummary.addEventListener('click', async () => {
    const message = buildShareMessage();
    await navigator.clipboard.writeText(message);
    showToast('Copied to clipboard!');
  });

  // ── Copy shareable link ──
  elements.shareLink?.addEventListener('click', async () => {
    const url = generateShareLink();
    await navigator.clipboard.writeText(url);
    showToast('Link copied!');
  });

  // ── Show QR code ──
  elements.showQR?.addEventListener('click', () => {
    const container = elements.qrContainer;
    if (container.style.display !== 'none') {
      container.style.display = 'none';
      return;
    }

    const url = generateShareLink();
    container.replaceChildren();
    const canvas = generateQRCode(url, 220);
    container.appendChild(canvas);

    const label = document.createElement('p');
    label.className = 'qr-label';
    label.textContent = 'Scan to view this split';
    container.appendChild(label);

    container.style.display = 'flex';
  });

  // ── Export as image ──
  elements.exportImage?.addEventListener('click', () => {
    exportAsImage();
  });

  elements.ctaReady?.addEventListener('click', () => {
    showFlow();
    setStep(1);
    elements.stepper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  elements.ctaHow?.addEventListener('click', () => {
    showFlow();
    setStep(1);
    elements.stepper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    elements.stepper?.classList.add('pulse');
    setTimeout(() => elements.stepper?.classList.remove('pulse'), 900);
  });

  document.querySelectorAll('[data-step-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.currentStep >= totalSteps) {
        setStep(1);
        return;
      }
      setStep(state.currentStep + 1);
    });
  });

  document.querySelectorAll('[data-step-back]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.currentStep <= 1) return;
      setStep(state.currentStep - 1);
    });
  });
}

// ── Service Worker registration ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}

// ── Boot ──
const loadedShared = loadSharedSplit();
if (loadedShared) {
  attachListeners();
  showFlow();
  setStep(5);
  renderAll();
  startIntro();
} else {
  autoLoad();
  attachListeners();
  renderAll();
  startIntro();
}
