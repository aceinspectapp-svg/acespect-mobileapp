import { NO_WORDING, type ReportWording } from "./types";
import { profileKey, type ReportProfile } from "./profile";
import { dilapidationResidentialHouse } from "./dilapidation.residential_house";
import { constructionStageApartment } from "./construction_stage.apartment";
import { constructionStageResidentialHouse } from "./construction_stage.residential_house";
import { dilapidationApartment } from "./dilapidation.apartment";
import { dilapidationCommercialProperties } from "./dilapidation.commercial_properties";
import { dilapidationPublicAssets } from "./dilapidation.public_assets";
import { investigationsApartment } from "./investigations.apartment";
import { investigationsCommercialProperties } from "./investigations.commercial_properties";
import { investigationsResidentialHouse } from "./investigations.residential_house";
import { prePurchaseApartment } from "./pre_purchase.apartment";
import { prePurchaseCommercialProperties } from "./pre_purchase.commercial_properties";
import { prePurchaseResidentialHouse } from "./pre_purchase.residential_house";

/**
 * Every report type and its wording -- one entry each, one file each. A report type's sentences
 * come from its own entry only: the generator resolves the report type first (reportProfileOf),
 * then looks the wording up here, and only then picks the section.
 */
export const WORDING_BY_PROFILE: Record<string, ReportWording> = {
  "dilapidation/residential_house": dilapidationResidentialHouse,
  "construction_stage/apartment": constructionStageApartment,
  "construction_stage/residential_house": constructionStageResidentialHouse,
  "dilapidation/apartment": dilapidationApartment,
  "dilapidation/commercial_properties": dilapidationCommercialProperties,
  "dilapidation/public_assets": dilapidationPublicAssets,
  "investigations/apartment": investigationsApartment,
  "investigations/commercial_properties": investigationsCommercialProperties,
  "investigations/residential_house": investigationsResidentialHouse,
  "pre_purchase/apartment": prePurchaseApartment,
  "pre_purchase/commercial_properties": prePurchaseCommercialProperties,
  "pre_purchase/residential_house": prePurchaseResidentialHouse,
};

/** The wording for a report type; NO_WORDING (plain "Label: value." lines) for a type not registered here. */
export function wordingFor(profile: ReportProfile): ReportWording {
  return WORDING_BY_PROFILE[profileKey(profile)] ?? NO_WORDING;
}
