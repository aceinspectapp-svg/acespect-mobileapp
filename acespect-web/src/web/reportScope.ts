/**
 * Standard SCOPE / limitations appendix (AS 4349-style) appended to the
 * Notes & Post Project section of the report. Static boilerplate, stored as
 * structured blocks so it renders with consistent numbering/indentation.
 */
export type ScopeBlock =
  | { kind: "section"; n: string; title: string }
  | { kind: "clause"; n: string; text: string }
  | { kind: "subheading"; n: string; title: string }
  | { kind: "para"; text: string }
  | { kind: "list"; intro?: string; items: { label: string; text: string; note?: string }[] };

export const SCOPE_TITLE = "SCOPE";

export const SCOPE_BLOCKS: ScopeBlock[] = [
  { kind: "section", n: "1", title: "PURPOSE OF INSPECTION" },
  {
    kind: "para",
    text: "The purpose of the inspection is to provide advice regarding the construction of the property.",
  },
  {
    kind: "clause",
    n: "1.1",
    text:
      "The report should not be seen as an all-encompassing report dealing with a building from every " +
      "aspect. Rather it should be seen as a reasonable attempt to identify any significant defects visible " +
      "at the time of the inspection. Whether or not a defect is significant depends to a large degree on " +
      "the age of the building. It is unrealistic to comment on minor defects or imperfections in a standard report.",
  },
  {
    kind: "clause",
    n: "1.2",
    text:
      "THIS IS A VISUAL INSPECTION ONLY limited to those areas and sections of the property fully " +
      "accessible and visible to the inspector at the time of the inspection. The inspection DOES NOT " +
      "include breaking apart, dismantling, removing or moving objects including but not limited to " +
      "foliage, moulding, roof insulation/sisalation, floor or wall coverings, sidings, ceilings, floors, " +
      "furnishings, appliances or personal possessions. The inspector CANNOT see inside walls, between " +
      "floors, inside skillion roofing, behind assorted goods in cupboards, or other areas that are " +
      "concealed or obstructed. The inspector CANNOT dig, gouge, force or perform any other invasive " +
      "procedures. Visible timbers CANNOT be destructively probed or hit without written permission of the property owner.",
  },

  { kind: "section", n: "2", title: "SCOPE OF INSPECTION" },
  {
    kind: "para",
    text:
      "The inspection shall comprise visual assessment of accessible areas of the property to identify " +
      "major defects to the building structure and to form an opinion regarding the general condition of " +
      "the structure of the property.",
  },
  {
    kind: "list",
    intro: "NOTE: The report may not contain any assessment or an opinion regarding the following:",
    items: [
      {
        label: "a)",
        text:
          "Any non-structural element, eg. general gas, water and sanitary plumbing, electrical wiring, " +
          "partition walls, cabinetry, windows, doors, trims, fencing, minor structures, non-structural " +
          "damp issues, ceiling linings, floor coverings, decorative finishes such as plastering, painting, tiling etc.",
      },
      {
        label: "b)",
        text:
          "An assessment of any aspect or component of the property that cannot be seen or that requires " +
          "testing and/or measurement to determine soundness.",
      },
      { label: "c)", text: "Any area or item that was not, or could not be, observed by the inspector." },
      {
        label: "d)",
        text:
          "General maintenance other than that which is deemed to be directly related to the ongoing " +
          "structural performance of the property.",
      },
      {
        label: "e)",
        text:
          "Serviceability damp defects such as condensation, rising damp, lateral damp, falling damp should " +
          "only be assessed and reported on where structural damage has occurred, is occurring, or may occur " +
          "(eg. fungal rot), significant spalling of masonry or concrete structural elements, significant " +
          "fretting of mortar, rusting of primary structural elements. Stormwater drainage and surface water " +
          "defects commonly cause or exacerbate foundation instability and these issues should be assessed and " +
          "reported where relevant.",
      },
    ],
  },

  { kind: "section", n: "3", title: "DEFECTS" },
  {
    kind: "para",
    text:
      "The presence or otherwise of defects shall only be relevant when such defects relate to the " +
      "structural condition of the building.",
  },
  {
    kind: "clause",
    n: "3.1",
    text:
      "During an inspection the inspector shall be alert to the possibility that a building element is " +
      "defective but that the defect does not fit neatly into one of the categories of defect. In such a " +
      "case, the inspector may use a combination of defect properties, or otherwise assess and describe the " +
      "defect in his/her own words, based on his/her experience.",
  },
  {
    kind: "para",
    text:
      "In many cases, the actual structural elements of a building may be obscured by finishes and other " +
      "non-structural building elements, and the inspector may be unable to assess directly the state of the " +
      "structural member. In such cases, the inspector has to infer the performance of the structure by " +
      "observing the effect of the structure on the non-structural building elements. For example, the " +
      "inspector normally will be unable to inspect the footings of a house as they are buried beneath the " +
      "ground; however, cracking in non-structural masonry walls above the ground may indicate that a defect " +
      "exists within the footing system.",
  },
  { kind: "subheading", n: "3.2", title: "Major defect" },
  {
    kind: "para",
    text:
      "A defect of sufficient magnitude where rectification has to be carried out in order to avoid unsafe " +
      "conditions, loss of utility or further deterioration of the property.",
  },
  { kind: "subheading", n: "3.3", title: "Structural defect" },
  {
    kind: "para",
    text:
      "Fault or deviation from the intended structural performance of a load bearing element that requires " +
      "immediate intervention to avert further deterioration.",
  },
  { kind: "subheading", n: "3.4", title: "Minor defect" },
  {
    kind: "para",
    text:
      "A defect other than a major defect that requires immediate intervention to avert further deterioration.",
  },
  {
    kind: "para",
    text:
      "The report shall describe the overall extent of minor defects. The inspector is not required to " +
      "comment on individual minor defects and imperfections.",
  },
  {
    kind: "para",
    text:
      "Minor defects are common to most properties and may include minor blemishes, corrosion, cracking, " +
      "weathering, general deterioration, unevenness, and physical damage to materials and finishes, such as " +
      "de-silvering of mirrors. It is expected that defects of this type would be rectified as part of normal " +
      "ongoing property maintenance.",
  },

  { kind: "section", n: "4", title: "LIMITATIONS OF STANDARD" },
  {
    kind: "para",
    text:
      "A report prepared in accordance with this Standard is not a certificate of compliance of the property " +
      "within the requirements of any Act, regulation, ordinance, local law or by-law, and is not a warranty " +
      "against problems developing with the building in the future.",
  },
  {
    kind: "para",
    text:
      "This Standard does not include the identification of unauthorised building work or of work not " +
      "compliant with building regulations.",
  },
  { kind: "para", text: "This Standard assumes that the existing use of the building will continue." },

  { kind: "section", n: "5", title: "EXTENT OF REPORTING" },
  {
    kind: "list",
    intro: "Significant items to be reported are as follows:",
    items: [
      { label: "a)", text: "Major defects." },
      {
        label: "b)",
        text: "Any major defect that is an urgent and serious safety hazard.",
        note: "NOTE: For example, unsafe balustrades or imminent collapse of a structural member.",
      },
      {
        label: "c)",
        text: "A general impression regarding the extent of minor defects.",
        note: "NOTE: For example, significantly deteriorating exterior paint.",
      },
    ],
  },

  { kind: "section", n: "6", title: "ACCEPTANCE CRITERIA" },
  {
    kind: "para",
    text:
      "The building shall be compared with a building that was constructed in accordance with the generally " +
      "accepted practice at the time of construction and which has been maintained such that there has been " +
      "no significant loss of strength and serviceability.",
  },

  { kind: "section", n: "7", title: "AREAS TO BE INSPECTED" },
  { kind: "subheading", n: "7.1", title: "General" },
  {
    kind: "para",
    text:
      "The inspector shall inspect accessible parts of the building and appurtenances, together with relevant " +
      "features of the property within 30 metres of the building and within the boundaries of the site, or as " +
      "otherwise agreed in the inspection agreement. In this context, relevant features include car " +
      "accommodation, detached laundry, ablution facilities and garden sheds, retaining walls more than 700 " +
      "millimetres high, paths and driveways, steps, fencing.",
  },
  {
    kind: "para",
    text:
      "Inspection of Strata and Company Title residential property shall be limited to the nominated residence " +
      "and may not include common property.",
  },
  { kind: "clause", n: "7.2", text: "The following areas shall be inspected where applicable or accessible:" },
  {
    kind: "list",
    items: [
      { label: "a)", text: "The interior of the building." },
      { label: "b)", text: "The roof space." },
      { label: "c)", text: "The exterior of the building." },
      { label: "d)", text: "The sub-floor space." },
      { label: "e)", text: "The roof exterior." },
      { label: "f)", text: "The property within 30 metres of the building subject to inspection." },
    ],
  },
  { kind: "subheading", n: "7.3", title: "Safe and reasonable access" },
  {
    kind: "para",
    text:
      "The extent of accessible areas shall be determined by the inspector at the time of inspection, based on " +
      "the conditions encountered at the time of inspection. The inspector shall also determine whether " +
      "sufficient space is available to allow safe access.",
  },
  {
    kind: "para",
    text:
      "The inspection shall include only accessible areas and areas that are within the inspector's line of " +
      "sight and close enough to enable reasonable appraisal.",
  },
  {
    kind: "list",
    intro: "The inspector shall inspect an elevated area only where:",
    items: [
      {
        label: "a)",
        text:
          "it is at a height at which safe reasonable access is available, or where safe and reasonable " +
          "access is otherwise available; or",
      },
      {
        label: "b)",
        text:
          "an unobstructed line of sight is present from safe use of a 3.6 metre ladder and the building " +
          "elements present are close enough to allow appraisal.",
        note:
          "NOTE: 'Elevated area' includes the roof, roof space, crawl space, landing feature, and the like, " +
          "generally elevated above the ground and intended for normal use by occupants.",
      },
    ],
  },
  {
    kind: "clause",
    n: "7.4",
    text:
      "A 3.6 metre ladder is considered generally reasonable for safe use by one operator during an " +
      "inspection. Regardless of the ladder length, weight and size, safe use of a ladder or safe access may " +
      "mean that inspection of a roof, elevated platform or roof space is not possible in part, or at all, " +
      "during an inspection and, in such circumstances, the inspector may recommend the use of special access " +
      "equipment and that a further inspection be undertaken when a safe method of access is present.",
  },
  { kind: "subheading", n: "7.5", title: "Areas for Inspection" },
  { kind: "para", text: "The inspection shall cover all accessible areas." },
  {
    kind: "para",
    text:
      "The client shall arrange right of entry, facilitate physical entry to the property and supply " +
      "necessary information to enable the inspector to undertake the inspection and prepare a report. The " +
      "inspector is not responsible for arranging entry to property or parts of property.",
  },
  {
    kind: "para",
    text:
      "Areas where reasonable entry is denied to the inspector, or where reasonable access is not available, " +
      "are excluded from, and do not form part of, the inspection.",
  },
  { kind: "subheading", n: "7.6", title: "Inspection process" },
  {
    kind: "para",
    text: "The inspection shall comprise visual appraisal and limited assessment of serviceability.",
  },
  {
    kind: "clause",
    n: "7.7",
    text:
      "Where large structural retaining walls are in service to a property a special purpose building report " +
      "will be required by a structural engineer. The inspector may or may not comment in this report as to " +
      "whether an engineer is required or not.",
  },

  { kind: "section", n: "8", title: "EXCLUSION OF ITEMS FROM INSPECTION" },
  {
    kind: "list",
    intro: "The inspector need not inspect, nor report on the following:",
    items: [
      { label: "a)", text: "Footings below ground." },
      { label: "b)", text: "Concealed damp-proof course." },
      {
        label: "c)",
        text:
          "Electrical installations, operation of smoke detectors, light switches and fittings, TV, sound and " +
          "communications and security systems.",
      },
      { label: "d)", text: "Concealed plumbing." },
      { label: "e)", text: "Adequacy of roof drainage as installed." },
      { label: "f)", text: "Gas fittings and fixtures." },
      { label: "g)", text: "Air-conditioning." },
      { label: "h)", text: "Automatic garage door mechanisms." },
      {
        label: "i)",
        text: "Swimming pools and associated filtration and similar equipment.",
        note:
          "NOTE: If a swimming pool is present it should be the subject of a Special Purpose Property Report. " +
          "A detailed inspection on the status or serviceability of any swimming pool or associated pool " +
          "equipment has not been carried out and is not within the scope of this report. Additionally, to " +
          "adequately inspect a swimming pool, the water must be completely drained and all internal surfaces " +
          "must be fully accessible.",
      },
      { label: "j)", text: "The operation of fireplaces and solid fuel heaters, including chimneys and flues." },
      { label: "k)", text: "Alarm systems." },
      { label: "l)", text: "Electrical appliances including dishwashers, incinerators, ovens, ducted vacuum systems." },
      { label: "m)", text: "Paint coatings, except external protective coatings." },
      { label: "n)", text: "Health hazards (eg. allergies, lead content, presence of asbestos, soil toxicity)." },
      { label: "o)", text: "Timber and metal framing sizes and adequacy." },
      { label: "p)", text: "Concealed tie-downs and bracing." },
      { label: "q)", text: "Timber pest activity." },
      { label: "r)", text: "Soil conditions." },
      { label: "s)", text: "Control joints." },
      { label: "t)", text: "Concealed framing-timber or any areas concealed by wall linings/sidings." },
      { label: "u)", text: "Furniture and accessories." },
    ],
  },
  {
    kind: "para",
    text:
      "Estimating the cost of remedying defects is not included in a standard Property report, although it " +
      "may form part of a special-purpose Property report.",
  },
  {
    kind: "list",
    intro: "Houspect has tried to categorise our gradings as:",
    items: [
      { label: "•", text: "New: Self-explanatory." },
      { label: "•", text: "Satisfactory: Generally good condition." },
      { label: "•", text: "Fair: Starting to look like it needs maintenance." },
      { label: "•", text: "Average: Working but needs maintenance within 6 months." },
      { label: "•", text: "Poor: Needs replacement." },
    ],
  },
  {
    kind: "para",
    text:
      "As appropriate to any particular property or material other terms may be used for gradings and to " +
      "describe condition such as aged, dilapidated, deteriorated, weathered, rusting, delaminated, rotted, " +
      "decayed, subsided, etc.",
  },
  {
    kind: "para",
    text:
      "Wherever we describe a building material in this report, the client acknowledges that the material " +
      "described represents a substantial component of the building material observed.",
  },
];
