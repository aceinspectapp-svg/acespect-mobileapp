import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ActiveTemplate } from '../services/templateApi';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';

/**
 * In-memory draft of the inspection being filled. Each section screen writes its
 * data via `setSection`; the shared photo-capture hook feeds `addPhoto` (keyed
 * by sectionKey). `ReportSummaryScreen` reads it all at submit time and POSTs the
 * structured inspection. (Online submit — not offline-first yet.)
 */
export interface DraftDamage {
  type: string;
  location?: string;
  direction?: string;
  widthMm?: number;
  lengthMm?: number;
  notes?: string;
  photos?: string[]; // local file:// URIs until uploaded
}

export interface DraftSection {
  key: string;
  name: string;
  icon?: string;
  order: number;
  status?: 'complete' | 'partial' | 'pending';
  reportText?: string;
  fields?: Record<string, unknown>;
  /** Raw un-flattened answers, sent so the section can be reopened for editing. */
  answers?: Record<string, unknown>;
  photos?: string[]; // local file:// URIs until uploaded
  damages?: DraftDamage[];
}

export interface DraftTop {
  inspectionType: string;
  propertyType: string;
  /** Raw lowercase ids (e.g. "dilapidation", "residential_house") — used to
   *  address templates; distinct from the human-readable labels above, which
   *  the submit payload uses. Set once, early, by whichever screen first has
   *  the wizard's InspectionDraftSelection (today: Job Information). */
  inspectionTypeId?: string;
  propertyTypeId?: string;
  jobNo?: string;
  address?: string;
  suburb?: string;
  client?: string;
  date?: string;
  notes?: string;
  overallProgress?: number;
  /**
   * Post-Dilapidation job, picked up from the inspector's assigned list --
   * `assignmentId` is the placeholder Inspection admin created (submit fills
   * it in rather than creating a new one); `baselineInspectionId` is the
   * earlier inspection being compared against, which is what tells every
   * section screen to render the comparison UI and fetch the baseline's own
   * data for reference. Unset for a normal, non-comparison inspection.
   */
  assignmentId?: string;
  baselineInspectionId?: string;
}

export interface SubmitPayload extends DraftTop {
  sections: DraftSection[];
}

interface DraftValue {
  setTop: (patch: Partial<DraftTop>) => void;
  getTop: () => DraftTop;
  setSection: (section: DraftSection) => void;
  /** Read back a section's persisted status/data (e.g. for the hub's completion ticks) -- keyed the same as `setSection`. */
  getSection: (key: string) => DraftSection | undefined;
  /** Every section saved so far, fixed template sections and inspector-added custom ones alike. */
  getAllSections: () => DraftSection[];
  /** Register a captured photo under its sectionKey (e.g. "driveway:1", "overview"). */
  addPhoto: (sectionKey: string, uri: string) => void;
  reset: () => void;
  /** All local photo URIs across sections + damages + the registry (to upload). */
  collectPhotoUris: () => string[];
  /** Build the submit payload, mapping each local photo URI via `resolve`. */
  buildPayload: (resolve: (uri: string) => string) => SubmitPayload;
  /**
   * The admin-published template a section screen fetched at the start of
   * this draft, pinned for the session. Screens must reuse whatever's here
   * rather than refetching, so an inspection already in progress keeps
   * rendering the version it started with even if admin publishes a newer
   * one mid-session.
   */
  getActiveTemplate: (sectionKey: string) => ActiveTemplate | undefined;
  setActiveTemplate: (sectionKey: string, template: ActiveTemplate) => void;
  /**
   * A section screen's raw, in-progress answer tree -- distinct from
   * `setSection`'s flattened `fields` (which collapses repeating-group
   * instances down to a joined labels string for the report/submit payload
   * and can't be read back into an editable form). Persisted here so
   * navigating away (e.g. back to the hub) and returning to the same
   * section restores exactly what was filled in, not a blank form.
   */
  getAnswers: (sectionKey: string) => AnswerTree | undefined;
  setAnswers: (sectionKey: string, answers: AnswerTree) => void;
  /**
   * Post-Dilapidation baseline sections (previous inspection's data, read-only
   * reference), fetched once per draft and cached here the same way a
   * section's active template is -- every section screen looks up its own
   * key from this one shared list rather than each re-fetching the whole
   * baseline. `null` until the first fetch completes.
   */
  getBaselineSections: () => BaselineSectionRef[] | null;
  setBaselineSections: (sections: BaselineSectionRef[]) => void;
}

/** Local mirror of services/inspectionApi.ts's BaselineSection -- kept separate to avoid a circular import (that module imports SubmitPayload from this file). */
export interface BaselineSectionRef {
  key: string;
  name: string;
  reportText: string;
  fields: Record<string, unknown>;
  photos: string[];
}

const Ctx = createContext<DraftValue | null>(null);

