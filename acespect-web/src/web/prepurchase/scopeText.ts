/**
 * The Pre-Purchase / Apartment template's SCOPE, DEFECTS and Condition Definitions, word for word with its clause numbers, from
 * Houspect's office template "ACESPECT Building (Pre-Purchase)_Apartment Nov 2026.dotm" (generated from that file's text and numbering;
 * do not reword here -- update the template, then regenerate). The template's own cross-references ("Clause 4", "clause 4.2") are kept.
 */

export type ScopeBlock =
  | { kind: "section"; n: string; title: string }
  | { kind: "clause"; n: string; term?: string; paras: string[] }
  | { kind: "item"; n: string; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "para"; text: string };

/** "SCOPE": 1 Purpose of inspection, 2 Scope of inspection. */
export const PPI_SCOPE_TITLE = "SCOPE";
export const PPI_SCOPE_BLOCKS: ScopeBlock[] = [
  {"kind": "section", "n": "1", "title": "PURPOSE OF INSPECTION"},
  {"kind": "clause", "n": "1.1", "paras": ["The purpose of the inspection is to provide general advice to a prospective purchaser or other interested party regarding the condition of the structure of the Property at the time of the inspection inline with the terms and conditions of this report."]},
  {"kind": "section", "n": "2", "title": "SCOPE OF INSPECTION"},
  {"kind": "clause", "n": "2.1", "paras": ["The Inspection will be limited to the Scope outlined in the Quotation or as otherwise agreed in writing, and"]},
  {"kind": "clause", "n": "2.2", "paras": ["The Inspection will be undertaken generally in accordance with AS 4349.0 – 2007 and AS 4349.1 – 2007 as applicable. Where there exists any conflict between the Australian Standards and this Agreement, the Agreement prevails."]},
  {"kind": "clause", "n": "2.3", "paras": ["Unless otherwise agreed in writing, the inspection will not include invasive or destructive examination or investigation for latent or hidden defects. Houspect will have no liability for any defects not reasonably manifest and visible at the time of Inspection through a visual inspection. Houspect is also not obliged to inspect any inaccessible or concealed areas of the Property, or to provide any comment in the Report in relation to:"]},
  {"kind": "item", "n": "(a)", "text": "hidden or obscured defects;"},
  {"kind": "item", "n": "(b)", "text": "latent Site or Property conditions; or"},
  {"kind": "item", "n": "(c)", "text": "whether the Property complied with Australian Standards, relevant Building Codes or Legislative Requirements at the time the Property was constructed."},
  {"kind": "clause", "n": "2.4", "paras": ["The Inspector will compare the prevailing conditions of the Property and use his/her best endeavours to indicate in the Report whether any defect is in the nature of the following:"]},
  {"kind": "item", "n": "(a)", "text": "a major defect, which is a defect of sufficient magnitude where rectification has to be carried out in order to avoid unsafe conditions, loss of utility or further deterioration of the Property;"},
  {"kind": "item", "n": "(b)", "text": "a minor defect, which is a defect other than a major defect, for which a general comment is made; and"},
  {"kind": "item", "n": "(c)", "text": "a safety hazard, which includes only physical observed defects which the Inspector considers to be a safety hazard."},
  {"kind": "clause", "n": "2.5", "paras": ["Subject to this Clause 4, the Inspector shall inspect and report on the specific areas nominated in the Quotation (if any) and if requested, such parts of the building and its appurtenances, together with the Property generally within its boundaries where safely accessible. This may include the following areas:"]},
  {"kind": "item", "n": "(a)", "text": "the interior of the building;"},
  {"kind": "item", "n": "(b)", "text": "the roof space;"},
  {"kind": "item", "n": "(c)", "text": "the exterior of the building;"},
  {"kind": "item", "n": "(d)", "text": "the sub-floor space;"},
  {"kind": "item", "n": "(e)", "text": "the roof exterior; and"},
  {"kind": "item", "n": "(f)", "text": "any relevant feature of the Property within 30m of the main building (and within the boundaries of the Site)."},
  {"kind": "clause", "n": "2.6", "paras": ["Inspection of strata and company title Property shall be limited to the nominated residence and, subject to Clause 6, does not include common property."]},
  {"kind": "clause", "n": "2.7", "paras": ["The Inspector shall inspect any Elevated Area only where:"]},
  {"kind": "item", "n": "(a)", "text": "it is at a height at which safe reasonable access is available, or where safe and reasonable access is otherwise available; or"},
  {"kind": "item", "n": "(b)", "text": "an unobstructed line of sight is present from safe use of a 3.6m ladder and the building elements present are close enough to allow appraisal."},
  {"kind": "clause", "n": "2.8", "paras": ["Any areas where reasonable access is denied, not made available or inaccessible for any reason, are excluded from, and do not form part of, the Inspection and the Report. Where the Inspector is unable or unwilling pursuant to this Agreement to access areas of the Property, these areas may be noted in the Report."]},
  {"kind": "clause", "n": "2.9", "paras": ["Any comments made in the Report in relation to the following are general in nature only and may not be relied upon in any advisory sense by the Client. The Client should engage suitably experienced contractors to review any comments made in the Report related to:"]},
  {"kind": "item", "n": "(a)", "text": "plumbing;"},
  {"kind": "item", "n": "(b)", "text": "electrical;"},
  {"kind": "item", "n": "(c)", "text": "engineering;"},
  {"kind": "item", "n": "(d)", "text": "mould;"},
  {"kind": "item", "n": "(e)", "text": "toxicology;"},
  {"kind": "item", "n": "(f)", "text": "waterproofing;"},
  {"kind": "item", "n": "(g)", "text": "gas fittings;"},
  {"kind": "item", "n": "(h)", "text": "air conditioning;"},
  {"kind": "item", "n": "(i)", "text": "pests, such as termites; and"},
  {"kind": "item", "n": "(j)", "text": "asbestos"},
  {"kind": "item", "n": "(k)", "text": "swimming pool(s)."},
  {"kind": "subheading", "text": "Structural Defect Inspections"},
  {"kind": "clause", "n": "2.10", "paras": ["The Works will be limited to visual, line of sight inspections of the structural elements of the Property. Where necessary and accessible, this will include accessing subfloors and roof spaces to ascertain the extent of any readily identifiable defective workmanship."]},
  {"kind": "subheading", "text": "Standards and Guide"},
  {"kind": "clause", "n": "2.11", "paras": ["Without limiting clause 4.2, the Inspection is a pre-purchase inspection of a residential building and, in accordance with AS 4349.1–2007, comprises a visual assessment of the Property to identify major defects and to form an opinion regarding the general condition of the Property at the time of the Inspection, together with a visual appraisal and limited assessment of serviceability. It is not a condition survey with list of maintenance items nor an inventory of items that needs attention."]},
  {"kind": "clause", "n": "2.12", "paras": ["As required by AS 4349.0–2007 (clause 2.1), the parties record the following inspection agreement details:"]},
  {"kind": "item", "n": "(a)", "text": "Purpose: to provide the Client, as a prospective purchaser or other interested party, with an opinion regarding the condition of the Property at the time of the Inspection."},
  {"kind": "item", "n": "(b)", "text": "Scope: the scope set out in the Quotation and in this clause 4."},
  {"kind": "item", "n": "(c)", "text": "Acceptance criteria: the building is compared with a building that was constructed in accordance with the generally accepted practice at the time of construction and which has been maintained such that there has been no significant loss of strength and serviceability."},
  {"kind": "clause", "n": "2.13", "paras": ["A Report prepared with reference to AS 4349 is not a certificate of compliance of the Property with any Act, regulation, ordinance, local law or by-law, and is not a warranty or an insurance policy against problems developing with the building in the future. The Inspection assumes that the existing use of the building will continue, and does not include the identification of unauthorised building work or of work that does not comply with building regulations."]},
  {"kind": "subheading", "text": "Pre-Purchase Inspection"},
  {"kind": "clause", "n": "2.14", "paras": ["The Inspection should be arranged as early in the buying process as practicable. Houspect gives no advice on whether the Client should purchase the Property, or on its value, and the Client remains responsible for its own purchase decision, contract conditions and finance."]},
  {"kind": "subheading", "text": "Access and Site Conditions"},
  {"kind": "clause", "n": "2.15", "paras": ["Houspect will coordinate the Inspection appointment and access with the Client and, where applicable, the owner, occupier or selling agent. So far as the Client is able, the Client should help to ensure that, on the Inspection Date:"]},
  {"kind": "item", "n": "(a)", "text": "the Inspector has safe and unobstructed access to every area within the Scope, including keys, codes and passes for locked rooms, gates, sheds, roof space hatches and sub-floor access covers;"},
  {"kind": "item", "n": "(b)", "text": "electricity and water are connected and operating, where reasonably needed for the Inspection;"},
  {"kind": "item", "n": "(c)", "text": "animals are restrained or removed from the areas to be inspected;"},
  {"kind": "item", "n": "(d)", "text": "the areas to be inspected are clear of stored items, furniture and floor coverings so that building elements can be seen."},
  {"kind": "clause", "n": "2.16", "paras": ["The Inspector determines whether access is safe and reasonable, having regard to AS 4349 (including, where applicable, Table 3.2 of AS 4349.1–2007, Dimensions for reasonable access). Reasonable access does not include moving furniture, stored goods or floor coverings, removing screws, bolts, fastenings or sealants from access covers, or cutting access holes."]},
  {"kind": "clause", "n": "2.17", "paras": ["The Inspector may decline, suspend or end the Inspection, or any part of it, at any time if the Inspector considers conditions at the Site to be unsafe. This includes unsafe structures or electrical installations, suspected hazardous materials, aggressive animals, threatening behaviour, and severe weather. Areas that are not inspected for these reasons are excluded from the Inspection and the Report, and the Price remains payable."]},
  {"kind": "clause", "n": "2.18", "paras": ["Weather, light, occupants, furnishings and stored items may limit what the Inspector is able to see. For example, a roof exterior will not be accessed when it is wet or the wind is unsafe. Houspect may reschedule an Inspection that cannot be carried out properly because of conditions at the Site."]},
  {"kind": "clause", "n": "2.19", "paras": ["If the Inspection cannot be completed because the access or arrangements in this clause are not provided, any further attendance requested by the Client is chargeable at a reasonable additional fee notified by Houspect."]},
  {"kind": "subheading", "text": "Inspection Limits and Exclusions"},
  {"kind": "clause", "n": "2.20", "paras": ["The Report is not an all-encompassing report dealing with a building from every aspect. It is a reasonable attempt to identify significant defects visible at the time of the Inspection. Whether a defect is significant depends to a large degree on the age of the building, and the Inspector may not comment on every minor defect or imperfection."]},
  {"kind": "clause", "n": "2.21", "paras": ["The Inspection is a visual inspection, limited to the areas of the Property that are accessible and visible to the Inspector on the Inspection Date. Unless otherwise agreed, the Inspector does not break apart, dismantle, remove or move objects such as foliage, insulation, floor or wall coverings, linings, furnishings, appliances or personal possessions, and is not able to see inside walls, between floors, inside roofing, behind stored goods or in other concealed or obstructed areas. The Inspector does not dig, gouge, force or carry out other invasive procedures, and will not destructively probe visible timbers without the written permission of the property owner."]},
  {"kind": "clause", "n": "2.22", "paras": ["Unless the Quotation states otherwise, the Inspector is not required to inspect or report on the following, although the Inspector may comment on them where they are readily apparent:"]},
  {"kind": "item", "n": "(a)", "text": "footings below ground;"},
  {"kind": "item", "n": "(b)", "text": "concealed damp-proof course;"},
  {"kind": "item", "n": "(c)", "text": "electrical installations, including smoke detectors, light switches and fittings, TV, sound, communications and security systems;"},
  {"kind": "item", "n": "(d)", "text": "concealed plumbing;"},
  {"kind": "item", "n": "(e)", "text": "the adequacy of roof drainage as installed;"},
  {"kind": "item", "n": "(f)", "text": "gas fittings and fixtures;"},
  {"kind": "item", "n": "(g)", "text": "air-conditioning;"},
  {"kind": "item", "n": "(h)", "text": "automatic garage door mechanisms;"},
  {"kind": "item", "n": "(i)", "text": "swimming pools and associated filtration and similar equipment (a swimming pool should be the subject of a special purpose report by a suitably qualified person);"},
  {"kind": "item", "n": "(j)", "text": "the operation of fireplaces and solid fuel heaters, including chimneys and flues;"},
  {"kind": "item", "n": "(k)", "text": "alarm systems;"},
  {"kind": "item", "n": "(l)", "text": "electrical appliances, such as dishwashers, incinerators, ovens and ducted vacuum systems;"},
  {"kind": "item", "n": "(m)", "text": "paint coatings, except external protective coatings;"},
  {"kind": "item", "n": "(n)", "text": "health hazards (for example, allergies, lead content, asbestos and soil toxicity);"},
  {"kind": "item", "n": "(o)", "text": "timber and metal framing sizes and adequacy;"},
  {"kind": "item", "n": "(p)", "text": "concealed tie-downs and bracing;"},
  {"kind": "item", "n": "(q)", "text": "timber pest activity;"},
  {"kind": "item", "n": "(r)", "text": "soil conditions;"},
  {"kind": "item", "n": "(s)", "text": "control joints;"},
  {"kind": "item", "n": "(t)", "text": "concealed framing timber or any areas concealed by wall linings or sidings; and"},
  {"kind": "item", "n": "(u)", "text": "furniture and accessories."},
  {"kind": "clause", "n": "2.23", "paras": ["Where large structural retaining walls are present, the Client may wish to engage a structural engineer for a special purpose report. The Inspector may, but is not required to, comment on whether an engineer is needed."]},
  {"kind": "clause", "n": "2.24", "paras": ["Houspect does not give advice about asbestos, including whether building materials contain asbestos. If the Inspector suspects that a material may contain asbestos, Houspect may mention it, without obligation, so that the Client can have the matter confirmed by a suitably qualified person. The Client should not treat any such comment as determinative."]},
];

