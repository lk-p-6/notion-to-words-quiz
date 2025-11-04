const appRoot = document.getElementById('app');

const topicsConfig = [
  {
    id: 'flashcards',
    label: 'Flashcards',
    description: 'Заучи новые слова через карточки и быстрый повтор.',
    sectionKey: 'newWords'
  },
  {
    id: 'corrections',
    label: 'Corrections',
    description: 'Разбери исправления и обрати внимание на детали.',
    sectionKey: 'corrections'
  },
  {
    id: 'sentences',
    label: 'Sentences',
    description: 'Отработай предложения, чтобы звучать естественно.',
    sectionKey: 'sentences'
  }
];

const state = {
  view: 'landing',
  loading: false,
  error: null,
  notion: null,
  topicState: {},
  flashcardSession: null,
  simpleDrills: {}
};

function setView(view) {
  state.view = view;
  render();
}

function resetLearningState() {
  state.flashcardSession = null;
  state.simpleDrills = {};
  state.topicState = {};
}

async function handleStartLearning(url) {
  if (!url || !url.trim()) {
    state.error = 'Добавь ссылку на страницу Notion.';
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  render();

  try {
    const response = await fetch('/api/notion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url.trim() })
    });

    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      const message = problem?.error || 'Не удалось получить данные из Notion.';
      throw new Error(message);
    }

    const payload = await response.json();
    resetLearningState();
    state.notion = payload;

    topicsConfig.forEach((topic) => {
      const sectionItems = payload.sections?.[topic.sectionKey] || [];
      state.topicState[topic.id] = {
        available: Array.isArray(sectionItems) && sectionItems.length > 0,
        completed: false
      };
    });

    state.loading = false;
    setView('menu');
  } catch (err) {
    state.loading = false;
    state.error = err.message || 'Что-то пошло не так. Попробуй ещё раз.';
    render();
  }
}

function getTopicItems(topicId) {
  if (!state.notion) return [];
  const config = topicsConfig.find((topic) => topic.id === topicId);
  if (!config) return [];
  const items = state.notion.sections?.[config.sectionKey];
  return Array.isArray(items) ? items : [];
}

function ensureFlashcardSession() {
  if (!state.notion) return null;
  const cards = getTopicItems('flashcards');
  if (!cards.length) return null;
  if (!state.flashcardSession || state.flashcardSession.cardsSignature !== JSON.stringify(cards)) {
    state.flashcardSession = createFlashcardSession(cards);
  }
  return state.flashcardSession;
}

function ensureSimpleDrill(topicId) {
  const items = getTopicItems(topicId);
  const signature = JSON.stringify(items);
  if (!state.simpleDrills[topicId] || state.simpleDrills[topicId].signature !== signature) {
    state.simpleDrills[topicId] = {
      signature,
      checked: new Set()
    };
  }
  return state.simpleDrills[topicId];
}

function render() {
  appRoot.innerHTML = '';
  let viewContent;

  switch (state.view) {
    case 'menu':
      viewContent = renderDashboard();
      break;
    case 'flashcards':
      viewContent = renderFlashcards();
      break;
    case 'corrections':
    case 'sentences':
      viewContent = renderSimpleDrill(state.view);
      break;
    case 'landing':
    default:
      viewContent = renderLanding();
  }

  if (viewContent) {
    appRoot.appendChild(viewContent);
  }
}

function renderLanding() {
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const wrapper = document.createElement('div');
  wrapper.className = 'landing';

  const title = document.createElement('h1');
  title.className = 'brand-title';
  title.textContent = 'Lesson Coach';

  const subtitle = document.createElement('p');
  subtitle.className = 'brand-subtitle';
  subtitle.textContent = 'Вставь ссылку на страницу урока в Notion и начни учиться в стиле Apple + ChatGPT.';

  const form = document.createElement('div');
  form.className = 'landing-form';

  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://www.notion.so/...';
  input.autocomplete = 'off';

  const button = document.createElement('button');
  button.className = 'primary-btn';
  button.textContent = state.loading ? 'Загружаю...' : 'Start Learning';
  button.disabled = state.loading;

  button.addEventListener('click', () => {
    handleStartLearning(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleStartLearning(input.value);
    }
  });

  form.appendChild(input);
  form.appendChild(button);

  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(form);

  if (state.loading) {
    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.textContent = 'Готовим твоё обучение...';
    wrapper.appendChild(loader);
  }

  if (state.error) {
    const error = document.createElement('div');
    error.className = 'error-banner';
    error.textContent = state.error;
    wrapper.appendChild(error);
  }

  shell.appendChild(wrapper);
  return shell;
}

