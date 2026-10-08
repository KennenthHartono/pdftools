/**
 * Form controls with a consistent look. Each factory returns
 * `{ el, value, setDisabled(), setHidden() }` so tools can read state
 * without touching the DOM.
 */

import { h } from './components.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

function attachCommon(api, el) {
  api.el = el;
  api.setDisabled = (disabled) => {
    for (const input of el.querySelectorAll('input, select, textarea, button')) input.disabled = disabled;
    el.classList.toggle('is-disabled', disabled);
  };
  api.setHidden = (hidden) => {
    el.hidden = hidden;
  };
  return api;
}

/**
 * Group of mutually exclusive choices (rendered as mechanical toggle keys).
 * @param {{name?: string, legend: string, options: {value: string, label: string, hint?: string}[], value: string, onChange?: (value: string) => void}} config
 */
export function radioGroup({ name = nextId('radio'), legend, options, value, onChange }) {
  const inputs = options.map((opt) => {
    const input = h('input', { type: 'radio', name, value: opt.value, checked: opt.value === value });
    input.addEventListener('change', () => {
      if (input.checked) onChange?.(opt.value);
    });
    return input;
  });
  const labels = options.map((opt, i) =>
    h('label', { class: 'choice' }, inputs[i], h('span', { class: 'choice-key' }, opt.label), opt.hint ? h('span', { class: 'choice-hint' }, opt.hint) : null),
  );
  const el = h('fieldset', { class: 'field field--choices' }, h('legend', { class: 'field-label' }, legend), h('div', { class: 'choices' }, labels));
  const api = {
    get value() {
      return inputs.find((i) => i.checked)?.value ?? value;
    },
    set value(v) {
      for (const input of inputs) input.checked = input.value === v;
    },
  };
  return attachCommon(api, el);
}

/**
 * Slider with a live value read-out.
 * @param {{label: string, min: number, max: number, step?: number, value: number, format?: (v: number) => string, onChange?: (v: number) => void}} config
 */
export function rangeField({ label, min, max, step = 1, value, format = String, onChange }) {
  const id = nextId('range');
  const input = h('input', { type: 'range', id, min, max, step, value });
  const readout = h('output', { class: 'field-readout', for: id }, format(value));
  input.addEventListener('input', () => {
    readout.textContent = format(Number(input.value));
    onChange?.(Number(input.value));
  });
  const el = h('div', { class: 'field field--range' }, h('label', { class: 'field-label', for: id }, label), h('div', { class: 'range-row' }, input, readout));
  const api = {
    get value() {
      return Number(input.value);
    },
    set value(v) {
      input.value = String(v);
      readout.textContent = format(Number(v));
    },
  };
  return attachCommon(api, el);
}

/**
 * Drop-down list.
 * @param {{label: string, options: {value: string, label: string}[], value: string, onChange?: (v: string) => void}} config
 */
export function selectField({ label, options, value, onChange }) {
  const id = nextId('select');
  const select = h(
    'select',
    { id },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  select.addEventListener('change', () => onChange?.(select.value));
  const el = h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), h('div', { class: 'select-wrap' }, select));
  const api = {
    get value() {
      return select.value;
    },
    set value(v) {
      select.value = v;
    },
  };
  return attachCommon(api, el);
}

/**
 * Number input with a unit suffix.
 * @param {{label: string, min?: number, max?: number, step?: number, value: number, suffix?: string, onChange?: (v: number) => void}} config
 */
export function numberField({ label, min, max, step = 1, value, suffix, onChange }) {
  const id = nextId('number');
  const input = h('input', { type: 'number', id, min, max, step, value, inputmode: 'decimal' });
  input.addEventListener('input', () => onChange?.(Number(input.value)));
  const el = h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), h('div', { class: 'number-wrap' }, input, suffix ? h('span', { class: 'number-suffix' }, suffix) : null));
  const api = {
    input,
    get value() {
      return Number(input.value);
    },
    set value(v) {
      input.value = String(v);
    },
  };
  return attachCommon(api, el);
}

/**
 * Single checkbox.
 * @param {{label: string, checked?: boolean, hint?: string, onChange?: (checked: boolean) => void}} config
 */
export function checkboxField({ label, checked = false, hint, onChange }) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange?.(input.checked));
  const el = h('label', { class: 'field field--check' }, input, h('span', { class: 'check-text' }, label, hint ? h('span', { class: 'choice-hint' }, hint) : null));
  const api = {
    get value() {
      return input.checked;
    },
    set value(v) {
      input.checked = Boolean(v);
    },
  };
  return attachCommon(api, el);
}

/**
 * Single-line text input with an optional live message line (aria-live).
 * @param {{label: string, placeholder?: string, value?: string, hint?: string, onInput?: (v: string) => void}} config
 */
export function textField({ label, placeholder, value = '', hint, onInput }) {
  const id = nextId('text');
  const msgId = `${id}-msg`;
  const input = h('input', { type: 'text', id, placeholder, value, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': msgId });
  const message = h('p', { class: 'field-message', id: msgId, 'aria-live': 'polite' }, hint ?? '');
  input.addEventListener('input', () => onInput?.(input.value));
  const el = h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), input, message);
  const api = {
    input,
    get value() {
      return input.value;
    },
    set value(v) {
      input.value = v;
    },
    /** @param {string} text @param {'hint'|'error'|'ok'} [tone] */
    setMessage(text, tone = 'hint') {
      message.textContent = text;
      message.dataset.tone = tone;
      input.setAttribute('aria-invalid', tone === 'error' ? 'true' : 'false');
    },
  };
  return attachCommon(api, el);
}