/** "3 DEFECTS": Major / Structural / Minor defect. */
export const PPI_DEFECTS_BLOCKS: ScopeBlock[] = [
  {"kind": "section", "n": "3", "title": "DEFECTS"},
  {"kind": "para", "text": "The presence or otherwise of defects shall only be relevant when such defects relate to the structural condition of the building."},
  {"kind": "clause", "n": "3.1", "paras": ["During an inspection the inspector shall be alert to the possibility that a building element is defective but that the defect does not fit neatly into one of the categories of defect. In such a case, the inspector may use a combination of defect properties, or otherwise assess and describe the defect in his/her own words, based on his/her experience.", "In many cases, the actual structural elements of a building will be obscured by finishes and other non-structural building elements, and the inspector may be unable to assess directly the state of the structural member. In such cases, the inspector has to infer the performance of the structure by observing the effect of the structure on the non-structural building elements. For example, the inspector normally will be unable to inspect the footings of a house as they are buried beneath the ground; however, cracking in non-structural masonry walls above the ground may indicate that a defect exists within the footing system."]},
  {"kind": "clause", "n": "3.2", "term": "Major defect", "paras": ["A defect of sufficient magnitude where rectification has to be carried out in order to avoid unsafe conditions, loss of utility or further deterioration of the property."]},
  {"kind": "clause", "n": "3.3", "term": "Structural defect", "paras": ["Fault or deviation from the intended structural performance of a load bearing element defect that requires immediate intervention to avert further deterioration."]},
  {"kind": "clause", "n": "3.4", "term": "Minor defect", "paras": ["A defect other than a major defect that requires immediate intervention to avert further deterioration.", "The report shall describe the overall extent of minor defects. The inspector is not required to comment on individual minor defects and imperfections.", "Minor defects are common to most properties and may include minor blemishes, corrosion, cracking, weathering, general deterioration, unevenness, and physical damage to materials and finishes, such as de-silvering of mirrors. It is expected that defects of this type would be rectified as part of normal ongoing property maintenance."]},
];

