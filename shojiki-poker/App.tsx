import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { DataProvider } from './src/context/DataContext';
import { ProProvider } from './src/context/ProContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { store } from './src/storage/store';
import { colors } from './src/theme/colors';

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.feltDark, card: colors.feltDark, primary: colors.gold },
};

// 起動画面（スプラッシュ）を自動で消さず、準備完了後に少し見せてからフェードアウトする。
SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  SplashScreen.setOptions({ duration: 600, fade: true }); // 0.6秒かけてフェードアウト
} catch {
  /* 古い環境では未対応。無視して即時hideにフォールバック */
}

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    store.getOnboarded().then(setOnboarded);
  }, []);

  // データ準備ができたら、起動画面をあと約1.2秒見せてからフェードで消す。
  useEffect(() => {
    if (onboarded === null) return;
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 1800);
    return () => clearTimeout(t);
  }, [onboarded]);

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