function renderDashboard() {
  if (!state.notion) {
    return renderLanding();
  }

  const shell = document.createElement('div');
  shell.className = 'app-shell dashboard';

  const header = document.createElement('div');
  header.className = 'dashboard-header';

  const title = document.createElement('h1');
  title.className = 'dashboard-title';
  title.textContent = state.notion.title || 'Lesson';

  const progress = document.createElement('div');
  progress.className = 'dashboard-progress';

  const availableTopics = topicsConfig.filter((topic) => state.topicState[topic.id]?.available);
  const completedTopics = availableTopics.filter((topic) => state.topicState[topic.id]?.completed);
  const progressValue = availableTopics.length
    ? (completedTopics.length / availableTopics.length) * 100
    : 0;

  const progressLabel = document.createElement('div');
  progressLabel.className = 'progress-label';
  progressLabel.innerHTML = `<span>Общий прогресс</span><span>${completedTopics.length} из ${availableTopics.length}</span>`;

  const progressBar = createProgressBar(progressValue);

  progress.appendChild(progressLabel);
  progress.appendChild(progressBar);

  header.appendChild(title);
  header.appendChild(progress);

  const divider = document.createElement('div');
  divider.className = 'section-divider';

  const grid = document.createElement('div');
  grid.className = 'topic-grid';

  topicsConfig.forEach((topic) => {
    const status = state.topicState[topic.id] || { available: false, completed: false };
    const card = document.createElement('div');
    card.className = 'topic-card';

    const cardTitle = document.createElement('h2');
    cardTitle.className = 'topic-title';
    cardTitle.textContent = topic.label;

    const description = document.createElement('p');
    description.className = 'topic-description';
    description.textContent = topic.description;

    const actions = document.createElement('div');
    actions.className = 'topic-actions';

    const startButton = document.createElement('button');
    startButton.textContent = 'Начать';
    startButton.disabled = !status.available;
    startButton.addEventListener('click', () => {
      if (!status.available) return;
      if (topic.id === 'flashcards') {
        ensureFlashcardSession();
      } else {
        ensureSimpleDrill(topic.id);
      }
      setView(topic.id);
    });

    const indicator = document.createElement('div');
    indicator.className = 'status-indicator';
    if (status.completed) {
      indicator.classList.add('completed');
    } else if (!status.available) {
      indicator.classList.add('disabled');
    }

    const dot = document.createElement('span');
    dot.className = 'dot';

    const label = document.createElement('span');
    label.textContent = status.completed ? 'Завершено' : status.available ? 'Не начато' : 'Нет данных';

    indicator.appendChild(dot);
    indicator.appendChild(label);

    actions.appendChild(startButton);
    actions.appendChild(indicator);

    card.appendChild(cardTitle);
    card.appendChild(description);
    card.appendChild(actions);

    grid.appendChild(card);
  });

  shell.appendChild(header);
  shell.appendChild(divider);
  shell.appendChild(grid);

  return shell;
}

