import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { colors, radius } from '../../theme';

/**
 * Speech-to-text is a single native session app-wide -- if two mic buttons
 * both started listening, whichever's `useSpeechRecognitionEvent` handler
 * happened to run would steal the other's words. `activeSessionId` (0 = none)
 * plus each hook's own `sessionIdRef` means only the button that actually
 * called `start()` ever applies a 'result'/'end'/'error' event to itself.
 */
let activeSessionId = 0;
let sessionCounter = 0;

/** One-shot dictation into a single text field: tap to listen, speak, tap (or pause) to stop -- no navigation, no announcements, just fills the field the mic button sits next to. */
export function useDictation(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const sessionIdRef = useRef(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const stopInternal = useCallback(() => {
    sessionIdRef.current = 0;
    if (activeSessionId === sessionIdRef.current) activeSessionId = 0;
    setListening(false);
  }, []);

  const toggle = useCallback(async () => {
    if (sessionIdRef.current) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // already stopped
      }
      return;
    }
    if (activeSessionId) return; // another field's mic is already listening

    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone', 'Microphone or speech recognition permission was not granted. Enable it in Settings to dictate.');
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('Microphone', 'Speech recognition is not available on this device.');
        return;
      }
      const id = ++sessionCounter;
      sessionIdRef.current = id;
      activeSessionId = id;
      setListening(true);
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false, continuous: false });
    } catch (e) {
      sessionIdRef.current = 0;
      activeSessionId = 0;
      setListening(false);
      Alert.alert('Microphone', `Could not start dictation: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (!sessionIdRef.current || sessionIdRef.current !== activeSessionId) return;
    const transcript = event.results?.[0]?.transcript;
    if (transcript) onResultRef.current(transcript);
  });

  useSpeechRecognitionEvent('end', () => {
    if (sessionIdRef.current && sessionIdRef.current === activeSessionId) stopInternal();
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!sessionIdRef.current || sessionIdRef.current !== activeSessionId) return;
    stopInternal();
    if (event.error === 'no-speech' || event.error === 'speech-timeout') return;
    Alert.alert('Dictation stopped', `${event.error}: ${event.message || 'Speech recognition error.'}`);
  });

  return { listening, toggle };
}

/** Small round mic button -- tap to dictate into whichever field it's placed beside. */
export function DictationMicButton({
  onResult,
  size = 'md',
}: {
  onResult: (text: string) => void;
  size?: 'sm' | 'md';
}) {
  const { listening, toggle } = useDictation(onResult);
  const dimension = size === 'sm' ? 30 : 36;
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      style={[
        styles.mic,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        listening && styles.micActive,
      ]}
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop dictation' : 'Dictate answer'}
    >
      <Ionicons name={listening ? 'mic' : 'mic-outline'} size={size === 'sm' ? 15 : 17} color={listening ? '#fff' : colors.barBlue} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mic: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlue,
    borderWidth: 1,
    borderColor: colors.barBlue,
  },
  micActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
});

/** Appends dictated text onto whatever's already in the field, with a separating space -- doesn't clobber typing the inspector already did. */
export function appendDictated(current: string, spoken: string): string {
  const trimmedCurrent = current.trim();
  const trimmedSpoken = spoken.trim();
  if (!trimmedCurrent) return trimmedSpoken;
  if (!trimmedSpoken) return trimmedCurrent;
  return `${trimmedCurrent} ${trimmedSpoken}`;
}
