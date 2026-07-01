import React from 'react';
import { Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BarChart3, Coins, Settings as SettingsIcon, Trophy } from 'lucide-react-native';
import { CashScreen } from '../screens/CashScreen';
import { TournamentScreen } from '../screens/TournamentScreen';
import { ResultsScreen } from '../screens/ResultsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
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

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ navigation }) => ({
        ...headerStyle,
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
        options={{ title: 'キャッシュ', tabBarIcon: ({ color, size }) => <Coins size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Tournament"
        component={TournamentScreen}
        options={{ title: 'トーナメント', tabBarIcon: ({ color, size }) => <Trophy size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Results"
        component={ResultsScreen}
        options={{ title: '成績', tabBarIcon: ({ color, size }) => <BarChart3 size={size} color={color} /> }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ headerShown: false, presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
