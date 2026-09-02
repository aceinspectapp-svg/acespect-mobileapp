import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppStackParamList } from './types';
import { SelectInspectionTypeScreen } from '../screens/inspection/SelectInspectionTypeScreen';
import { JobInformationScreen } from '../screens/inspection/JobInformationScreen';
import { InspectionSetupStep2Screen } from '../screens/inspection/InspectionSetupStep2Screen';
import { InspectionSectionsScreen } from '../screens/inspection/InspectionSectionsScreen';
import { DynamicSectionScreen } from '../screens/inspection/DynamicSectionScreen';
import { ReportSummaryScreen } from '../screens/inspection/ReportSummaryScreen';
import { AddCustomSectionScreen } from '../screens/inspection/AddCustomSectionScreen';
import { AssignedJobsScreen } from '../screens/inspection/AssignedJobsScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SelectInspectionType" component={SelectInspectionTypeScreen} />
      <Stack.Screen name="AssignedJobs" component={AssignedJobsScreen} />
      <Stack.Screen name="JobInformation" component={JobInformationScreen} />
      <Stack.Screen name="InspectionSetupStep2" component={InspectionSetupStep2Screen} />
      <Stack.Screen name="InspectionSections" component={InspectionSectionsScreen} />
      <Stack.Screen name="DrivewaySection">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="driveway"
            sectionName="Driveway"
            icon="🚗"
            order={3}
            onBack={() => navigation.goBack()}
            // Report completion back to the hub so progress updates.
            onComplete={() =>
              navigation.navigate({
                name: 'InspectionSections',
                params: { completedId: 'driveway' },
                merge: true,
              })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="PavingPaths">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="paving_paths"
            sectionName="Paving & Paths"
            icon="🚶"
            order={4}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({
                name: 'InspectionSections',
                params: { completedId: 'paving_paths' },
                merge: true,
              })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Fences">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="fences"
            sectionName="Fences"
            icon="🪵"
            order={5}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'fences' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="RetainingWalls">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="retaining_walls"
            sectionName="Retaining Walls"
            icon="🧱"
            order={6}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'retaining_walls' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="GarageCarport">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="garage_carport_sheds"
            sectionName="Garage / Carport / Sheds"
            icon="🏚️"
            order={7}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'garage_carport_sheds' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Elevations">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="elevations"
            sectionName="Elevations"
            icon="🏠"
            order={9}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'elevations' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="RoofChimneys">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="roof_chimneys"
            sectionName="Roof Covering & Chimneys"
            icon="🏘️"
            order={10}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'roof_chimneys' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="PoolSpa">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="pool_spa"
            sectionName="Pool / Spa"
            icon="🏊"
            order={8}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'pool_spa' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="InternalAreas">
        {({ navigation }) => (
          <DynamicSectionScreen
            sectionKey="internal_areas"
            sectionName="Internal Areas"
            icon="🛋️"
            order={11}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'internal_areas' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="NotesPostProject">
        {({ navigation }) => (
          <DynamicSectionScreen
            // Backend/template sectionKey is "notes"; the hub's completedId
            // (below) is the older "notes_defects" -- the two must not be
            // conflated, see constants/inspectionSections.ts.
            sectionKey="notes"
            sectionName="Notes / Post Project / Defects"
            icon="📝"
            order={12}
            onBack={() => navigation.goBack()}
            onComplete={() =>
              navigation.navigate({ name: 'InspectionSections', params: { completedId: 'notes_defects' }, merge: true })
            }
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="AddCustomSection" component={AddCustomSectionScreen} />
      <Stack.Screen name="CustomSection">
        {({ navigation, route }) => (
          <DynamicSectionScreen
            sectionKey={route.params.sectionKey}
            sectionName={route.params.sectionName}
            templateKey="custom_structure"
            icon="🏚️"
            // Custom sections aren't part of the fixed 13, so their `order`
            // doesn't need to slot in anywhere meaningful -- 100+ keeps them
            // out of the way of the real ones if this is ever surfaced.
            order={100}
            onBack={() => navigation.goBack()}
            // AddCustomSection replaced itself with this screen, so the hub
            // sits directly below in the stack -- same as `onBack`.
            onComplete={() => navigation.goBack()}
            onGoHome={() => navigation.popToTop()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="ReportSummary" component={ReportSummaryScreen} />
    </Stack.Navigator>
  );
}
