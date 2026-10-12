/**
 * The Scope and Conditions pages that close every Construction Report, word for word from the Houspect Lock-up Report
 * design sample. (The Dilapidation report has its own Scope and Conditions; these are the construction ones.)
 */

export type ScopeBlock =
  | { type: "section"; n: number; title: string }
  | { type: "p"; text: string }
  | { type: "clause"; num: string; lead?: string; text: string }
  | { type: "list"; items: { k: string; lead?: string; text: string }[] }
  | { type: "note"; text: string }
  | { type: "bullets"; items: string[] };

export const SCOPE: ScopeBlock[] = [
  { type: "section", n: 1, title: "PURPOSE OF INSPECTION" },
  { type: "p", text: "The purpose of the inspection is to provide advice regarding the construction of the property." },
  { type: "clause", num: "1.1", text: "The report should not be seen as an all-encompassing report dealing with a building from every aspect. Rather it should be seen as a reasonable attempt to identify any significant defects visible at the time of the inspection. Whether or not a defect is significant depends to a large degree on the age of the building. It is unrealistic to comment on minor defects or imperfections in a standard report." },
  { type: "clause", num: "1.2", text: "THIS IS A VISUAL INSPECTION ONLY limited to those areas and sections of the property fully accessible and visible to the inspector on the date of the inspection. The inspection DOES NOT include breaking apart, dismantling, removing or moving objects including but not limited to foliage, moulding, roof insulation/sisalation, floor or wall coverings, sidings, ceilings, floors, furnishings, appliances or personal possessions. The inspector CANNOT see inside walls, between floors, inside skillion roofing, behind assorted goods in cupboards, other areas that are concealed or obstructed. The inspector CANNOT dig, gouge, force or perform any other invasive procedures. Visible timbers CANNOT be destructively probed or hit without written permission of the property owner." },

  { type: "section", n: 2, title: "SCOPE OF INSPECTION" },
  { type: "p", text: "The inspection shall comprise visual assessment of accessible areas of the property to identify major defects to the building structure and to form an opinion regarding the general condition of the structure of the property." },
  { type: "note", text: "NOTE: The report may not contain any assessment or an opinion regarding the following:" },
  {
    type: "list",
    items: [
      { k: "a)", text: "Any non-structural element, eg. general gas, water and sanitary plumbing, electrical wiring, partition walls, cabinetry, windows, doors, trims, fencing minor structures, non-structural damp issues, ceiling linings, floor coverings, decorative finishes such as plastering, painting, tiling etc." },
      { k: "b)", text: "An assessment of any aspect or component of the property that cannot be seen or that requires testing and/or measurement to determine soundness." },
      { k: "c)", text: "Any area or item that was not, or could not be, observed by the inspector." },
      { k: "d)", lead: "General.", text: "maintenance other than that which is deemed to be directly related to the ongoing structural performance of the property." },
      { k: "e)", text: "Serviceability damp defects such as condensation, rising damp, lateral damp, falling damp should only be assessed and reported on where structural damage has occurred, is occurring, or may occur (eg. fungal rot) significant spalling of masonry or concrete structural elements, significant fretting or mortar, rusting of primary structural elements. Stormwater drainage and surface water defects commonly cause or exacerbate foundation instability and these issues should be assessed and reported where relevant." },
    ],
  },

  { type: "section", n: 3, title: "DEFECTS" },
  { type: "p", text: "The presence or otherwise of defects shall only be relevant when such defects relate to the structural condition of the building." },
  { type: "clause", num: "3.1", text: "During an inspection the inspector shall be alert to the possibility that a building element is defective but that the defect does not fit neatly into one of the categories of defect. In such a case, the inspector may use a combination of defect properties, or otherwise assess and describe the defect in his/her own words, based on his/her experience." },
  { type: "p", text: "In many cases, the actual structural elements of a building will be obscured by finishes and other non-structural building elements, and the inspector may be unable to assess directly the state of the structural member. In such cases, the inspector has to infer the performance of the structure by observing the effect of the structure on the non- structural building elements. For example, the inspector normally will be unable to inspect the footings of a house as they are buried beneath the ground; however, cracking in non-structural masonry walls above the ground may indicate that a defect exists within the footing system." },
  { type: "clause", num: "3.2", lead: "Major defect.", text: "A defect of sufficient magnitude where rectification has to be carried out in order to avoid unsafe conditions, loss of utility or further deterioration of the property." },
  { type: "clause", num: "3.3", lead: "Structural defect.", text: "Fault or deviation from the intended structural performance of a load bearing element defect that requires immediate intervention to avert further deterioration." },
  { type: "clause", num: "3.4", lead: "Minor defect.", text: "A defect other than a major defect that requires immediate intervention to avert further deterioration." },
  { type: "p", text: "The report shall describe the overall extent of minor defects. The inspector is not required to comment on individual minor defects and imperfections." },
  { type: "p", text: "Minor defects are common to most properties and may include minor blemishes, corrosion, cracking, weathering, general deterioration, unevenness, and physical damage to materials and finishes, such as de-silvering of mirrors. It is expected that defects of this type would be rectified as part of normal ongoing property maintenance." },

  { type: "section", n: 4, title: "LIMITATIONS OF STANDARD" },
  { type: "p", text: "A report prepared in accordance with this Standard is not a certificate of compliance of the property within the requirements of any Act, regulation, ordinance, local law or by-law, and is not a warranty against problems developing with the building in the future." },
  { type: "p", text: "This Standard does not include the identification of unauthorised building work or of work not compliant with building regulations." },
  { type: "p", text: "This Standard assumes that the existing use of the building will continue." },

  { type: "section", n: 5, title: "EXTENT OF REPORTING" },
  { type: "p", text: "Significant items to be reported are as follows:" },
  {
    type: "list",
    items: [
      { k: "a)", text: "Major defects." },
      { k: "b)", text: "Any major defect that is an urgent and serious safety hazard. NOTE: For example, unsafe balustrades or imminent collapse of a structural member." },
      { k: "c)", text: "A general impression regarding the extent of minor defect. NOTE: For example, significantly deteriorating exterior paint." },
    ],
  },

  { type: "section", n: 6, title: "ACCEPTANCE CRITERIA" },
  { type: "p", text: "The building shall be compared with a building that was constructed in accordance with the generally accepted practice at the time of construction and which has been maintained as such that there has been no significant loss of strength and serviceability." },

  { type: "section", n: 7, title: "AREAS TO BE INSPECTED" },
  { type: "clause", num: "7.1", lead: "General.", text: "The inspector shall inspect accessible parts of the build and appurtenances, together with relevant feature of the property within 30 metres of the building and within the boundaries of the site, or as otherwise agreed in the inspection agreement. In this context, relevant features include car accommodation, detached laundry, ablution facilities and garden sheds, retaining walls more than 700 millimetres high, paths and driveways, steps, fencing." },
  { type: "p", text: "Inspection of Strata and Company Title residential property shall be limited to the nominated residence and may not include common property." },
  { type: "clause", num: "7.2", text: "The following areas shall be inspected where applicable or accessible:" },
  {
    type: "list",
    items: [
      { k: "a)", text: "The interior of the building." },
      { k: "b)", text: "The roof space." },
      { k: "c)", text: "The exterior of the building." },
      { k: "d)", text: "The sub-floor space." },
      { k: "e)", text: "The roof exterior." },
      { k: "f)", text: "The property within 30 metres of the building subject to inspection." },
    ],
  },
  { type: "clause", num: "7.3", lead: "Safe and reasonable access.", text: "The extent of accessible areas shall be determined by the inspector at the time of inspection, based on the conditions encountered at the time of inspection. The inspector shall also determine whether sufficient space is available to allow safe access." },
  { type: "p", text: "The inspection shall include only accessible areas and areas that are within the inspector’s line of sight and close enough to enable reasonable appraisal." },
  { type: "p", text: "The inspector shall inspect an elevated area only where:" },
  {
    type: "list",
    items: [
      { k: "a)", text: "it is at a height at which safe reasonable access is available, or where safe and reasonable access is otherwise available; or" },
      { k: "b)", text: "an unobstructed line of sight is present from safe use of a 3.6 metre ladder and the building elements present are close enough to allow appraisal." },
    ],
  },
  { type: "note", text: "NOTE: ‘Elevated area’ includes the roof, roof space, crawl space, landing feature, and the like, generally elevated above the ground and intended for normal use by occupants." },
  { type: "clause", num: "7.5", text: "A 3.6 metre ladder is considered generally reasonable for safe use by one operator during an inspection. Regardless of the ladder length, weight and size, safe use of ladder or safe access may mean that inspection of a roof, elevated platform or roof space is not possible in part, or at all, during an inspection and, in such circumstances, and inspector may recommend the use of special access equipment and that a further inspection be undertaken when a safe method of access is present." },
  { type: "clause", num: "7.6", lead: "Areas for Inspection.", text: "The inspection shall cover all accessible areas." },
  { type: "p", text: "The client shall arrange right of entry, facilitate physical entry to the property and supply necessary information to enable the inspector to undertake the inspection and prepare a report. The inspector is not responsible for arranging entry to property or parts of property." },
  { type: "p", text: "Areas where reasonable entry is denied to the inspector, or where reasonable access is not available, are excluded from, and do not form part of, the inspection." },
  { type: "clause", num: "7.7", lead: "Inspection process.", text: "The inspection shall comprise visual appraisal and limited assessment of serviceability." },
  { type: "clause", num: "7.8", text: "Where large structural retaining walls are in service to a property a special purpose building report will be required by a structural engineer. The inspector may or may not comment in this report as to whether an engineer is required or not." },

  { type: "section", n: 8, title: "EXCLUSION OF ITEMS FROM INSPECTION" },
  { type: "p", text: "The inspector need not inspect, nor report on the following:" },
  {
    type: "list",
    items: [
      { k: "a)", text: "Footings below ground." },
      { k: "b)", text: "Concealed damp-proof course." },
      { k: "c)", text: "Electrical installations, operation of smoke detectors, light switches and fittings, TV, sound and communications and security systems." },
      { k: "d)", text: "Concealed plumbing." },
      { k: "e)", text: "Adequacy of roof drainage as installed." },
      { k: "f)", text: "Gas fittings and fixtures." },
      { k: "g)", text: "Air-conditioning." },
      { k: "h)", text: "Automatic garage door mechanisms." },
      { k: "i)", text: "Swimming pools and associated filtration and similar equipment. NOTE: If a swimming pool is present it should be the subject of a Special Purpose Property Report. A detailed inspection on the status or serviceability of any swimming pool or associated pool equipment has not been carried out and is not within the scope of this report. Additionally, to adequately inspect a swimming pool, the water must be completely drained and all internal surfaces must be fully accessible." },
      { k: "j)", text: "The operation of fireplaces and solid fuel heaters, including chimneys and flues." },
      { k: "k)", text: "Alarm systems." },
      { k: "l)", text: "Electrical appliances including dishwashers, incinerators, ovens, ducted vacuum systems." },
      { k: "m)", text: "Paint coatings, except external protective coatings." },
      { k: "n)", text: "Health hazards (eg. allergies, lead content, presence of asbestos, soil toxicity)" },
      { k: "o)", text: "Timber and metal framing sizes and adequacy." },
      { k: "p)", text: "Concealed tie-downs and bracing." },
      { k: "q)", text: "Timber pest activity." },
      { k: "r)", text: "Soil conditions." },
      { k: "s)", text: "Control joints." },
      { k: "t)", text: "Concealed framing-timber or any areas concealed by wall linings/sidings." },
      { k: "u)", text: "Furniture and accessories." },
    ],
  },
  { type: "p", text: "Estimating the cost of remedying defects is not included in a standard Property report, although it may form part of a special-purpose Property report." },
  { type: "p", text: "Houspect has tried to categorise our gradings as:" },
  {
    type: "bullets",
    items: [
      "New: Self-explanatory.",
      "Satisfactory: Generally good condition.",
      "Fair: Starting to look like it needs maintenance.",
      "Average: Working but needs maintenance within 6 months.",
      "Poor: Needs replacement.",
    ],
  },
  { type: "p", text: "As appropriate to any particular property or material other terms may be used for gradings and to describe condition such as aged, dilapidated, deteriorated, weathered, rusting, delaminated, rotted, decayed, subsided, etc." },
  { type: "p", text: "Wherever we describe a building material in this report, the client acknowledges that the material described represents a substantial component of the building material observed." },
];