function renderFlashcards() {
  const session = ensureFlashcardSession();
  const shell = document.createElement('div');
  shell.className = 'app-shell flashcard-layout';

  if (!session || !session.cards.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.innerHTML = 'Для раздела «Мילים חדשות – Новые слова» не найдено слов. Добавь их в Notion и попробуй снова.';
    shell.appendChild(createTopBarBackOnly('Вернуться к разделам'));
    shell.appendChild(empty);
    return shell;
  }

  if (session.stage === 'completed') {
    shell.appendChild(createFlashcardCompletion(session));
    return shell;
  }

  const top = document.createElement('div');
  top.className = 'flashcard-top';

  const meta = document.createElement('div');
  meta.className = 'flashcard-meta';

  const backButton = createBackButton('Назад к модулям', () => {
    setView('menu');
  });

  const progressInfo = document.createElement('div');
  progressInfo.className = 'flashcard-stage';
  const processed = getFlashcardProcessed(session);
  const totalLabel = session.stage === 'repeat' ? `${processed.current} / ${processed.total} повторений` : `${processed.current} / ${processed.total} слов`;
  const stageLabel = session.stage === 'repeat'
    ? `Повторение ${Math.max(session.cycle, 1)}`
    : 'Основной проход';
  progressInfo.innerHTML = `<div>${stageLabel}</div><div>${totalLabel}</div>`;

  const shortcuts = document.createElement('div');
  shortcuts.className = 'flashcard-shortcuts';
  shortcuts.innerHTML = '⟵ <kbd>←</kbd> повторить · <kbd>пробел</kbd> перевернуть · <kbd>→</kbd> выучено';
  shortcuts.style.fontSize = '13px';
  shortcuts.style.color = 'var(--text-muted)';

  meta.appendChild(backButton);
  meta.appendChild(progressInfo);
  meta.appendChild(shortcuts);

  const counters = document.createElement('div');
  counters.className = 'flashcard-counters';
  const repeats = document.createElement('div');
  repeats.textContent = `В повторении: ${getRepeatCount(session)}`;
  const learned = document.createElement('div');
  learned.textContent = `Выучено: ${session.learnedIds.length}`;
  counters.appendChild(repeats);
  counters.appendChild(learned);

  top.appendChild(meta);
  top.appendChild(counters);

  const main = document.createElement('div');
  main.className = 'flashcard-main';

  const wrapper = document.createElement('div');
  wrapper.className = 'flashcard-wrapper';

  const cardEl = document.createElement('div');
  cardEl.className = 'flashcard';
  if (session.isFlipped) {
    cardEl.classList.add('flipped');
  }

  const front = document.createElement('div');
  front.className = 'flashcard-face front';
  front.textContent = getCurrentCard(session)?.native ?? '—';

  const back = document.createElement('div');
  back.className = 'flashcard-face back';
  back.textContent = getCurrentCard(session)?.learning ?? '—';

  cardEl.appendChild(front);
  cardEl.appendChild(back);

  cardEl.addEventListener('click', () => {
    toggleFlashcard();
  });

  wrapper.appendChild(cardEl);
  main.appendChild(wrapper);

  const actionsLayer = document.createElement('div');
  actionsLayer.className = 'flashcard-actions';

  const repeatBtn = document.createElement('button');
  repeatBtn.className = 'flashcard-action-button left';
  repeatBtn.innerHTML = '⟲';
  repeatBtn.title = 'В повторение (←)';
  repeatBtn.addEventListener('click', () => {
    applyFlashcardAction('repeat');
  });

  const learnedBtn = document.createElement('button');
  learnedBtn.className = 'flashcard-action-button right';
  learnedBtn.innerHTML = '✓';
  learnedBtn.title = 'Выучено (→)';
  learnedBtn.addEventListener('click', () => {
    applyFlashcardAction('learned');
  });

  actionsLayer.appendChild(repeatBtn);
  actionsLayer.appendChild(learnedBtn);
  main.appendChild(actionsLayer);

  const footer = document.createElement('div');
  footer.className = 'flashcard-footer';

  const undo = document.createElement('button');
  undo.textContent = 'Назад';
  undo.addEventListener('click', () => {
    undoFlashcard();
  });

  const footerProgress = document.createElement('div');
  footerProgress.className = 'footer-progress';
  const learnedRatio = session.cards.length ? Math.round((session.learnedIds.length / session.cards.length) * 100) : 0;
  const label = document.createElement('div');
  label.innerHTML = `<strong>Выучено:</strong> ${session.learnedIds.length} из ${session.cards.length}`;
  const bar = createProgressBar(learnedRatio);
  footerProgress.appendChild(label);
  footerProgress.appendChild(bar);

  const reset = document.createElement('button');
  reset.textContent = 'Очистить';
  reset.addEventListener('click', () => {
    resetFlashcards();
  });

  footer.appendChild(undo);
  footer.appendChild(footerProgress);
  footer.appendChild(reset);

  shell.appendChild(top);
  shell.appendChild(main);
  shell.appendChild(footer);

  return shell;
}

