import React from 'react';
import { AppScreenProps } from '../../navigation/types';
import { DynamicSectionScreen } from './DynamicSectionScreen';

/** Inspection Setup · Step 2 of 2 — "Description & Overview", template-driven. */
export function InspectionSetupStep2Screen({
  navigation,
  route,
}: AppScreenProps<'InspectionSetupStep2'>) {
  return (
    <DynamicSectionScreen
      sectionKey="description"
      sectionName="Description & Overview"
      icon="🏠"
      order={2}
      onBack={() => navigation.goBack()}
      onComplete={() => navigation.navigate('InspectionSections', { data: route.params.data })}
      onGoHome={() => navigation.popToTop()}
    />
  );
}
