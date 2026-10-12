// Fills in a form from its real template: every field the form shows for the answers given gets a plausible answer (every select answered,
// every multi-select ticked, every text box written, every repeating item and a defect of each type completed, photographs on every photo
// field). Used to build fully populated sample reports and the report audit's scenarios.
export function makeFiller({ tplOf, photosFor }) {
// ---- filling a form ----------------------------------------------------------------------------------------------------------------
  const GRADES = ["satisfactory_with_typical_wear_and_tear", "fair", "average", "poor", "new"];
  let rotate = 0;
  let grade = 0;
  const SKIP_CHOICE = /^(not applicable|none\b|n\/?a\b|no visible|no significant|nil\b|no chimney|nothing|no repairs|no attention|not required|no$)/i;
  const SENTENCES = [
    "Photographed and noted on the day of the inspection.",
    "No access was available to the far side, so this was assessed from the near side only.",
    "Recorded for the before-works condition of the property.",
  ];
  let sentenceAt = 0;
  
  function textFor(f, ctx) {
    const k = f.key;
    const lab = f.label ?? "";
    const by = [
      [/^jobNumber$/, ctx.jobNo], [/^assignedInspector$/, "Report Smoke"], [/^clientName$/, ctx.client], [/^inspectionAddress$/, "1 Sample Street, Box Hill VIC 3128"],
      [/^businessName$/, "Sample Building Co."], [/^firstPicNo$/, "1"], [/^lastPicNo$/, "120"], [/constructedYear/i, "1998"], [/^underConstructionStage$/, "frame stage"],
      [/^storeys$/, "2"], [/projectSiteAddress|projectAddr/, "3 Sample Street, Box Hill VIC 3128"], [/^partyWallNumber$/, "12"], [/^unitNumber$/, "7"], [/^buildingName$/, "Sample Heights"],
      [/^partName$/, ctx.partName ?? "Part A: Frontage to project site"], [/^roadName$/, "Sample Street"], [/^startRef$/, "3m past the boundary of no. 5"], [/^endRef$/, "the corner of Smith Street"],
      [/^startDirection$/, "south to north"], [/^crackStartLocation$/, "the front corner"], [/^crackEndLocation$/, "the rear corner"], [/^location$/, ctx.where ?? "the centre of the area"],
      [/^element$/, "slab"], [/^description$/, "Timber pergola"], [/^otherDescription$/, "A small pump house at the north end"], [/^other$/, "A short note on an additional area."],
      [/^scopeChanges$/, "A second garage was added to the scope after the inspection was booked."], [/^scopeDetail$/, "the rear unit"], [/^scopePartDetail$/, "the ground floor"],
      [/^gen_roomsNotAccessed$|^roomsNotAccessed$/, "Plant room (locked)"], [/^gen_renovationsRooms$|^renovationsRooms$/, "the first floor offices"],
      [/movementWhere$/, "the hallway near the kitchen"], [/SafetyAdvisoryNotes$|^safetyAdvisoryNotes$/i, "Exposed cables were noted in the meter box."],
      [/^reason$/, "Locked at the time of the inspection"], [/^worstItem$/, "Rusted posts and leaning panels near the gate"], [/^drainageNote$/, "Water ponds near the downpipe."],
      [/^(areaName|elevationName|fenceName|structureName|wallName|roomName|name|area)$/, ctx.instanceLabel ?? "Rear courtyard"],
      [/proposedWorksTypeOther|worksTypeOther/, "tunnel works"], [/siteSideOther/, "opposite side"], [/siteDirectionOther/, "north-east"], [/weatherOther/, "light fog"],
      [/orientationOther/, "north-east corner"], [/partialInspectionOther/, "the side boundary"],
      [/Other$|^materialOther$/, "reclaimed hardwood"],
      [/notes$|Notes$|comments$|describe$|where$|^note$|Where$/i, null],
    ];
    for (const [re, v] of by) if (re.test(k)) return v ?? SENTENCES[sentenceAt++ % SENTENCES.length];
    return /address/i.test(lab) ? "1 Sample Street, Box Hill VIC 3128" : "as noted on site";
  }
  
  const wantedFor = (fields) => {
    const w = {};
    for (const f of fields) {
      const g = f.gate;
      if (!g || g.fieldKey === "__instanceKey") continue;
      (w[g.fieldKey] ??= []).push(...(g.equalsAny ?? [g.equals]));
    }
    return w;
  };
  const visible = (f, scope) => {
    const g = f.gate;
    if (!g) return true;
    const v = scope[g.fieldKey];
    const hit = (t) => (Array.isArray(v) ? v.includes(t) : v === t);
    return g.equalsAny ? g.equalsAny.some(hit) : hit(g.equals);
  };
  
  // Which fields of a section are filled in at least once (a party-wall field is filled on Left and Right only; a defect's crack fields on its cracking defect).
  const coverage = { total: new Set(), filled: new Set(), names: new Map() };
  const resetCoverage = () => { coverage.total.clear(); coverage.filled.clear(); coverage.names.clear(); };
  
  function pickChoice(f, wanted) {
    const opts = (f.options ?? []).filter((o) => !o.exclusive);
    const w = wanted?.find((v) => opts.some((o) => o.value === v));
    if (w) return w;
    if (f.type === "color-select") { const want = GRADES[grade++ % GRADES.length]; return opts.find((o) => o.value === want)?.value ?? opts[0]?.value; }
    if (f.key === "proposedWorksType") return opts.find((o) => /residential/i.test(o.label))?.value ?? opts[0]?.value;
    const pool = opts.filter((o) => o.value !== "other" && !SKIP_CHOICE.test(o.label.trim()));
    return (pool.length ? pool : opts)[rotate++ % (pool.length || opts.length)]?.value;
  }
  
  /** Fills every field the form shows for these `fields`. `preset` answers go in first (a defect's type, an instance's fixed answers). */
  function fill(fields, ctx = {}, preset = {}) {
    const scope = { ...preset };
    if (ctx.instanceKey) scope.__instanceKey = ctx.instanceKey;
    const wants = wantedFor(fields);
    const done = new Set(Object.keys(preset));
    for (let pass = 0; pass < 4; pass++) {
      for (const f of fields) {
        if (done.has(f.key) || !visible(f, scope) || (f.gate?.fieldKey === "__instanceKey" && !(f.gate.equalsAny ?? [f.gate.equals]).includes(ctx.instanceKey))) continue;
        done.add(f.key);
        scope[f.key] = valueOf(f, scope, ctx, wants[f.key]);
      }
    }
    delete scope.__instanceKey;
    for (const f of fields) {
      const sig = `${ctx.path ?? ""}|${f.key}`;
      coverage.total.add(sig);
      const parent = f.gate ? fields.find((x) => x.key === f.gate.fieldKey) : undefined;
      const reason = !f.gate ? "" : f.gate.fieldKey === "__instanceKey" ? "only on certain tabs" : parent && !(f.gate.equalsAny ?? [f.gate.equals]).some((v) => parent.options?.some((o) => o.value === v)) ? "its question has no such choice, so the app never shows it" : "shown only for a different answer";
      coverage.names.set(sig, `${ctx.path ?? ""}: ${f.label || f.key}  (${f.key}) -- ${reason}`);
      if (done.has(f.key) && !(f.gate?.fieldKey === "__instanceKey" && ctx.instanceKey && !(f.gate.equalsAny ?? [f.gate.equals]).includes(ctx.instanceKey))) coverage.filled.add(sig);
    }
    return scope;
  }
  
  function valueOf(f, scope, ctx, wanted) {
    switch (f.type) {
      case "yesno": return wanted?.includes("no") && !wanted.includes("yes") ? "no" : "yes";
      case "pill-select": case "select-tiles": case "color-select": return pickChoice(f, wanted);
      case "chip-multiselect": case "tile-multiselect": {
        const opts = (f.options ?? []).filter((o) => !o.exclusive && o.value !== "other" && !SKIP_CHOICE.test(o.label.trim()));
        const at = rotate++;
        const chosen = [0, 1, 2].map((i) => opts[(at + i) % Math.max(1, opts.length)]?.value).filter((v, i, a) => v && a.indexOf(v) === i);
        const withOther = (f.options ?? []).some((o) => o.value === "other") && ctx.fields?.some?.((x) => x.key === `${f.key}Other`);
        const wantsAll = (wanted ?? []).filter((v) => (f.options ?? []).some((o) => o.value === v));
        return [...new Set([...chosen, ...wantsAll, ...(withOther ? ["other"] : [])])];
      }
      case "photos": { const p = photosFor(ctx); if (!ctx.defect) ctx.collect?.push(...p); return p; }
      case "numeric": return /width/i.test(f.key) ? 3 : /length/i.test(f.key) ? 450 : 2;
      case "date": return "2026-10-03";
      case "damage-list": return defects(f, ctx);
      case "repeating-group": return group(f, ctx);
      default: return textFor(f, ctx);
    }
  }
  
  function defects(f, ctx) {
    const items = f.itemFields ?? [];
    const typeField = items.find((x) => x.key === "damageType");
    const types = (typeField?.options ?? []).filter((o) => o.value !== "other").map((o) => o.value);
    const where = ["the centre of the slab", "the north-east corner", "the base of the wall", "the front edge", "the rear corner", "the join at the step", "the top rail", "the lowest course"];
    // One defect of each type, so every defect type's own fields (the cracking size, the surface / moisture / movement ... choice) are filled in.
    return (types.length ? types : [undefined]).map((type, i) => {
      const preset = type ? { damageType: type } : {};
      return fill(items, { ...ctx, defect: true, defectNo: i, where: where[i % where.length], fields: items, path: `${ctx.path ?? ""} > ${f.label}` }, preset);
    });
  }
  
  function group(f, ctx) {
    const items = f.itemFields ?? [];
    const fixed = f.repeat?.fixedInstances;
    if (fixed?.length && f.repeat.presentation !== "strip") {
      return Object.fromEntries(fixed.map((inst) => [inst.key, fill(items, { ...ctx, instanceKey: inst.key, instanceLabel: inst.label, fields: items, path: `${ctx.path ?? ""} > ${f.label || f.key}` })]));
    }
    return [0, 1].map((i) => fill(items, { ...ctx, partName: i ? "Part B: Laneway" : "Part A: Frontage to project site", fields: items, path: `${ctx.path ?? ""} > ${f.label || f.key}` }));
  }
  
  function fillSection(profile, key, ctx) {
    const t = tplOf(profile, key);
    const collect = [];
    const answers = fill(t.fields, { ...ctx, collect, fields: t.fields, path: t.name });
    return { key, name: t.name, answers, photos: collect };
  }

  return { fillSection, coverage, resetCoverage };
}