function renderSimpleDrill(topicId) {
  const items = getTopicItems(topicId);
  const drill = ensureSimpleDrill(topicId);

  const shell = document.createElement('div');
  shell.className = 'app-shell simple-drill';

  const header = document.createElement('div');
  header.className = 'simple-drill-header';

  const back = createBackButton('Назад к модулям', () => {
    setView('menu');
  });

  const info = document.createElement('div');
  info.style.display = 'flex';
  info.style.flexDirection = 'column';
  info.style.gap = '6px';

  const title = document.createElement('h2');
  title.className = 'dashboard-title';
  const config = topicsConfig.find((topic) => topic.id === topicId);
  title.textContent = config?.label ?? 'Practice';

  const progressValue = items.length ? Math.round((drill.checked.size / items.length) * 100) : 0;
  const infoText = document.createElement('span');
  infoText.style.color = 'var(--text-muted)';
  infoText.textContent = items.length ? `${drill.checked.size} из ${items.length} готово` : 'Нет данных для тренировки.';

  const progressBar = createProgressBar(progressValue);

  info.appendChild(title);
  info.appendChild(infoText);
  info.appendChild(progressBar);

  header.appendChild(back);
  header.appendChild(info);

  shell.appendChild(header);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.innerHTML = 'Раздел пуст. Добавь материалы в Notion, чтобы потренироваться.';
    shell.appendChild(empty);
    return shell;
  }

  const list = document.createElement('div');
  list.className = 'simple-drill-list';

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'simple-drill-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${topicId}-item-${index}`;
    checkbox.checked = drill.checked.has(index);

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        drill.checked.add(index);
      } else {
        drill.checked.delete(index);
      }
      const isCompleted = drill.checked.size === items.length;
      state.topicState[topicId].completed = isCompleted;
      render();
    });

    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);
    label.textContent = item;

    row.appendChild(checkbox);
    row.appendChild(label);
    list.appendChild(row);
  });

  shell.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'simple-drill-footer';

  const reset = document.createElement('button');
  reset.textContent = 'Сбросить отмеченное';
  reset.addEventListener('click', () => {
    drill.checked.clear();
    state.topicState[topicId].completed = false;
    render();
  });

  const summary = document.createElement('div');
  summary.className = 'simple-drill-progress';
  const summaryLabel = document.createElement('div');
  summaryLabel.innerHTML = `<strong>Прогресс:</strong> ${drill.checked.size} из ${items.length}`;
  const summaryBar = createProgressBar(progressValue);
  summary.appendChild(summaryLabel);
  summary.appendChild(summaryBar);

  footer.appendChild(reset);
  footer.appendChild(summary);

  shell.appendChild(footer);

  if (drill.checked.size === items.length) {
    state.topicState[topicId].completed = true;
  }

  return shell;
}

function createTopBarBackOnly(text) {
  const container = document.createElement('div');
  container.style.padding = '28px';
  const back = createBackButton(text, () => {
    setView('menu');
  });
  container.appendChild(back);
  return container;
}

function createBackButton(text, handler) {
  const back = document.createElement('button');
  back.className = 'back-button';
  back.type = 'button';
  back.innerHTML = `← ${text}`;
  back.addEventListener('click', handler);
  return back;
}

function createProgressBar(percent) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const span = document.createElement('span');
  span.style.width = `${clamped}%`;
  bar.appendChild(span);
  return bar;
}

function createFlashcardSession(cards) {
  const normalized = cards.map((card, index) => ({
    id: index,
    native: card.native || card.original || '',
    learning: card.learning || '',
    original: card.original || ''
  }));
  const map = {};
  normalized.forEach((card) => {
    map[card.id] = card;
  });
  return {
    cards: normalized,
    cardMap: map,
    cardsSignature: JSON.stringify(cards),
    queue: normalized.map((card) => card.id),
    repeatQueue: [],
    learnedIds: [],
    stage: normalized.length ? 'primary' : 'completed',
    repeatRoundTotal: 0,
    repeatsCompleted: 0,
    cycle: 0,
    history: [],
    isFlipped: false
  };
}

function getCurrentCard(session) {
  if (!session || !session.queue.length) {
    return null;
  }
  const cardId = session.queue[0];
  return session.cardMap[cardId] || null;
}

function toggleFlashcard() {
  const session = state.flashcardSession;
  if (!session || session.stage === 'completed') return;
  session.isFlipped = !session.isFlipped;
  render();
}

function applyFlashcardAction(action) {
  const session = state.flashcardSession;
  if (!session || session.stage === 'completed' || !session.queue.length) return;
  if (action !== 'learned' && action !== 'repeat') return;

  saveFlashcardSnapshot();

  const currentId = session.queue.shift();
  session.isFlipped = false;

  if (session.stage === 'repeat') {
    session.repeatsCompleted += 1;
  }

  if (action === 'learned') {
    if (!session.learnedIds.includes(currentId)) {
      session.learnedIds.push(currentId);
    }
  } else {
    session.repeatQueue.push(currentId);
  }

  updateFlashcardQueues();
  render();
}