export function useInspectionDraft(): DraftValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useInspectionDraft must be used within InspectionDraftProvider');
  return ctx;
}

export function InspectionDraftProvider({ children }: { children: React.ReactNode }) {
  const topRef = useRef<DraftTop>({ inspectionType: 'Dilapidation', propertyType: 'Residential House' });
  const sectionsRef = useRef<Record<string, DraftSection>>({});
  const photosRef = useRef<Record<string, string[]>>({});
  const templatesRef = useRef<Record<string, ActiveTemplate>>({});
  const baselineSectionsRef = useRef<BaselineSectionRef[] | null>(null);
  const answersRef = useRef<Record<string, AnswerTree>>({});

  const setTop = useCallback((patch: Partial<DraftTop>) => {
    topRef.current = { ...topRef.current, ...patch };
  }, []);

  const getTop = useCallback(() => topRef.current, []);

  const setSection = useCallback((section: DraftSection) => {
    sectionsRef.current = { ...sectionsRef.current, [section.key]: section };
  }, []);

  const getSection = useCallback((key: string) => sectionsRef.current[key], []);

  const getAllSections = useCallback(() => Object.values(sectionsRef.current), []);

  const addPhoto = useCallback((sectionKey: string, uri: string) => {
    const cur = photosRef.current[sectionKey] ?? [];
    photosRef.current = { ...photosRef.current, [sectionKey]: [...cur, uri] };
  }, []);

  const reset = useCallback(() => {
    topRef.current = { inspectionType: 'Dilapidation', propertyType: 'Residential House' };
    sectionsRef.current = {};
    photosRef.current = {};
    templatesRef.current = {};
    answersRef.current = {};
    baselineSectionsRef.current = null;
  }, []);

  const getActiveTemplate = useCallback(
    (sectionKey: string) => templatesRef.current[sectionKey],
    [],
  );

  const setActiveTemplate = useCallback((sectionKey: string, template: ActiveTemplate) => {
    templatesRef.current = { ...templatesRef.current, [sectionKey]: template };
  }, []);

  const getBaselineSections = useCallback(() => baselineSectionsRef.current, []);
  const setBaselineSections = useCallback((sections: BaselineSectionRef[]) => {
    baselineSectionsRef.current = sections;
  }, []);

  const getAnswers = useCallback(
    (sectionKey: string) => answersRef.current[sectionKey],
    [],
  );

  const setAnswers = useCallback((sectionKey: string, answers: AnswerTree) => {
    answersRef.current = { ...answersRef.current, [sectionKey]: answers };
  }, []);

  // Photos registered under a section key or any "key:n" sub-key.
  const photosForSection = useCallback((key: string): string[] => {
    return Object.entries(photosRef.current)
      .filter(([k]) => k === key || k.startsWith(`${key}:`))
      .flatMap(([, uris]) => uris);
  }, []);

  const collectPhotoUris = useCallback((): string[] => {
    const uris = new Set<string>();
    Object.values(photosRef.current).forEach((arr) => arr.forEach((u) => uris.add(u)));
    Object.values(sectionsRef.current).forEach((s) => {
      (s.photos ?? []).forEach((u) => uris.add(u));
      (s.damages ?? []).forEach((d) => (d.photos ?? []).forEach((u) => uris.add(u)));
    });
    return [...uris].filter((u) => u.startsWith('file:'));
  }, []);

  const buildPayload = useCallback(
    (resolve: (uri: string) => string): SubmitPayload => ({
      ...topRef.current,
      sections: Object.values(sectionsRef.current)
        .sort((a, b) => a.order - b.order)
        .map((s) => {
          const photos = [...new Set([...(s.photos ?? []), ...photosForSection(s.key)])].map(resolve);
          return {
            ...s,
            photos,
            // Ship the raw answer tree alongside the flattened `fields`, so the
            // dashboard can reopen this section as an editable form later.
            answers: answersRef.current[s.key] as Record<string, unknown> | undefined,
            damages: (s.damages ?? []).map((d) => ({ ...d, photos: (d.photos ?? []).map(resolve) })),
          };
        }),
    }),
    [photosForSection],
  );

  // Force re-render is unnecessary — writers use refs, the reader (submit) pulls
  // current values on demand. Keep a stable value object.
  const value = useMemo<DraftValue>(
    () => ({
      setTop,
      getTop,
      setSection,
      getSection,
      getAllSections,
      addPhoto,
      reset,
      collectPhotoUris,
      buildPayload,
      getActiveTemplate,
      setActiveTemplate,
      getAnswers,
      setAnswers,
      getBaselineSections,
      setBaselineSections,
    }),
    [
      setTop,
      getTop,
      setSection,
      getSection,
      getAllSections,
      addPhoto,
      reset,
      collectPhotoUris,
      buildPayload,
      getActiveTemplate,
      setActiveTemplate,
      getAnswers,
      setAnswers,
      getBaselineSections,
      setBaselineSections,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
