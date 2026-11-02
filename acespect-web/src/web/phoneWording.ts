/**
 * The phone saves each section's report text as a plain list of "Question?: answer" pairs, with the answers as stored option names
 * ("separate_to_house"). Sentences composed on the website contain neither, so this tells the two apart: a section whose text still
 * looks like the phone's has not been composed (or hand-edited) yet.
 */
const PHONE_WORDING = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\?: /;

export function looksLikePhoneWording(reportText: string | null | undefined): boolean {
  return PHONE_WORDING.test(reportText ?? "");
}
