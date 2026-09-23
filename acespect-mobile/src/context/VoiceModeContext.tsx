import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { TemplateField } from '../services/templateApi';
import type { AnswerTree, AnswerValue } from '../components/inspection/fieldRenderers/types';
import { matchFieldValue, matchNavigationCommand } from '../services/voice/voiceCommands';

/**
 * A screen "registers" its currently-visible field list (and how to read/
 * write them) whenever it changes -- `FieldListRenderer` does this in a
 * `useEffect`. Only one screen is ever registered at a time; mounting
 * replaces whatever was there, unmounting clears it. `onNext`/`onBack`/
 * `onHome`, when given, let voice navigation commands reuse a screen's own
 * leave-gating logic (e.g. `DynamicSectionScreen`'s `attemptLeave`) instead
 * of bypassing it.
 */
interface RegisteredScreen {
  fields: TemplateField[];
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  onNext?: () => void;
  onBack?: () => void;
  onHome?: () => void;
}

interface VoiceModeContextValue {
  enabled: boolean;
  toggle: () => void;
  currentFieldKey: string | null;
  registerFields: (
    fields: TemplateField[],
    scope: AnswerTree,
    onChange: (key: string, value: AnswerValue) => void,
    handlers?: { onNext?: () => void; onBack?: () => void; onHome?: () => void },
  ) => void;
}

const VoiceModeContext = createContext<VoiceModeContextValue | null>(null);

export function useVoiceMode(): VoiceModeContextValue {
  const ctx = useContext(VoiceModeContext);
  if (!ctx) throw new Error('useVoiceMode must be used within VoiceModeProvider');
  return ctx;
}

function describeField(field: TemplateField | undefined): string {
  if (!field) return 'End of form. Say save draft to continue, or back to review.';
  let text = field.label;
  const optionLabels = (field.options ?? []).map((o) => o.label);
  switch (field.type) {
    case 'yesno':
      text += '. Say yes or no.';
      break;
    case 'pill-select':
    case 'select-tiles':
    case 'color-select':
      if (optionLabels.length > 0 && optionLabels.length <= 6) text += `. Options: ${optionLabels.join(', ')}.`;
      break;
    case 'chip-multiselect':
    case 'tile-multiselect':
      if (optionLabels.length > 0 && optionLabels.length <= 6) text += `. Say one to select, say done when finished. Options: ${optionLabels.join(', ')}.`;
      break;
    case 'photos':
      text += '. Tap the camera button to take a photo, then say next.';
      break;
    case 'text':
    case 'textarea':
      text += '. Say your answer.';
      break;
    default:
      break;
  }
  return text;
}

export function VoiceModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [currentFieldKey, setCurrentFieldKey] = useState<string | null>(null);

  // Mutable, frequently-updated state lives in refs -- re-registering on
  // every keystroke (scope changes constantly) must never itself trigger a
  // re-render or reset the cursor; only actual cursor/enabled changes do.
  const enabledRef = useRef(false);
  const speakingRef = useRef(false);
  const currentIndexRef = useRef(0);
  const registeredRef = useRef<RegisteredScreen | null>(null);
  const lastFieldKeysRef = useRef<string>('');

  const startListening = useCallback(() => {
    if (speakingRef.current || !enabledRef.current) return;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: false,
        requiresOnDeviceRecognition: true,
      });
    } catch {
      // Recognizer busy/unavailable -- the next 'end' or manual toggle retries.
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      speakingRef.current = true;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // not currently listening -- fine
      }
      const resume = () => {
        speakingRef.current = false;
        if (enabledRef.current) startListening();
      };
      Speech.speak(text, { onDone: resume, onStopped: resume, onError: resume });
    },
    [startListening],
  );

  const announceField = useCallback(
    (field: TemplateField | undefined) => {
      speak(describeField(field));
    },
    [speak],
  );

  const moveCursor = useCallback(
    (delta: number) => {
      const reg = registeredRef.current;
      if (!reg || reg.fields.length === 0) {
        speak('No fields on this screen.');
        return;
      }
      const next = Math.min(Math.max(currentIndexRef.current + delta, 0), reg.fields.length - 1);
      currentIndexRef.current = next;
      const field = reg.fields[next];
      setCurrentFieldKey(field?.key ?? null);
      announceField(field);
    },
    [announceField, speak],
  );

  const handleUtterance = useCallback(
    (utterance: string) => {
      const nav = matchNavigationCommand(utterance);
      if (nav) {
        const reg = registeredRef.current;
        switch (nav) {
          case 'next':
            moveCursor(1);
            return;
          case 'back':
            moveCursor(-1);
            return;
          case 'repeat':
            announceField(reg?.fields[currentIndexRef.current]);
            return;
          case 'home':
            reg?.onHome?.();
            return;
          case 'save_draft':
            reg?.onNext?.();
            return;
        }
      }

      const reg = registeredRef.current;
      if (!reg) {
        speak('No field is focused.');
        return;
      }
      const field = reg.fields[currentIndexRef.current];
      if (!field) return;

      if (field.type === 'photos') {
        speak('Tap the camera button to take a photo. Say next once you have.');
        return;
      }

      const currentValue = reg.scope[field.key];
      const match = matchFieldValue(field, utterance, currentValue);
      if (!match) {
        speak("Sorry, I didn't catch that. Please try again.");
        return;
      }
      reg.onChange(field.key, match.value);
      speak(match.confirmation);
    },
    [announceField, moveCursor, speak],
  );

  const registerFields = useCallback<VoiceModeContextValue['registerFields']>(
    (fields, scope, onChange, handlers) => {
      const keySignature = fields.map((f) => f.key).join('|');
      const isNewScreen = keySignature !== lastFieldKeysRef.current;
      registeredRef.current = { fields, scope, onChange, ...handlers };
      if (isNewScreen) {
        lastFieldKeysRef.current = keySignature;
        currentIndexRef.current = 0;
        setCurrentFieldKey(fields[0]?.key ?? null);
        if (enabledRef.current) announceField(fields[0]);
      }
    },
    [announceField],
  );

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // already stopped
      }
      Speech.stop();
      return;
    }
    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then((perm) => {
        if (!perm.granted) {
          Speech.speak('Microphone or speech recognition permission was not granted.');
          return;
        }
        enabledRef.current = true;
        setEnabled(true);
        speak(registeredRef.current?.fields.length ? 'Voice mode on. ' + describeField(registeredRef.current.fields[currentIndexRef.current]) : 'Voice mode on.');
      })
      .catch(() => {
        Speech.speak('Could not start speech recognition.');
      });
  }, [speak]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!enabledRef.current) return;
    const transcript = event.results?.[0]?.transcript;
    if (transcript) handleUtterance(transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    if (enabledRef.current && !speakingRef.current) startListening();
  });

  return (
    <VoiceModeContext.Provider value={{ enabled, toggle, currentFieldKey, registerFields }}>
      {children}
    </VoiceModeContext.Provider>
  );
}
