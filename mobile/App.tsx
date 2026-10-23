import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AddLoanScreen from './src/screens/AddLoanScreen';
import LoansScreen from './src/screens/LoansScreen';
import LoginScreen from './src/screens/LoginScreen';
import { colors, fontSize, spacing } from './src/theme';

// Type of each screen's params (none of ours take any).
export type RootStackParamList = {
  Login: undefined;
  Loans: undefined;
  AddLoan: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Decides which screens exist based on whether the user is logged in.
// Logging in/out swaps the whole set, so there is no "back" to a stale screen.
function RootNavigator() {
  const { token, loading } = useAuth();

  // Splash while we check SecureStore for a saved session.
  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.logo}>MiniLedger</Text>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.white,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {token ? (
        <>
          <Stack.Screen name="Loans" component={LoansScreen} options={{ title: 'My Loans' }} />
          <Stack.Screen name="AddLoan" component={AddLoanScreen} options={{ title: 'Add Loan' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.lg },
  logo: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.primary },
});
