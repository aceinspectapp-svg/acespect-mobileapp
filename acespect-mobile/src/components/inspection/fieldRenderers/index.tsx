import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../../theme';
import { Button, ProgressBar } from '../../ui';
import type { TemplateField, TemplateFieldType, TemplateLayout } from '../../../services/templateApi';
import { AnswerTree, AnswerValue, FieldRendererProps, isGateSatisfied } from './types';
import {
  ChipMultiSelectFieldRenderer,
  ColorSelectFieldRenderer,
  DateFieldRenderer,
  NumericFieldRenderer,
  PhotosFieldRenderer,
  PillSelectFieldRenderer,
  SelectTilesFieldRenderer,
  TextFieldRenderer,
  TextareaFieldRenderer,
  YesNoFieldRenderer,
} from './leafRenderers';

/**
 * Renders one level of a template's fields against one scope of the answer
 * tree -- the mobile equivalent of the web admin's recursive
 * `FieldListEditor`. `RepeatingGroupFieldRenderer`/`DamageListFieldRenderer`
 * call this again for each instance, which is how nested repetition (e.g.
 * InternalAreas' room types containing addable instances containing a
 * damage-list) "just works" without special-casing.
 */
export function FieldListRenderer({
  fields,
  scope,
  onChange,
  path,
}: {
  fields: TemplateField[];
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  path: string[];
}) {
  const visible = [...fields].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
  let lastLetter: string | undefined;
  return (
    <>
      {visible.map((field) => {
        const Renderer = FIELD_RENDERERS[field.type];
        if (!Renderer) return null;
        const showLetterHeader = field.sectionLetter && field.sectionLetter !== lastLetter;
        lastLetter = field.sectionLetter;
        return (
          <React.Fragment key={field.key}>
            {showLetterHeader && (
              <View style={styles.letterHeaderBand}>
                <Text style={styles.letterHeaderText}>
                  {field.sectionLetter && field.sectionLetter.length <= 2 ? `SECTION ${field.sectionLetter}` : field.sectionLetter}
                </Text>
              </View>
            )}
            <Renderer
              field={field}
              value={scope[field.key]}
              onChange={(v) => onChange(field.key, v)}
              path={[...path, field.key]}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

function asAnswerTree(v: AnswerValue): AnswerTree {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnswerTree) : {};
}

/**
 * Whole-template navigation for the profiles whose sections carry many
 * sub-areas (Apartment's Internal has 13). Instead of one endless scroll, the
 * template's `sectionLetter` groups become a tap-through list, each opening in
 * its own full-screen form -- the same drill-down shape used inside a Part on
 * Public Assets, applied one level up. Opted into by the template's
 * `layout.mode === 'section-nav'`, never inferred.
 */
export function SectionNavRenderer({
  fields,
  layout,
  scope,
  onChange,
  path,
}: {
  fields: TemplateField[];
  layout: TemplateLayout;
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  path: string[];
}) {
  const [openLetter, setOpenLetter] = useState<string | null>(null);

  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const order: string[] = [];
  const byLetter = new Map<string, TemplateField[]>();
  for (const f of ordered) {
    const letter = f.sectionLetter ?? 'General';
    if (!byLetter.has(letter)) {
      byLetter.set(letter, []);
      order.push(letter);
    }
    byLetter.get(letter)!.push(f);
  }
  const chrome = new Map((layout.groups ?? []).map((g) => [g.letter, g]));
  const openFields = openLetter ? byLetter.get(openLetter) : undefined;

  return (
    <>
      {order.map((letter) => {
        const groupFields = byLetter.get(letter)!;
        const filled = groupFields.some((f) => isAnswered(scope[f.key]));
        const meta = chrome.get(letter);
        return (
          <Pressable key={letter} style={styles.navRow} onPress={() => setOpenLetter(letter)}>
            <View style={styles.navRowIcon}>
              <Text style={styles.navRowEmoji}>{meta?.icon ?? '📋'}</Text>
            </View>
            <View style={styles.navRowText}>
              <Text style={styles.navRowTitle}>{letter}</Text>
              {!!meta?.hint && <Text style={styles.navRowHint} numberOfLines={1}>{meta.hint}</Text>}
            </View>
            <Ionicons
              name={filled ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={filled ? colors.barBlue : colors.textMuted}
            />
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        );
      })}
      <Modal visible={!!openFields} animationType="slide" onRequestClose={() => setOpenLetter(null)}>
        <SafeAreaView style={styles.categoryModalRoot} edges={['top', 'bottom']}>
          <View style={styles.categoryModalHeader}>
            <Pressable onPress={() => setOpenLetter(null)} hitSlop={8} style={styles.categoryModalBack}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={styles.categoryModalBackText}>Back</Text>
            </Pressable>
            <Text style={styles.categoryModalTitle} numberOfLines={1}>{openLetter}</Text>
            <View style={styles.categoryModalBack} />
          </View>
          <ScrollView style={styles.categoryModalBody} contentContainerStyle={styles.categoryModalBodyContent}>
            {openFields && (
              <FieldListRenderer
                fields={openFields.map((f) => ({ ...f, sectionLetter: undefined }))}
                scope={scope}
                onChange={onChange}
                path={[...path, openLetter ?? '']}
              />
            )}
          </ScrollView>
          <View style={styles.categoryModalFooter}>
            <Button label="Back" variant="outline" leftIcon="chevron-back" fitContent onPress={() => setOpenLetter(null)} />
            <Button
              label="Next"
              variant="primaryGradient"
              rightIcon="checkmark"
              style={styles.categoryModalFooterNext}
              onPress={() => setOpenLetter(null)}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

/**
 * repeating-group / damage-list share this renderer: both are a list of
 * instances, each rendering `itemFields` via FieldListRenderer. Only the
 * chrome (tab strip vs scrollable strip vs checklist rows) and defaults
 * differ, driven by `field.repeat`.
 */
export function RepeatingFieldRenderer(props: FieldRendererProps) {
  const presentation = props.field.repeat?.presentation ?? 'strip';
  if (presentation === 'checklist') return <ChecklistRenderer {...props} />;
  if (presentation === 'fixed-tabs' || presentation === 'nested') {
    return props.field.repeat?.collapsible ? <FixedListRenderer {...props} /> : <FixedTabsRenderer {...props} />;
  }
  return <StripListRenderer {...props} />;
}

/** Fixed rows, each an implicit yes/no + conditional note (e.g. NotesPostProject's movement checklist). No hooks needed. */
function ChecklistRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const itemFields = field.itemFields ?? [];
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      {(field.repeat?.fixedInstances ?? []).map((inst) => {
        const instScope = record[inst.key] ?? {};
        return (
          <View key={inst.key} style={styles.checklistRow}>
            <FieldListRenderer
              fields={itemFields.map((f) => (f.key === 'value' ? { ...f, label: inst.label } : f))}
              scope={instScope}
              onChange={(k, v) => onChange({ ...record, [inst.key]: { ...instScope, [k]: v } })}
              path={[...path, inst.key]}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Fixed named tabs (Elevations' 4 sides, RoofChimneys' 2) or a fixed set with addable extra instances (InternalAreas' room types). */
function FixedTabsRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const repeat = field.repeat ?? { presentation: 'fixed-tabs' as const };
  const itemFields = field.itemFields ?? [];
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  const fixedInstances = repeat.fixedInstances ?? [];
  // Derived from the answer tree rather than local state, so added instances
  // survive leaving and re-entering the section along with their answers.
  const fixedKeys = new Set(fixedInstances.map((f) => f.key));
  const base = fixedInstances[0]?.label ?? field.label;
  const extraInstances = Object.keys(record)
    .filter((k) => !fixedKeys.has(k))
    .map((key, i) => ({ key, label: `${base} ${fixedInstances.length + i + 1}` }));
  const allInstances = [...fixedInstances, ...extraInstances];
  const [activeKey, setActiveKey] = useState<string>(allInstances[0]?.key ?? '');
  const active = allInstances.find((i) => i.key === activeKey) ?? allInstances[0];

  function addInstance() {
    const key = `extra_${Date.now()}`;
    onChange({ ...record, [key]: {} });
    setActiveKey(key);
  }

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip}>
        {allInstances.map((inst) => {
          const isActive = inst.key === active?.key;
          return (
            <Pressable
              key={inst.key}
              onPress={() => setActiveKey(inst.key)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{inst.label}</Text>
            </Pressable>
          );
        })}
        {repeat.addable && (
          <Pressable onPress={addInstance} style={styles.tab}>
            <Ionicons name="add" size={14} color={colors.barBlue} />
          </Pressable>
        )}
      </ScrollView>
      {active && (
        <View style={styles.instanceCard}>
          <FieldListRenderer
            fields={itemFields}
            scope={record[active.key] ?? {}}
            onChange={(k, v) => onChange({ ...record, [active.key]: { ...(record[active.key] ?? {}), [k]: v } })}
            path={[...path, active.key]}
          />
        </View>
      )}
    </View>
  );
}

interface CategoryGroup {
  letter: string;
  label: string;
  equalsValue: string;
  fields: TemplateField[];
}

/** Buckets itemFields by `sectionLetter` (in first-seen order) and resolves each group's checklist option value from whichever of its fields gates directly on the selector. */
function computeCategoryGroups(itemFields: TemplateField[], selectorField: TemplateField | undefined): CategoryGroup[] {
  if (!selectorField) return [];
  const order: string[] = [];
  const byLetter = new Map<string, TemplateField[]>();
  for (const f of itemFields) {
    if (!f.sectionLetter) continue;
    if (!byLetter.has(f.sectionLetter)) {
      byLetter.set(f.sectionLetter, []);
      order.push(f.sectionLetter);
    }
    byLetter.get(f.sectionLetter)!.push(f);
  }
  return order.map((letter) => {
    const fields = byLetter.get(letter)!;
    const equalsValue = fields.find((f) => f.gate?.fieldKey === selectorField.key)?.gate?.equals ?? '';
    const label = selectorField.options?.find((o) => o.value === equalsValue)?.label ?? letter;
    return { letter, label, equalsValue, fields };
  });
}

function isAnswered(v: AnswerValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== '';
}

/**
 * A Part's fields split into always-visible "lead" fields plus a tap-to-open
 * list of the categories the inspector checked off in the selector
 * (chip-multiselect) field -- each opens in its own full-screen form instead
 * of every selected category's fields piling up inline.
 */
function CategoryNavForm({
  itemFields,
  selectorFieldKey,
  scope,
  onChange,
  path,
}: {
  itemFields: TemplateField[];
  selectorFieldKey: string;
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  path: string[];
}) {
  const leadFields = itemFields.filter((f) => !f.sectionLetter);
  const selectorField = itemFields.find((f) => f.key === selectorFieldKey);
  const groups = computeCategoryGroups(itemFields, selectorField);
  const selectedRaw = scope[selectorFieldKey];
  const selected = Array.isArray(selectedRaw) ? (selectedRaw as string[]) : [];
  const [openLetter, setOpenLetter] = useState<string | null>(null);
  const openGroup = groups.find((g) => g.letter === openLetter);

  return (
    <>
      <FieldListRenderer fields={leadFields} scope={scope} onChange={onChange} path={path} />
      {selected.length > 0 && (
        <View style={styles.categoryNavBlock}>
          <Text style={styles.groupLabel}>Fill in each selected item</Text>
          {groups
            .filter((g) => selected.includes(g.equalsValue))
            .map((g) => {
              const filled = g.fields.some((f) => isAnswered(scope[f.key]));
              return (
                <Pressable key={g.letter} style={styles.categoryRow} onPress={() => setOpenLetter(g.letter)}>
                  <View style={styles.instanceHeaderTitleRow}>
                    <Ionicons
                      name={filled ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={filled ? colors.barBlue : colors.textMuted}
                    />
                    <Text style={styles.categoryRowLabel}>{g.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            })}
        </View>
      )}
      <Modal visible={!!openGroup} animationType="slide" onRequestClose={() => setOpenLetter(null)}>
        <SafeAreaView style={styles.categoryModalRoot} edges={['top', 'bottom']}>
          <View style={styles.categoryModalHeader}>
            <Pressable onPress={() => setOpenLetter(null)} hitSlop={8} style={styles.categoryModalBack}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={styles.categoryModalBackText}>Back</Text>
            </Pressable>
            <Text style={styles.categoryModalTitle} numberOfLines={1}>{openGroup?.label}</Text>
            <View style={styles.categoryModalBack} />
          </View>
          <ScrollView style={styles.categoryModalBody} contentContainerStyle={styles.categoryModalBodyContent}>
            {openGroup && (
              <FieldListRenderer
                fields={openGroup.fields}
                scope={scope}
                onChange={onChange}
                path={[...path, openGroup.letter]}
              />
            )}
          </ScrollView>
          <View style={styles.categoryModalFooter}>
            <Button label="Back" variant="outline" leftIcon="chevron-back" fitContent onPress={() => setOpenLetter(null)} />
            <Button
              label="Next"
              variant="primaryGradient"
              rightIcon="checkmark"
              style={styles.categoryModalFooterNext}
              onPress={() => setOpenLetter(null)}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

/**
 * Fixed instances rendered as a numbered checklist with a progress header
 * rather than a tab strip -- what a long fixed set (Internal Areas' 11 room
 * types) needs, since 11 tabs in a horizontal scroller hides most of them and
 * gives no sense of how much is left. Each row opens its own full-screen form.
 * Opted into with `repeat.collapsible`.
 */
function FixedListRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const repeat = field.repeat ?? { presentation: 'fixed-tabs' as const };
  const itemFields = field.itemFields ?? [];
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  const fixedInstances = repeat.fixedInstances ?? [];
  const [openKey, setOpenKey] = useState<string | null>(null);
  const titleKey = repeat.titleFieldKey;
  const noun = repeat.itemNoun ?? 'item';
  const nounTitle = noun.charAt(0).toUpperCase() + noun.slice(1);

  /** The inspector's own name for an instance, when they've typed one. */
  const customName = (key: string): string | undefined => {
    const v = titleKey ? (record[key] ?? {})[titleKey] : undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };

  // Added instances are derived from the answer tree, not local state, so they
  // survive leaving and re-entering the section the same way their answers do.
  const fixedKeys = new Set(fixedInstances.map((f) => f.key));
  const extraInstances = Object.keys(record)
    .filter((k) => !fixedKeys.has(k))
    .map((key, i) => ({ key, label: `${nounTitle} ${fixedInstances.length + i + 1}` }));

  const allInstances = [...fixedInstances, ...extraInstances].map((inst) => ({
    ...inst,
    label: customName(inst.key) ?? inst.label,
  }));
  const open = allInstances.find((i) => i.key === openKey);

  // Naming an instance isn't inspecting it -- a renamed but otherwise empty
  // room still reads as Pending.
  const isRecorded = (key: string) =>
    Object.entries(record[key] ?? {}).some(([k, v]) => k !== titleKey && isAnswered(v));
  const doneCount = allInstances.filter((i) => isRecorded(i.key)).length;
  const total = allInstances.length || 1;
  const pct = Math.round((doneCount / total) * 100);

  function addInstance() {
    const key = `extra_${Date.now()}`;
    onChange({ ...record, [key]: {} });
    setOpenKey(key);
  }

  function removeInstance(key: string) {
    const next = { ...record };
    delete next[key];
    onChange(next);
    if (openKey === key) setOpenKey(null);
  }

  return (
    <View style={styles.block}>
      <View style={styles.progressCard}>
        <View style={styles.progressHeadRow}>
          <Text style={styles.progressTitle}>{nounTitle} Progress</Text>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
        <ProgressBar progress={doneCount / total} />
        <Text style={styles.progressSub}>
          {doneCount} of {allInstances.length} {noun}
          {allInstances.length === 1 ? '' : 's'} recorded
        </Text>
      </View>

      {allInstances.map((inst, idx) => {
        const recorded = isRecorded(inst.key);
        return (
          <Pressable key={inst.key} style={styles.numberedRow} onPress={() => setOpenKey(inst.key)}>
            <View style={[styles.numberBubble, recorded && styles.numberBubbleDone]}>
              <Text style={[styles.numberBubbleText, recorded && styles.numberBubbleTextDone]}>{idx + 1}</Text>
            </View>
            <Text style={styles.numberedRowLabel} numberOfLines={1}>
              {idx + 1}. {inst.label}
            </Text>
            <View style={[styles.statusPill, recorded && styles.statusPillDone]}>
              <Text style={[styles.statusPillText, recorded && styles.statusPillTextDone]}>
                {recorded ? 'Recorded' : 'Pending'}
              </Text>
            </View>
            {!fixedKeys.has(inst.key) && (
              <Pressable onPress={() => removeInstance(inst.key)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </Pressable>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        );
      })}

      {repeat.addable && (
        <Pressable onPress={addInstance} style={styles.addBtn}>
          <Ionicons name="add" size={14} color={colors.barBlue} />
          <Text style={styles.addBtnText}>{repeat.addButtonLabel ?? `Add ${nounTitle}`}</Text>
        </Pressable>
      )}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpenKey(null)}>
        <SafeAreaView style={styles.categoryModalRoot} edges={['top', 'bottom']}>
          <View style={styles.categoryModalHeader}>
            <Pressable onPress={() => setOpenKey(null)} hitSlop={8} style={styles.categoryModalBack}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={styles.categoryModalBackText}>Back</Text>
            </Pressable>
            <Text style={styles.categoryModalTitle} numberOfLines={1}>{open?.label}</Text>
            <View style={styles.categoryModalBack} />
          </View>
          <ScrollView style={styles.categoryModalBody} contentContainerStyle={styles.categoryModalBodyContent}>
            {open && (
              <FieldListRenderer
                fields={itemFields}
                scope={record[open.key] ?? {}}
                onChange={(k, v) => onChange({ ...record, [open.key]: { ...(record[open.key] ?? {}), [k]: v } })}
                path={[...path, open.key]}
              />
            )}
          </ScrollView>
          <View style={styles.categoryModalFooter}>
            <Button label="Back" variant="outline" leftIcon="chevron-back" fitContent onPress={() => setOpenKey(null)} />
            <Button
              label="Next"
              variant="primaryGradient"
              rightIcon="checkmark"
              style={styles.categoryModalFooterNext}
              onPress={() => setOpenKey(null)}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Scrollable, freely addable list of instances (most sections) or a damage-list. State mostly lives in the answer tree; only which modal (if any) is open is local. */
function StripListRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const itemFields = field.itemFields ?? [];
  const list = Array.isArray(value) ? (value as AnswerTree[]) : [];
  // "collapsible" means: don't render instances inline at all -- show a
  // tap-to-open list of just their titles, each opening its full form in a
  // full-screen window (mirrors CategoryNavForm's own drill-down one level
  // up, for repeating groups whose itemFields are long enough that having
  // every instance on-screen at once doesn't scale, e.g. a checklist-gated
  // Part).
  const openInModal = !!field.repeat?.collapsible;
  const categoryNav = field.repeat?.categoryNav;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  function titleFor(instScope: AnswerTree, idx: number): string {
    const titleKey = field.repeat?.titleFieldKey;
    const customTitle = titleKey ? (instScope[titleKey] as string | undefined) : undefined;
    return customTitle?.trim()
      ? customTitle
      : field.type === 'damage-list' ? `Item ${idx + 1}` : `${field.label} ${idx + 1}`;
  }

  function updateInstance(idx: number, k: string, v: AnswerValue) {
    const next = [...list];
    next[idx] = { ...(next[idx] ?? {}), [k]: v };
    onChange(next);
  }
  function addInstance() {
    onChange([...list, {}]);
    if (openInModal) setOpenIdx(list.length);
  }
  function removeInstance(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
    if (openIdx === idx) setOpenIdx(null);
  }

  if (openInModal) {
    const openInst = openIdx !== null ? list[openIdx] : undefined;
    return (
      <View style={styles.block}>
        <Text style={styles.groupLabel}>{field.label}</Text>
        {list.map((instScope, idx) => (
          <Pressable key={idx} style={styles.categoryRow} onPress={() => setOpenIdx(idx)}>
            <View style={styles.instanceHeaderTitleRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.barBlue} />
              <Text style={styles.categoryRowLabel}>{titleFor(instScope, idx)}</Text>
            </View>
            <View style={styles.categoryRowActions}>
              {(list.length > 1 || field.type === 'damage-list') && (
                <Pressable onPress={() => removeInstance(idx)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </Pressable>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </Pressable>
        ))}
        {(field.repeat?.addable ?? true) && (
          <Pressable onPress={addInstance} style={styles.addBtn}>
            <Ionicons name="add" size={14} color={colors.barBlue} />
            <Text style={styles.addBtnText}>{field.repeat?.addButtonLabel ?? `Add ${field.label}`}</Text>
          </Pressable>
        )}
        <Modal visible={openIdx !== null} animationType="slide" onRequestClose={() => setOpenIdx(null)}>
          <SafeAreaView style={styles.categoryModalRoot} edges={['top', 'bottom']}>
            <View style={styles.categoryModalHeader}>
              <Pressable onPress={() => setOpenIdx(null)} hitSlop={8} style={styles.categoryModalBack}>
                <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
                <Text style={styles.categoryModalBackText}>Back</Text>
              </Pressable>
              <Text style={styles.categoryModalTitle} numberOfLines={1}>
                {openIdx !== null ? titleFor(list[openIdx] ?? {}, openIdx) : ''}
              </Text>
              <View style={styles.categoryModalBack} />
            </View>
            <ScrollView style={styles.categoryModalBody} contentContainerStyle={styles.categoryModalBodyContent}>
              {openInst && openIdx !== null && (
                categoryNav ? (
                  <CategoryNavForm
                    itemFields={itemFields}
                    selectorFieldKey={categoryNav.selectorFieldKey}
                    scope={openInst}
                    onChange={(k, v) => updateInstance(openIdx, k, v)}
                    path={[...path, String(openIdx)]}
                  />
                ) : (
                  <FieldListRenderer
                    fields={itemFields}
                    scope={openInst}
                    onChange={(k, v) => updateInstance(openIdx, k, v)}
                    path={[...path, String(openIdx)]}
                  />
                )
              )}
            </ScrollView>
            <View style={styles.categoryModalFooter}>
              <Button label="Back" variant="outline" leftIcon="chevron-back" fitContent onPress={() => setOpenIdx(null)} />
              <Button
                label="Next"
                variant="primaryGradient"
                rightIcon="checkmark"
                style={styles.categoryModalFooterNext}
                onPress={() => setOpenIdx(null)}
              />
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{field.label}</Text>
      {list.map((instScope, idx) => (
        <View key={idx} style={styles.instanceCard}>
          <View style={styles.instanceHeader}>
            <Text style={styles.instanceTitle}>{titleFor(instScope, idx)}</Text>
            {(list.length > 1 || field.type === 'damage-list') && (
              <Pressable onPress={() => removeInstance(idx)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <FieldListRenderer
            fields={itemFields}
            scope={instScope}
            onChange={(k, v) => updateInstance(idx, k, v)}
            path={[...path, String(idx)]}
          />
        </View>
      ))}
      {(field.repeat?.addable ?? true) && (
        <Pressable onPress={addInstance} style={styles.addBtn}>
          <Ionicons name="add" size={14} color={colors.barBlue} />
          <Text style={styles.addBtnText}>{field.repeat?.addButtonLabel ?? `Add ${field.label}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

export const FIELD_RENDERERS: Record<TemplateFieldType, React.ComponentType<FieldRendererProps>> = {
  text: TextFieldRenderer,
  textarea: TextareaFieldRenderer,
  numeric: NumericFieldRenderer,
  date: DateFieldRenderer,
  yesno: YesNoFieldRenderer,
  'pill-select': PillSelectFieldRenderer,
  'select-tiles': SelectTilesFieldRenderer,
  'color-select': ColorSelectFieldRenderer,
  'chip-multiselect': ChipMultiSelectFieldRenderer,
  photos: PhotosFieldRenderer,
  'repeating-group': RepeatingFieldRenderer,
  'damage-list': RepeatingFieldRenderer,
};

export * from './types';

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  letterHeaderBand: {
    backgroundColor: colors.accentBlue,
    borderLeftWidth: 4,
    borderLeftColor: colors.barBlue,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  letterHeaderText: {
    ...typography.label,
    color: colors.barBlue,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  tabStrip: { marginBottom: spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { borderColor: colors.barBlue, backgroundColor: colors.accentBlue },
  tabText: { ...typography.bodySm, color: colors.textSecondary },
  tabTextActive: { color: colors.barBlue, fontWeight: '700' },
  instanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  instanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  instanceHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  instanceTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  checklistRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.md, marginBottom: spacing.md },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  addBtnText: { ...typography.bodySm, color: colors.barBlue, fontWeight: '600' },
  categoryNavBlock: { marginTop: spacing.sm },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  categoryRowLabel: { ...typography.bodySm, color: colors.textPrimary, fontWeight: '600' },
  categoryRowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  categoryModalRoot: { flex: 1, backgroundColor: colors.background },
  categoryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryModalBack: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 60 },
  categoryModalBackText: { ...typography.bodySm, color: colors.textPrimary },
  categoryModalTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1, textAlign: 'center' },
  categoryModalBody: { flex: 1 },
  categoryModalBodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  categoryModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  categoryModalFooterNext: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  navRowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowEmoji: { fontSize: 18 },
  navRowText: { flex: 1, minWidth: 0 },
  navRowTitle: { ...typography.bodySm, color: colors.textPrimary, fontWeight: '700' },
  navRowHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  progressCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  progressHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
  progressPct: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  progressSub: { ...typography.caption, color: colors.textMuted },
  numberedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  numberBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBubbleDone: { backgroundColor: colors.accentBlue, borderColor: colors.barBlue },
  numberBubbleText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  numberBubbleTextDone: { color: colors.barBlue },
  numberedRowLabel: { ...typography.bodySm, color: colors.textPrimary, fontWeight: '600', flex: 1, minWidth: 0 },
  statusPill: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  statusPillDone: { backgroundColor: colors.accentBlue },
  statusPillText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  statusPillTextDone: { color: colors.barBlue, fontWeight: '700' },
});