/** "Condition Definitions": clause 3.5 and the five gradings. */
export const PPI_CONDITION_DEFINITIONS_TITLE = "Condition Definitions";
export const PPI_CONDITION_DEFINITIONS_BLOCKS: ScopeBlock[] = [
  {"kind": "clause", "n": "3.5", "paras": ["Houspect utilises the following terms to categorise our gradings of materials conditions;"]},
  {"kind": "bullet", "text": "New: Self-explanatory/newly built or constructed with none to minimal use."},
  {"kind": "bullet", "text": "Satisfactory: Generally good condition."},
  {"kind": "bullet", "text": "Fair: Starting to look like it needs maintenance."},
  {"kind": "bullet", "text": "Average: Working but needs maintenance within 6 months."},
  {"kind": "bullet", "text": "Poor: Needs replacement."},
];

/** "Site Access Conditions": the template's sentences, in its order. Only those a field decides are printed (siteAccess.ts). */
export const PPI_SITE_ACCESS_TITLE = "Site Access Conditions";
export const SITE_ACCESS = {
  roofNotAccessed: "The inspector was not able to get access to the roof to inspect the roof covering.",
  lowerRoofFromLadder: "The inspector observed the lower roof from a ladder.",
  upperRoofTooHigh: "The upper roof was not inspected from on the roof because the roof height exceeded the safe height limits of 3.6m.",
  roofCavityObstructed: "The roof cavity was only partially inspected/not inspected due to obstructions.",
  subfloorNotInspected: "The subfloor was not inspected.",
  subfloorSlab: "The subfloor space was not inspected due to slab on ground conditions.",
  roofCavityRaked: "The roof cavity was not accessed because the roof design is lined on rake with no roof cavity.",
} as const;
