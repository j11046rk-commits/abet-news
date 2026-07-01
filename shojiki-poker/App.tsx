import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { DataProvider } from './src/context/DataContext';
import { ProProvider } from './src/context/ProContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { AdBanner } from './src/ads/BannerAd';
import { store } from './src/storage/store';
import { colors } from './src/theme/colors';

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.feltDark, card: colors.feltDark, primary: colors.gold },
};

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    store.getOnboarded().then(setOnboarded);
  }, []);

  const finishOnboarding = async () => {
    await store.setOnboarded(true);
    setOnboarded(true);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ProProvider>
          <DataProvider>
            <StatusBar style="light" />
            {onboarded === null ? (
              <View style={{ flex: 1, backgroundColor: colors.feltDark }} />
            ) : onboarded ? (
              <View style={{ flex: 1, backgroundColor: colors.feltDark }}>
                <NavigationContainer theme={navTheme}>
                  <RootNavigator />
                </NavigationContainer>
                <AdBanner />
              </View>
            ) : (
              <OnboardingScreen onDone={finishOnboarding} />
            )}
          </DataProvider>
        </ProProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