function saveFlashcardSnapshot() {
  const session = state.flashcardSession;
  if (!session) return;
  session.history.push({
    queue: [...session.queue],
    repeatQueue: [...session.repeatQueue],
    learnedIds: [...session.learnedIds],
    stage: session.stage,
    repeatRoundTotal: session.repeatRoundTotal,
    repeatsCompleted: session.repeatsCompleted,
    cycle: session.cycle,
    isFlipped: session.isFlipped,
    topicCompleted: state.topicState.flashcards?.completed ?? false
  });
}

function undoFlashcard() {
  const session = state.flashcardSession;
  if (!session || !session.history.length) return;
  const snapshot = session.history.pop();
  session.queue = snapshot.queue;
  session.repeatQueue = snapshot.repeatQueue;
  session.learnedIds = snapshot.learnedIds;
  session.stage = snapshot.stage;
  session.repeatRoundTotal = snapshot.repeatRoundTotal;
  session.repeatsCompleted = snapshot.repeatsCompleted;
  session.cycle = snapshot.cycle;
  session.isFlipped = snapshot.isFlipped;
  state.topicState.flashcards.completed = snapshot.topicCompleted;
  render();
}

function resetFlashcards() {
  const cards = getTopicItems('flashcards');
  state.flashcardSession = createFlashcardSession(cards);
  state.topicState.flashcards.completed = false;
  render();
}

function updateFlashcardQueues() {
  const session = state.flashcardSession;
  if (!session) return;

  if (!session.queue.length) {
    if (session.stage === 'primary') {
      if (session.repeatQueue.length) {
        session.stage = 'repeat';
        session.queue = session.repeatQueue.slice();
        session.repeatQueue = [];
        session.repeatRoundTotal = session.queue.length;
        session.repeatsCompleted = 0;
        session.cycle = 1;
      } else {
        session.stage = 'completed';
        state.topicState.flashcards.completed = true;
      }
    } else if (session.stage === 'repeat') {
      if (session.repeatQueue.length) {
        session.queue = session.repeatQueue.slice();
        session.repeatQueue = [];
        session.repeatRoundTotal = session.queue.length;
        session.repeatsCompleted = 0;
        session.cycle += 1;
      } else {
        session.stage = 'completed';
        state.topicState.flashcards.completed = true;
      }
    }
  }
}

function getRepeatCount(session) {
  if (!session) return 0;
  const currentQueue = session.stage === 'repeat' ? session.queue.length : 0;
  return session.repeatQueue.length + currentQueue;
}

function getFlashcardProcessed(session) {
  if (!session) {
    return { current: 0, total: 0 };
  }
  if (session.stage === 'repeat') {
    return { current: session.repeatsCompleted, total: session.repeatRoundTotal || session.queue.length };
  }
  const total = session.cards.length;
  const current = total - session.queue.length;
  return { current, total };
}

function createFlashcardCompletion(session) {
  const container = document.createElement('div');
  container.className = 'completion-state';

  const icon = document.createElement('div');
  icon.className = 'completion-icon';
  icon.textContent = '✓';

  const title = document.createElement('h2');
  title.className = 'dashboard-title';
  title.style.textAlign = 'center';
  title.textContent = 'Flashcards завершены!';

  const summary = document.createElement('p');
  summary.className = 'brand-subtitle';
  summary.textContent = `Ты отправил в «Выучено» ${session.learnedIds.length} из ${session.cards.length} слов.`;

  const actions = document.createElement('div');
  actions.className = 'simple-drill-controls';

  const toMenu = document.createElement('button');
  toMenu.textContent = 'Вернуться к разделам';
  toMenu.addEventListener('click', () => {
    setView('menu');
  });

  const restart = document.createElement('button');
  restart.textContent = 'Пройти ещё раз';
  restart.addEventListener('click', () => {
    resetFlashcards();
  });

  actions.appendChild(toMenu);
  actions.appendChild(restart);

  container.appendChild(icon);
  container.appendChild(title);
  container.appendChild(summary);
  container.appendChild(actions);

  return container;
}

function handleGlobalKeydown(event) {
  if (state.view !== 'flashcards') return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    applyFlashcardAction('learned');
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    applyFlashcardAction('repeat');
  } else if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault();
    toggleFlashcard();
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    undoFlashcard();
  }
}

document.addEventListener('keydown', handleGlobalKeydown);

render();
