// Pure command-grammar functions -- no React, no I/O. `VoiceModeContext`
// calls these against whatever field is currently focused; this file only
// decides *what* an utterance means, never *does* anything with it.
import type { TemplateField } from '../../services/templateApi';
import type { AnswerValue } from '../../components/inspection/fieldRenderers/types';

export type NavCommand = 'next' | 'back' | 'home' | 'save_draft' | 'repeat';

const NAV_PHRASES: Record<NavCommand, string[]> = {
  next: ['next', 'done', 'skip', 'continue', "that's it", 'move on'],
  back: ['back', 'previous', 'go back', 'undo'],
  home: ['go home', 'home', 'exit'],
  save_draft: ['save draft', 'save as draft', 'next section', 'complete section', 'complete', 'finish section'],
  repeat: ['repeat', 'say again', 'repeat that', "what's this", 'what is this'],
};

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' ');
}

/** Global commands checked before any field-specific interpretation, so "next"/"back"/etc. always work regardless of the focused field's type. */
export function matchNavigationCommand(utterance: string): NavCommand | null {
  const u = normalize(utterance);
  for (const [cmd, phrases] of Object.entries(NAV_PHRASES) as [NavCommand, string[]][]) {
    if (phrases.some((p) => u === p || u.startsWith(`${p} `) || u.endsWith(` ${p}`))) return cmd;
  }
  return null;
}

/** Levenshtein distance, small-string-only (option labels are short) -- used as a near-miss fallback after exact/substring matching fails. */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Best-matching option for a spoken phrase, or null if nothing is close
 * enough to trust. Exact match wins outright; otherwise a normalized
 * edit-distance ratio (tolerant of STT mishearing a word or two) with a
 * substring bonus for a full-label match embedded in a longer utterance
 * ("it's paint flaking from sections" -> "Paint is flaking from sections").
 */
function bestOptionMatch(utterance: string, options: { value: string; label: string }[]): { value: string; label: string } | null {
  const u = normalize(utterance);
  if (!u || options.length === 0) return null;

  const exact = options.find((o) => normalize(o.label) === u);
  if (exact) return exact;

  let best: { value: string; label: string } | null = null;
  let bestScore = 0;
  for (const o of options) {
    const label = normalize(o.label);
    let score = 0;
    if (u.includes(label) || label.includes(u)) {
      score = Math.min(label.length, u.length) / Math.max(label.length, u.length);
    } else {
      const dist = levenshtein(u, label);
      score = 1 - dist / Math.max(u.length, label.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

/** Handles digits ("12"), simple number words ("twelve"), and compound tens ("twenty three") -- not a general NLU numeric parser. */
function parseSpokenNumber(utterance: string): string | null {
  const u = normalize(utterance);
  if (/^\d+(\.\d+)?$/.test(u)) return u;
  const words = u.split(' ').filter((w) => w in NUMBER_WORDS);
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const w of words) {
    const n = NUMBER_WORDS[w]!;
    if (n === 100) current = (current || 1) * 100;
    else current += n;
  }
  total += current;
  return String(total);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "today", a weekday name (next/most recent occurrence), or "<day> of <month>" (current year) -- deliberately small, matches the plan's stated scope. Returns YYYY-MM-DD or null if unrecognized. */
function parseSpokenDate(utterance: string): string | null {
  const u = normalize(utterance);
  const pad = (n: number) => String(n).padStart(2, '0');

  if (u === 'today') {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const weekdayIdx = WEEKDAYS.indexOf(u);
  if (weekdayIdx !== -1) {
    const d = new Date();
    const diff = (d.getDay() - weekdayIdx + 7) % 7;
    d.setDate(d.getDate() - diff);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const dayMonth = u.match(/(\d{1,2})(st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthIdx = MONTHS.indexOf(dayMonth[3]!);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      return `${year}-${pad(monthIdx + 1)}-${pad(day)}`;
    }
  }
  return null;
}

export interface FieldValueMatch {
  value: AnswerValue;
  confirmation: string;
}

/**
 * Interprets an utterance against the currently-focused field's type.
 * Returns null (never a guess) when nothing matches confidently, so the
 * caller can ask the inspector to repeat rather than silently writing a
 * wrong answer. `photos` fields aren't handled here -- "take photo" is a
 * command name the caller checks before ever reaching this function.
 */
export function matchFieldValue(field: TemplateField, utterance: string, currentValue: AnswerValue): FieldValueMatch | null {
  const u = normalize(utterance);
  if (!u) return null;

  switch (field.type) {
    case 'yesno': {
      if (/^(yes|yeah|yep|correct|affirmative)/.test(u)) return { value: 'yes', confirmation: 'Yes' };
      if (/^(no|nope|negative|incorrect)/.test(u)) return { value: 'no', confirmation: 'No' };
      return null;
    }

    case 'pill-select':
    case 'select-tiles':
    case 'color-select': {
      const match = bestOptionMatch(u, field.options ?? []);
      if (match) return { value: match.value, confirmation: match.label };
      if (field.allowOther) return { value: `__other__:${utterance.trim()}`, confirmation: `Other: ${utterance.trim()}` };
      return null;
    }

    case 'chip-multiselect':
    case 'tile-multiselect': {
      const selected = Array.isArray(currentValue) ? [...(currentValue as string[])] : [];
      const removing = /^(remove|deselect|unselect)\s+/.test(u);
      const target = removing ? u.replace(/^(remove|deselect|unselect)\s+/, '') : u.replace(/^(select|also|add)\s+/, '');
      const match = bestOptionMatch(target, field.options ?? []);
      if (!match) {
        if (!removing && field.allowOther) {
          const otherEntry = `__other__:${utterance.trim()}`;
          const next = [...selected.filter((s) => s !== 'other' && !s.startsWith('__other__:')), 'other', otherEntry];
          return { value: next, confirmation: `Added Other: ${utterance.trim()}` };
        }
        return null;
      }
      if (removing) {
        const next = selected.filter((s) => s !== match.value);
        return { value: next, confirmation: `Removed ${match.label}` };
      }
      if (selected.includes(match.value)) return { value: selected, confirmation: `${match.label} already selected` };
      return { value: [...selected, match.value], confirmation: `Added ${match.label}` };
    }

    case 'text':
    case 'textarea': {
      // Dictation passthrough -- the one type STT is already suited for as-is.
      return { value: utterance.trim(), confirmation: utterance.trim() };
    }

    case 'numeric': {
      const n = parseSpokenNumber(u);
      return n ? { value: n, confirmation: n } : null;
    }

    case 'date': {
      const d = parseSpokenDate(u);
      return d ? { value: d, confirmation: d } : null;
    }

    default:
      return null;
  }
}
