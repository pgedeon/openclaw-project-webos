import {
  formatDurationMmSs,
  getEscape,
  toNumber,
} from './widget-utils.mjs';

let timerState = null;

export const manifest = {
  id: 'session-timer',
  label: 'Session Timer',
  description: 'Pomodoro-style focus timer with work and break intervals.',
  icon: `
    <circle cx="12" cy="13" r="7"></circle>
    <path d="M12 13V9.5"></path>
    <path d="M12 13 14.5 14.5"></path>
    <path d="M9.5 4.5h5"></path>
  `,
  size: 'small',
  dataKeys: [],
  capabilities: {
    clickable: false,
    configurable: true,
    resizable: false,
  },
  defaults: {
    workMinutes: 25,
    breakMinutes: 5,
  },
};

const createTimerState = (config = {}) => {
  const workMinutes = Math.max(1, Math.round(toNumber(config.workMinutes, 25)));
  const breakMinutes = Math.max(1, Math.round(toNumber(config.breakMinutes, 5)));
  return {
    workSeconds: workMinutes * 60,
    breakSeconds: breakMinutes * 60,
    remainingSeconds: workMinutes * 60,
    running: false,
    isBreak: false,
    intervalId: null,
  };
};

const clearTimerInterval = () => {
  if (timerState?.intervalId != null) {
    window.clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
};

export function render(ctx) {
  const escape = getEscape(ctx);
  timerState = createTimerState(ctx.config);

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-session-timer" aria-label="Session timer widget">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered widget-session-timer__body">
        <span class="widget-session-timer__mode" data-role="session-mode">${escape('Work')}</span>
        <span class="widget-session-timer__display" data-role="session-display">${escape(formatDurationMmSs(timerState.remainingSeconds))}</span>
        <div class="widget-session-timer__controls">
          <button type="button" class="widget-session-timer__button is-primary" data-role="session-start">${escape('Start')}</button>
          <button type="button" class="widget-session-timer__button" data-role="session-pause">${escape('Pause')}</button>
          <button type="button" class="widget-session-timer__button" data-role="session-reset">${escape('Reset')}</button>
        </div>
      </div>
    </div>
  `;

  const modeEl = ctx.mountNode.querySelector('[data-role="session-mode"]');
  const displayEl = ctx.mountNode.querySelector('[data-role="session-display"]');
  const startButton = ctx.mountNode.querySelector('[data-role="session-start"]');
  const pauseButton = ctx.mountNode.querySelector('[data-role="session-pause"]');
  const resetButton = ctx.mountNode.querySelector('[data-role="session-reset"]');

  const paint = () => {
    if (modeEl) {
      modeEl.textContent = timerState?.isBreak ? 'Break' : 'Work';
    }
    if (displayEl) {
      displayEl.textContent = formatDurationMmSs(timerState?.remainingSeconds || 0);
    }
    if (startButton instanceof HTMLButtonElement) {
      startButton.disabled = Boolean(timerState?.running);
    }
    if (pauseButton instanceof HTMLButtonElement) {
      pauseButton.disabled = !timerState?.running;
    }
  };

  const advanceToNextSession = () => {
    timerState.isBreak = !timerState.isBreak;
    timerState.remainingSeconds = timerState.isBreak ? timerState.breakSeconds : timerState.workSeconds;
    paint();
  };

  const tick = () => {
    if (!timerState?.running) {
      return;
    }

    timerState.remainingSeconds = Math.max(0, timerState.remainingSeconds - 1);
    if (timerState.remainingSeconds === 0) {
      advanceToNextSession();
    }
    paint();
  };

  const handleStart = () => {
    if (!timerState || timerState.running) {
      return;
    }

    timerState.running = true;
    clearTimerInterval();
    timerState.intervalId = window.setInterval(tick, 1000);
    paint();
  };

  const handlePause = () => {
    if (!timerState) {
      return;
    }

    timerState.running = false;
    clearTimerInterval();
    paint();
  };

  const handleReset = () => {
    if (!timerState) {
      return;
    }

    timerState.running = false;
    clearTimerInterval();
    timerState.isBreak = false;
    timerState.remainingSeconds = timerState.workSeconds;
    paint();
  };

  startButton?.addEventListener('click', handleStart);
  pauseButton?.addEventListener('click', handlePause);
  resetButton?.addEventListener('click', handleReset);
  paint();

  return () => {
    startButton?.removeEventListener('click', handleStart);
    pauseButton?.removeEventListener('click', handlePause);
    resetButton?.removeEventListener('click', handleReset);
    clearTimerInterval();
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