export interface ConditionItem { text: string; sub?: { k: string; text: string }[] }

export const CONDITIONS: ConditionItem[] = [
  { text: "The Report is expressly produced for the sole use of the Client and in accordance with AS4349. Legal liability is limited to the Client." },
  { text: "No advice is given regarding the presence, or effect, of termites on the Property. A specialist company should be approached to provide such certification if required." },
  { text: "Any dimensions given are approximate only." },
  { text: "Any cost estimates are approximate only. Should the Client wish to define a price more accurately, trade quotations can be arranged." },
  { text: "The Client acknowledges, and agrees that any comments contained in the Report relating to matters of an electrical, or plumbing nature, are based on a visual inspection only carried out by the Inspector on the day of the inspection, and should not in any way be relied upon by the Client as a substitute for obtaining expert professional advice from a licensed electrician, or plumber." },
  { text: "Any charge-out rates quoted relates to normal work and are not applicable for work relating to arbitration, mediation, conciliation, expert witness, court appearance or any other legal application." },
  { text: "The Report comments on only those features which were reasonably visible, and reasonably accessible, at the time of the inspection without recourse to viewing platforms, the removal, or moving, of building components, or any other materials of any kind, or any other unusual methodology including measuring or testing of building components to confirm structural soundness or major defects." },
  { text: "We have not inspected woodwork or other parts of the structure which are covered, unexposed or inaccessible and are therefore unable to report that any such part of the structure is free from defect." },
  { text: "Inspections and or surveys shall be made only by a qualified Building Consultant with No less than 5 years’ experience." },
  { text: "Only those items in the Report, which have been commented upon, have been inspected. If there is no comment against an item it has not been inspected. The Inspector gives no undertaking that they will inspect all items present on the day of the inspection." },
  { text: "We will not (even if requested to do so) provide you any advice regarding asbestos at the property that we are asked to inspect, including whether or not any building materials used in the construction of a home are made from asbestos or not. However, if we identify that a building material is made from asbestos, we may without any obligation or requirement to do so, mention this to you so that you can then have this view confirmed by someone appropriately qualified to advise you about (a) whether the material is made from asbestos and (b) how to deal with it. If we provide you such advice, then you must not accept or rely upon our view as being in any way determinative and you agree that it is stated to you so that you then will engage someone appropriately qualified to advise you on the presence of asbestos and related matters, and not act on or rely upon our view in any other way." },
  { text: "All advice given by the Inspector not included in the Report is given in good faith. However no responsibility is accepted for any losses - either direct or consequential -resulting from the advice." },
  { text: "The Report is confirmation of a visual inspection of the Property carried out by the Inspector on the day of the inspection, and only covers those items which could reasonably be detected by such visual inspection at the time of such inspection." },
  { text: "All statutory or implied conditions and warranties are excluded to the extent permitted by law. The report is not intended to be a Certificate of Compliance for Building Codes." },
  { text: "To the extent permitted by law, liability under any condition or warranty which cannot legally be excluded is limited to:", sub: [{ k: "(a)", text: "supplying the Report again; or" }, { k: "(b)", text: "paying the cost of having the Report supplied again." }] },
  { text: "If the Report fails to conform in any material respect to the term and conditions set out herein then", sub: [{ k: "(a)", text: "the Inspector is not liable unless the Client notifies the Inspector of the failure within 90 days after the date of delivery of the Report; and" }, { k: "(b)", text: "the liability of the inspector is in any case limited to the cost of providing the inspection and the inspector is not liable for any consequential damage" }] },
  { text: "The provisions of clause 15 above are subject to the provision of any statutory condition or warranty which cannot legally be excluded." },
  { text: "Payment to the Inspector will be made at the time of inspection or prior to the supply of the report." },
  { text: "The Report will be sent within 48 hours of the inspection or as directed by the Client upon receipt of payment." },
  { text: "The terms and conditions contained herein:", sub: [{ k: "(a)", text: "constitute the entire agreement and understanding between the Client and the Inspector, on everything connected to the subject matter of the Agreement; and" }, { k: "(b)", text: "supersede any prior agreement or understanding or anything connected with that subject matter." }] },
  { text: "These are the standard terms and conditions under which we provide our service to you. When we provide you our service, we do so on the basis that (a) these terms and conditions make up the terms of the contract between you and us (b) and, you agree to be bound by these terms and conditions. If you do not agree to be bound by these terms and conditions then you must contact us prior to us providing you our service to advise us that (a) you do not want to make a contract with us and (b) do not want us to provide our service to you." },
];
