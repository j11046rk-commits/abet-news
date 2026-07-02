import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BarChart3, Coins, Settings as SettingsIcon, Trophy } from 'lucide-react-native';
import { CashScreen } from '../screens/CashScreen';
import { TournamentScreen } from '../screens/TournamentScreen';
import { ResultsScreen } from '../screens/ResultsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { AdBanner } from '../ads/BannerAd';
import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';

export type RootStackParamList = {
  Tabs: undefined;
  Settings: undefined;
  Paywall: undefined;
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

const headerStyle = {
  headerStyle: { backgroundColor: colors.feltDark },
  headerTintColor: colors.bone,
  headerTitleStyle: { fontFamily: fonts.serif as string, color: colors.bone },
  headerShadowVisible: false,
} as const;

/** タブ名の背景に敷く生成バナー（＋可読性スクリム）。 */
const bannerHeader = (src: number) => () => (
  <ImageBackground source={src} style={StyleSheet.absoluteFill} resizeMode="cover">
    <View style={styles.headerScrim} />
  </ImageBackground>
);

/** 全タブ共通のブランドロックアップ（名称＋タグライン）をヘッダー中央に固定表示。 */
function BrandTitle() {
  return (
    <View style={styles.brand} pointerEvents="none">
      <Text style={styles.brandName}>正直ポーカー</Text>
      <Text style={styles.brandTagline}>勝てば実力、負けたら運を、もう許さない。</Text>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      // 広告バナーを「タブバーの真上」に固定配置（Pro/オフ時は AdBanner 側で非表示）。
      tabBar={(props) => (
        <View>
          <AdBanner />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={({ navigation }) => ({
        ...headerStyle,
        headerStyle: { backgroundColor: colors.feltDark, height: 110 },
        headerTitleAlign: 'center',
        headerTitle: () => <BrandTitle />,
        tabBarStyle: { backgroundColor: colors.feltDark, borderTopColor: 'rgba(244,239,228,0.1)' },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.sans as string, fontSize: 11 },
        headerRight: () => (
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={12} style={{ paddingRight: 16 }}>
            <SettingsIcon size={22} color={colors.bone} />
          </Pressable>
        ),
      })}
    >
      <Tab.Screen
        name="Cash"
        component={CashScreen}
        options={{
          title: 'キャッシュ',
          headerBackground: bannerHeader(require('../assets/banner-cash.png')),
          tabBarIcon: ({ color, size }) => <Coins size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Tournament"
        component={TournamentScreen}
        options={{
          title: 'トーナメント',
          headerBackground: bannerHeader(require('../assets/banner-tournament.png')),
          tabBarIcon: ({ color, size }) => <Trophy size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Results"
        component={ResultsScreen}
        options={{
          title: '成績',
          headerBackground: bannerHeader(require('../assets/banner-results.png')),
          tabBarIcon: ({ color, size }) => <BarChart3 size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerScrim: { flex: 1, backgroundColor: 'rgba(10,46,36,0.45)' },
  brand: { alignItems: 'center' },
  brandName: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.bone },
  brandTagline: { fontFamily: fonts.serif, fontSize: 9, fontStyle: 'italic', color: colors.gold, marginTop: 1 },
});

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ headerShown: false, presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
