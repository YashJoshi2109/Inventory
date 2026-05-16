# Sandbox React Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Expo React Native app (iOS + Android) that connects to the sandbox backend — real email/OTP auth, per-user seeded SEAR Lab inventory, all 6 tabs (Dashboard, Quick Scan, SmartScan, Inventory, AI Copilot, Energy Hub) plus drawer (Transactions, Admin, Settings).

**Architecture:** Expo Router for file-based navigation (Stack → Tab → Drawer). TanStack Query for all API calls. Zustand for auth token + global state. NativeWind for styling (mirrors the web app's Tailwind aesthetic). Single `constants/api.ts` file with `SANDBOX_API_URL` — the only place to change the backend URL.

**Tech Stack:** Expo SDK 52 · TypeScript · Expo Router · NativeWind 4 · TanStack Query v5 · Zustand · expo-camera · expo-barcode-scanner · Victory Native XL · expo-secure-store · EAS Build

---

## File Map

```
inventory-sandbox-app/
├── app/
│   ├── _layout.tsx                     Root layout (fonts, TQ provider, auth gate)
│   ├── index.tsx                        Redirect: / → /(auth)/login or /(tabs)/
│   ├── (auth)/
│   │   ├── _layout.tsx                 Auth stack layout
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── verify-otp.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx                 Tab bar layout (6 tabs)
│   │   ├── index.tsx                   Dashboard
│   │   ├── scan.tsx                    Quick Scan
│   │   ├── smartscan.tsx               SmartScan
│   │   ├── inventory.tsx               Inventory list
│   │   ├── copilot.tsx                 AI Copilot
│   │   └── energy.tsx                  Energy Hub
│   └── (drawer)/
│       ├── _layout.tsx                 Drawer layout
│       ├── transactions.tsx
│       ├── admin.tsx
│       └── settings.tsx
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Input.tsx
│   │   └── BottomSheet.tsx
│   ├── scan/
│   │   ├── CameraScanner.tsx
│   │   ├── BarcodeOverlay.tsx
│   │   └── RFIDScanner.tsx
│   ├── inventory/
│   │   ├── ItemCard.tsx
│   │   └── StockBadge.tsx
│   ├── energy/
│   │   ├── GaugeChart.tsx
│   │   └── EnergyAreaChart.tsx
│   └── copilot/
│       ├── ChatBubble.tsx
│       └── TypingIndicator.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts                   Axios instance pointing to SANDBOX_API_URL
│   │   ├── auth.ts                     Login, register, verify-otp, refresh hooks
│   │   ├── items.ts                    Items + categories query hooks
│   │   ├── scan.ts                     Barcode lookup hook
│   │   ├── transactions.ts             Events query hooks
│   │   ├── locations.ts                Areas + locations hooks
│   │   ├── energy.ts                   Energy readings hook
│   │   ├── copilot.ts                  Chat + streaming hook
│   │   ├── sandbox.ts                  POST /sandbox/seed hook
│   │   └── admin.ts                    Users + roles hooks
│   ├── store/
│   │   ├── auth.ts                     Zustand: token, user, login/logout actions
│   │   └── scan.ts                     Zustand: last scanned item, action state
│   └── utils/
│       ├── epc.ts                      EPC/SGTIN-96 decoder
│       └── gs1.ts                      GS1 barcode parser (GTIN-14, AI prefixes)
├── constants/
│   └── api.ts                          SANDBOX_API_URL — single source of truth
├── app.config.ts
├── tailwind.config.js
└── package.json
```

---

## Task 1: Expo project scaffold + NativeWind + base config

**Files:**
- Create: All project scaffold files

- [ ] **Step 1: Initialize Expo project**

```bash
npx create-expo-app@latest inventory-sandbox-app --template blank-typescript
cd inventory-sandbox-app
```

- [ ] **Step 2: Install core dependencies**

```bash
npx expo install expo-router expo-secure-store expo-camera expo-barcode-scanner expo-font expo-status-bar
npm install @tanstack/react-query axios zustand
npm install nativewind@^4.0.0-rc.3 tailwindcss
npm install victory-native@^40 @shopify/react-native-skia react-native-reanimated react-native-gesture-handler
npm install @react-navigation/drawer react-native-safe-area-context react-native-screens
npm install --save-dev @types/react @types/react-native
```

- [ ] **Step 3: Configure Expo Router in app.config.ts**

Replace `app.config.ts` with:

```typescript
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'SEAR Lab Inventory',
  slug: 'sear-lab-inventory-sandbox',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'edu.uta.sear.inventory.sandbox',
    infoPlist: {
      NSCameraUsageDescription: 'Camera is used for barcode and QR code scanning.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0f172a',
    },
    package: 'edu.uta.sear.inventory.sandbox',
    permissions: ['CAMERA'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-camera', { cameraPermission: 'Allow SEAR Lab to use your camera for scanning.' }],
  ],
  scheme: 'sear-inventory',
};

export default config;
```

- [ ] **Step 4: Configure NativeWind**

Create `tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        surface: '#1e293b',
        card: '#0f172a',
      },
    },
  },
  plugins: [],
};
```

Create `global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Add to `babel.config.js`:

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

- [ ] **Step 5: Create constants/api.ts**

```typescript
// Single source of truth for sandbox API URL.
// Change this to your deployed sandbox Cloud Run URL before the conference.
export const SANDBOX_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://inventory-sandbox-xxxx.run.app';
```

- [ ] **Step 6: Verify build**

```bash
npx expo start --clear
```

Expected: Metro bundler starts, no compilation errors.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(rn): Expo scaffold — NativeWind, Expo Router, TanStack Query, Victory Native"
```

---

## Task 2: API client + Zustand auth store

**Files:**
- Create: `lib/api/client.ts`
- Create: `lib/store/auth.ts`

- [ ] **Step 1: Create axios client**

Create `lib/api/client.ts`:

```typescript
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { SANDBOX_API_URL } from '@/constants/api';

export const apiClient = axios.create({
  baseURL: `${SANDBOX_API_URL}/api/v1`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request
apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 → clear token (force re-login)
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('access_token');
    }
    return Promise.reject(error);
  }
);
```

- [ ] **Step 2: Create Zustand auth store**

Create `lib/store/auth.ts`:

```typescript
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  full_name: string;
  is_superuser: boolean;
  roles: string[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  setAuth: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  setAuth: async (token, user) => {
    await SecureStore.setItemAsync('access_token', token);
    await SecureStore.setItemAsync('auth_user', JSON.stringify(user));
    set({ token, user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('auth_user');
    set({ token: null, user: null });
  },

  loadFromStorage: async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      const userJson = await SecureStore.getItemAsync('auth_user');
      if (token && userJson) {
        set({ token, user: JSON.parse(userJson) });
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 3: Create auth API hooks**

Create `lib/api/auth.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import { apiClient } from './client';
import { useAuthStore } from '@/lib/store/auth';
import { AuthUser } from '@/lib/store/auth';

interface LoginPayload { email: string; password: string; }
interface RegisterPayload { email: string; username: string; password: string; full_name: string; role?: string; }
interface OTPPayload { email: string; otp: string; }
interface TokenResponse { access_token: string; token_type: string; user: AuthUser; }

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const res = await apiClient.post<TokenResponse>('/auth/login', payload);
      return res.data;
    },
    onSuccess: async (data) => {
      await setAuth(data.access_token, data.user);
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      const res = await apiClient.post('/auth/register', { ...payload, role: 'viewer' });
      return res.data;
    },
  });
}

export function useVerifyOTP() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: async (payload: OTPPayload) => {
      const res = await apiClient.post<TokenResponse>('/auth/verify-otp', payload);
      return res.data;
    },
    onSuccess: async (data) => {
      await setAuth(data.access_token, data.user);
    },
  });
}
```

- [ ] **Step 4: Create sandbox seed hook**

Create `lib/api/sandbox.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

interface SeedStatus { seeded: boolean; item_count: number; event_count: number; location_count: number; }

export function useSeedSandbox() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<SeedStatus>('/sandbox/seed');
      return res.data;
    },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/ constants/
git commit -m "feat(rn): API client, Zustand auth store, auth + seed hooks"
```

---

## Task 3: Root layout + auth gate

**Files:**
- Create: `app/_layout.tsx`
- Create: `app/index.tsx`

- [ ] **Step 1: Create root layout**

Create `app/_layout.tsx`:

```typescript
import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '@/lib/store/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

export default function RootLayout() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Create redirect index**

Create `app/index.tsx`:

```typescript
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/store/auth';
import { View, ActivityIndicator } from 'react-native';

export default function Index() {
  const { token, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View className="flex-1 bg-[#0f172a] items-center justify-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return <Redirect href={token ? '/(tabs)/' : '/(auth)/login'} />;
}
```

- [ ] **Step 3: Create auth stack layout**

Create `app/(auth)/_layout.tsx`:

```typescript
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-otp" />
    </Stack>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx app/index.tsx app/(auth)/_layout.tsx
git commit -m "feat(rn): root layout, auth gate, redirect index"
```

---

## Task 4: Auth screens — Login, Register, OTP Verify

**Files:**
- Create: `app/(auth)/login.tsx`
- Create: `app/(auth)/register.tsx`
- Create: `app/(auth)/verify-otp.tsx`

- [ ] **Step 1: Create Login screen**

Create `app/(auth)/login.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useLogin } from '@/lib/api/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();

  const handleLogin = async () => {
    try {
      await login.mutateAsync({ email: email.trim().toLowerCase(), password });
      router.replace('/(tabs)/');
    } catch {
      // error shown via login.error below
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0f172a]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-8">
        <Text className="text-white text-3xl font-bold mb-2">SEAR Lab</Text>
        <Text className="text-slate-400 text-base mb-10">Inventory Management System</Text>

        <TextInput
          className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-4 text-base border border-slate-700"
          placeholder="Email address"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-6 text-base border border-slate-700"
          placeholder="Password"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {login.error && (
          <Text className="text-red-400 text-sm mb-4 text-center">
            Invalid credentials. Try again.
          </Text>
        )}

        <TouchableOpacity
          className="bg-indigo-600 rounded-xl py-4 items-center mb-4"
          onPress={handleLogin}
          disabled={login.isPending}
        >
          {login.isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-base">Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
          <Text className="text-slate-400 text-center text-sm">
            No account? <Text className="text-indigo-400 font-semibold">Register here</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Create Register screen**

Create `app/(auth)/register.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useRegister } from '@/lib/api/auth';

export default function RegisterScreen() {
  const [form, setForm] = useState({ full_name: '', username: '', email: '', password: '' });
  const register = useRegister();

  const handleRegister = async () => {
    try {
      await register.mutateAsync(form);
      // Backend sends OTP email; navigate to verify screen
      router.push({ pathname: '/(auth)/verify-otp', params: { email: form.email } });
    } catch {
      // error shown below
    }
  };

  const field = (key: keyof typeof form, placeholder: string, opts?: object) => (
    <TextInput
      className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-4 text-base border border-slate-700"
      placeholder={placeholder}
      placeholderTextColor="#64748b"
      value={form[key]}
      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
      {...opts}
    />
  );

  return (
    <KeyboardAvoidingView className="flex-1 bg-[#0f172a]" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerClassName="flex-1 justify-center px-8 py-12">
        <Text className="text-white text-3xl font-bold mb-2">Create Account</Text>
        <Text className="text-slate-400 text-base mb-8">Join the SEAR Lab sandbox</Text>

        {field('full_name', 'Full name')}
        {field('username', 'Username', { autoCapitalize: 'none' })}
        {field('email', 'Email address', { autoCapitalize: 'none', keyboardType: 'email-address' })}
        {field('password', 'Password (min 8 chars)', { secureTextEntry: true })}

        {register.error && (
          <Text className="text-red-400 text-sm mb-4 text-center">
            Registration failed. Email or username may already be taken.
          </Text>
        )}

        <TouchableOpacity
          className="bg-indigo-600 rounded-xl py-4 items-center mb-4"
          onPress={handleRegister}
          disabled={register.isPending}
        >
          {register.isPending ? <ActivityIndicator color="white" /> : (
            <Text className="text-white font-semibold text-base">Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-slate-400 text-center text-sm">
            Already have an account? <Text className="text-indigo-400 font-semibold">Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 3: Create OTP Verify screen (with seed trigger)**

Create `app/(auth)/verify-otp.tsx`:

```typescript
import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVerifyOTP } from '@/lib/api/auth';
import { useSeedSandbox } from '@/lib/api/sandbox';
import { apiClient } from '@/lib/api/client';

export default function VerifyOTPScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [otp, setOtp] = useState('');
  const [seeding, setSeeding] = useState(false);
  const verifyOTP = useVerifyOTP();
  const seedSandbox = useSeedSandbox();

  const handleVerify = async () => {
    try {
      await verifyOTP.mutateAsync({ email, otp });
      // Token is now stored. Trigger seed.
      setSeeding(true);
      try {
        await seedSandbox.mutateAsync();
      } catch {
        // Seed failure is non-fatal — user can still use the app
      } finally {
        setSeeding(false);
      }
      router.replace('/(tabs)/');
    } catch {
      // error shown below
    }
  };

  if (seeding) {
    return (
      <View className="flex-1 bg-[#0f172a] items-center justify-center px-8">
        <ActivityIndicator size="large" color="#6366f1" />
        <Text className="text-white text-lg font-semibold mt-6">Setting up your lab...</Text>
        <Text className="text-slate-400 text-sm mt-2 text-center">
          Preparing 30 items, 8 locations, and 30 days of energy data
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#0f172a] justify-center px-8">
      <Text className="text-white text-2xl font-bold mb-2">Check your email</Text>
      <Text className="text-slate-400 text-base mb-8">
        We sent a 6-digit code to{'\n'}
        <Text className="text-indigo-400">{email}</Text>
      </Text>

      <TextInput
        className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-6 text-2xl text-center border border-slate-700 tracking-[8px]"
        placeholder="000000"
        placeholderTextColor="#64748b"
        value={otp}
        onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
      />

      {verifyOTP.error && (
        <Text className="text-red-400 text-sm mb-4 text-center">Invalid or expired code.</Text>
      )}

      <TouchableOpacity
        className="bg-indigo-600 rounded-xl py-4 items-center"
        onPress={handleVerify}
        disabled={otp.length < 6 || verifyOTP.isPending}
      >
        {verifyOTP.isPending ? <ActivityIndicator color="white" /> : (
          <Text className="text-white font-semibold text-base">Verify & Enter Lab</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 4: Verify auth flow on device**

```bash
npx expo start
```

Walk through: Launch app → redirects to Login → tap Register → fill form → submit → OTP screen shows → enter code → "Setting up your lab..." → lands on Dashboard (empty for now).

- [ ] **Step 5: Commit**

```bash
git add app/(auth)/
git commit -m "feat(rn): auth screens — login, register, OTP verify with sandbox seed trigger"
```

---

## Task 5: Tab + Drawer layout

**Files:**
- Create: `app/(tabs)/_layout.tsx`
- Create: `app/(drawer)/_layout.tsx`
- Create stub files for all tab/drawer screens

- [ ] **Step 1: Create tab layout**

Create `app/(tabs)/_layout.tsx`:

```typescript
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Quick Scan',
          tabBarIcon: ({ color, size }) => <Ionicons name="scan" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="smartscan"
        options={{
          title: 'SmartScan',
          tabBarIcon: ({ color, size }) => <Ionicons name="flash" size={size} color={color} />,
          tabBarActiveTintColor: '#f59e0b',
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="copilot"
        options={{
          title: 'AI Copilot',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="energy"
        options={{
          title: 'Energy',
          tabBarIcon: ({ color, size }) => <Ionicons name="battery-charging" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: Create drawer layout**

Create `app/(drawer)/_layout.tsx`:

```typescript
import { Drawer } from 'expo-router/drawer';
import { Ionicons } from '@expo/vector-icons';
import { View, Text } from 'react-native';
import { useAuthStore } from '@/lib/store/auth';

export default function DrawerLayout() {
  const user = useAuthStore((s) => s.user);

  return (
    <Drawer
      screenOptions={{
        drawerStyle: { backgroundColor: '#0f172a', width: 280 },
        drawerActiveTintColor: '#6366f1',
        drawerInactiveTintColor: '#94a3b8',
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
        drawerLabelStyle: { fontSize: 15, fontWeight: '600' },
      }}
      drawerContent={(props) => (
        <View className="flex-1 bg-[#0f172a] pt-16">
          <View className="px-6 mb-8">
            <View className="w-14 h-14 bg-indigo-600 rounded-full items-center justify-center mb-3">
              <Text className="text-white text-xl font-bold">{user?.full_name?.[0] ?? '?'}</Text>
            </View>
            <Text className="text-white text-lg font-bold">{user?.full_name}</Text>
            <Text className="text-slate-400 text-sm">{user?.email}</Text>
          </View>
          {/* Default drawer items rendered by expo-router */}
        </View>
      )}
    >
      <Drawer.Screen name="transactions" options={{ title: 'Transactions', drawerIcon: ({ color, size }) => <Ionicons name="swap-horizontal" size={size} color={color} /> }} />
      <Drawer.Screen name="admin" options={{ title: 'Admin Panel', drawerIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} /> }} />
      <Drawer.Screen name="settings" options={{ title: 'Settings', drawerIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} /> }} />
    </Drawer>
  );
}
```

- [ ] **Step 3: Create stub screens for tabs + drawer**

Each file is a minimal placeholder that compiles:

`app/(tabs)/index.tsx` — `app/(tabs)/scan.tsx` — `app/(tabs)/smartscan.tsx` — `app/(tabs)/inventory.tsx` — `app/(tabs)/copilot.tsx` — `app/(tabs)/energy.tsx` — `app/(drawer)/transactions.tsx` — `app/(drawer)/admin.tsx` — `app/(drawer)/settings.tsx`

Template for each stub:

```typescript
// app/(tabs)/index.tsx  ← change title per screen
import { View, Text } from 'react-native';
export default function DashboardScreen() {
  return (
    <View className="flex-1 bg-[#0f172a] items-center justify-center">
      <Text className="text-white text-xl">Dashboard</Text>
    </View>
  );
}
```

- [ ] **Step 4: Verify all tabs and drawer render**

```bash
npx expo start
```

Log in → all 6 tabs visible at bottom, tap each → stub renders. Swipe from left or tap hamburger → drawer opens with 3 items.

- [ ] **Step 5: Commit**

```bash
git add app/(tabs)/ app/(drawer)/
git commit -m "feat(rn): tab + drawer layout with all screen stubs"
```

---

## Task 6: Dashboard screen

**Files:**
- Create: `lib/api/items.ts`
- Create: `lib/api/transactions.ts`
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Create items API hooks**

Create `lib/api/items.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface ItemSummary {
  id: number; sku: string; name: string; unit: string;
  total_quantity: number; reorder_level: number; status: 'OK' | 'LOW' | 'OUT';
  category?: { name: string; color: string; icon: string };
}

export interface PaginatedItems { items: ItemSummary[]; total: number; }

export function useItems(params?: { query?: string; category_id?: number; skip?: number; limit?: number }) {
  return useQuery({
    queryKey: ['items', params],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedItems>('/items/', { params });
      return res.data;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string; color: string; icon: string }>>('/items/categories');
      return res.data;
    },
  });
}
```

- [ ] **Step 2: Create transactions API hook**

Create `lib/api/transactions.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

// Matches backend InventoryEventRead schema
export interface InventoryEvent {
  id: number;
  occurred_at: string;
  event_kind: string;
  item_id: number;
  item_sku: string;
  item_name: string;
  from_location_id: number | null;
  from_location_code: string | null;
  to_location_id: number | null;
  to_location_code: string | null;
  quantity: number;
  notes: string | null;
  reference: string | null;
}

// Matches backend AlertRead schema
export interface AlertRead {
  id: number;
  item_id: number | null;
  item_sku: string | null;
  item_name: string | null;
  alert_type: string;
  severity: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
}

// Backend returns PaginatedResponse with `items` key (not `events`)
export function useRecentEvents(limit = 10) {
  return useQuery({
    queryKey: ['events', 'recent', limit],
    queryFn: async () => {
      const res = await apiClient.get<{ items: InventoryEvent[]; total: number }>('/transactions', { params: { limit } });
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

// Alerts at GET /transactions/alerts
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await apiClient.get<AlertRead[]>('/transactions/alerts');
      return res.data;
    },
  });
}
```

- [ ] **Step 3: Build Dashboard screen**

Replace `app/(tabs)/index.tsx`:

```typescript
import { ScrollView, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useItems } from '@/lib/api/items';
import { useAlerts, useRecentEvents } from '@/lib/api/transactions';

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <View className="flex-1 bg-slate-800 rounded-2xl p-4 mx-1">
      <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{label}</Text>
      <Text style={{ color }} className="text-3xl font-bold mt-1">{value}</Text>
      {sub && <Text className="text-slate-500 text-xs mt-1">{sub}</Text>}
    </View>
  );
}

export default function DashboardScreen() {
  const { data: itemData, isLoading, refetch } = useItems({ limit: 200 });
  const { data: alertData } = useAlerts();
  const { data: eventData } = useRecentEvents(8);

  const items = itemData?.items ?? [];
  const lowStock = items.filter((i) => i.status === 'LOW' || i.status === 'OUT').length;
  const totalValue = items.reduce((sum, i) => sum + (i.total_quantity ?? 0), 0);

  return (
    <ScrollView
      className="flex-1 bg-[#0f172a]"
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#6366f1" />}
    >
      <View className="px-4 pt-6 pb-4">
        <Text className="text-white text-2xl font-bold">Dashboard</Text>
        <Text className="text-slate-400 text-sm">SEAR Lab Inventory</Text>
      </View>

      {/* Stats row */}
      <View className="flex-row px-3 mb-4">
        <StatCard label="Total Items" value={items.length} color="#6366f1" sub="across all locations" />
        <StatCard label="Low / Out" value={lowStock} color={lowStock > 0 ? '#ef4444' : '#10b981'} sub="need reorder" />
      </View>
      <View className="flex-row px-3 mb-6">
        <StatCard label="Total Units" value={Math.round(totalValue)} color="#10b981" sub="in inventory" />
        <StatCard label="Alerts" value={alertData?.length ?? 0} color="#f59e0b" sub="active" />
      </View>

      {/* Alerts */}
      {(alertData?.length ?? 0) > 0 && (
        <View className="mx-4 mb-6">
          <Text className="text-white font-bold text-base mb-3">Active Alerts</Text>
          {alertData!.filter((a) => !a.is_resolved).slice(0, 4).map((alert) => (
            <View
              key={alert.id}
              className={`rounded-xl px-4 py-3 mb-2 flex-row items-center ${
                alert.severity === 'critical' ? 'bg-red-900/40 border border-red-700' : 'bg-amber-900/40 border border-amber-700'
              }`}
            >
              <Text className="text-slate-200 text-sm flex-1">{alert.message}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent activity */}
      <View className="mx-4 mb-8">
        <Text className="text-white font-bold text-base mb-3">Recent Activity</Text>
        {(eventData?.items ?? []).map((event) => (
          <View key={event.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center">
            <View className={`w-2 h-2 rounded-full mr-3 ${
              event.event_kind === 'STOCK_IN' ? 'bg-green-400' :
              event.event_kind === 'STOCK_OUT' ? 'bg-red-400' :
              event.event_kind === 'TRANSFER' ? 'bg-blue-400' : 'bg-amber-400'
            }`} />
            <View className="flex-1">
              <Text className="text-slate-200 text-sm font-medium">{event.item_name ?? 'Unknown item'}</Text>
              <Text className="text-slate-500 text-xs">
                {event.event_kind.replace('_', ' ')} · {event.quantity} {new Date(event.occurred_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Verify dashboard renders with real data**

```bash
npx expo start
```

Log in → Dashboard → verify stats cards show item counts, alerts show for low stock items, recent activity list shows events.

- [ ] **Step 5: Commit**

```bash
git add lib/api/items.ts lib/api/transactions.ts app/(tabs)/index.tsx
git commit -m "feat(rn): dashboard screen — stats, alerts, recent activity"
```

---

## Task 7: Inventory screens

**Files:**
- Modify: `app/(tabs)/inventory.tsx`
- Create: `app/(tabs)/item/[id].tsx`
- Create: `lib/api/locations.ts`
- Create: `components/inventory/ItemCard.tsx`

- [ ] **Step 1: Create ItemCard component**

Create `components/inventory/ItemCard.tsx`:

```typescript
import { View, Text, TouchableOpacity } from 'react-native';
import { ItemSummary } from '@/lib/api/items';

interface Props { item: ItemSummary; onPress: () => void; }

export function ItemCard({ item, onPress }: Props) {
  const statusColor = item.status === 'OK' ? '#10b981' : item.status === 'LOW' ? '#f59e0b' : '#ef4444';
  return (
    <TouchableOpacity
      className="bg-slate-800 rounded-2xl px-4 py-4 mb-3 flex-row items-center"
      onPress={onPress}
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-4"
        style={{ backgroundColor: (item.category?.color ?? '#6366f1') + '33' }}
      >
        <Text style={{ color: item.category?.color ?? '#6366f1' }} className="text-lg">📦</Text>
      </View>
      <View className="flex-1">
        <Text className="text-white font-semibold text-base">{item.name}</Text>
        <Text className="text-slate-400 text-xs">{item.sku} · {item.category?.name}</Text>
      </View>
      <View>
        <Text className="text-white text-right font-bold">{item.total_quantity} {item.unit}</Text>
        <Text style={{ color: statusColor }} className="text-xs text-right font-semibold">{item.status}</Text>
      </View>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 2: Build Inventory list screen**

Replace `app/(tabs)/inventory.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useItems, useCategories } from '@/lib/api/items';
import { ItemCard } from '@/components/inventory/ItemCard';

export default function InventoryScreen() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>();
  const { data, isLoading, refetch } = useItems({ query: search || undefined, category_id: selectedCategory, limit: 100 });
  const { data: categories } = useCategories();

  return (
    <View className="flex-1 bg-[#0f172a]">
      {/* Search */}
      <View className="px-4 pt-4 pb-2">
        <TextInput
          className="bg-slate-800 text-white rounded-xl px-4 py-3 text-base border border-slate-700"
          placeholder="Search items, SKU..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Category filter chips */}
      <FlatList
        horizontal
        data={[{ id: undefined, name: 'All', color: '#6366f1' }, ...(categories ?? [])]}
        keyExtractor={(c) => String(c.id)}
        contentContainerClassName="px-4 py-2"
        showsHorizontalScrollIndicator={false}
        renderItem={({ item: cat }) => (
          <TouchableOpacity
            className="rounded-full px-4 py-2 mr-2 border"
            style={{
              backgroundColor: selectedCategory === cat.id ? cat.color + '33' : 'transparent',
              borderColor: selectedCategory === cat.id ? cat.color : '#334155',
            }}
            onPress={() => setSelectedCategory(cat.id as number | undefined)}
          >
            <Text style={{ color: selectedCategory === cat.id ? cat.color : '#94a3b8' }} className="text-sm font-semibold">
              {cat.name}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Item list */}
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(i) => String(i.id)}
        contentContainerClassName="px-4 pb-8"
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#6366f1" />}
        ListEmptyComponent={<Text className="text-slate-400 text-center mt-10">No items found</Text>}
        renderItem={({ item }) => (
          <ItemCard item={item} onPress={() => router.push(`/(tabs)/item/${item.id}`)} />
        )}
      />
    </View>
  );
}
```

- [ ] **Step 3: Create item detail screen**

Create `app/(tabs)/item/[id].tsx`:

```typescript
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', id],
    queryFn: async () => {
      const res = await apiClient.get(`/items/${id}`);
      return res.data;
    },
  });

  if (isLoading) {
    return <View className="flex-1 bg-[#0f172a] items-center justify-center"><ActivityIndicator color="#6366f1" /></View>;
  }

  return (
    <ScrollView className="flex-1 bg-[#0f172a]">
      <View className="px-4 pt-6">
        <Text className="text-white text-2xl font-bold">{item?.name}</Text>
        <Text className="text-slate-400 text-sm mb-4">{item?.sku}</Text>

        <View className="bg-slate-800 rounded-2xl p-4 mb-4">
          <Text className="text-slate-400 text-xs font-semibold uppercase mb-3">Stock Info</Text>
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-300">Total Quantity</Text>
            <Text className="text-white font-bold">{item?.total_quantity} {item?.unit}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-300">Reorder Level</Text>
            <Text className="text-white">{item?.reorder_level}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-300">Status</Text>
            <Text className={`font-bold ${item?.status === 'OK' ? 'text-green-400' : item?.status === 'LOW' ? 'text-amber-400' : 'text-red-400'}`}>{item?.status}</Text>
          </View>
        </View>

        <View className="bg-slate-800 rounded-2xl p-4 mb-4">
          <Text className="text-slate-400 text-xs font-semibold uppercase mb-3">Details</Text>
          {[['Supplier', item?.supplier], ['Unit Cost', `$${item?.unit_cost}`], ['Category', item?.category?.name], ['Description', item?.description]].map(([label, value]) => value ? (
            <View key={label as string} className="flex-row justify-between mb-2">
              <Text className="text-slate-400 text-sm">{label}</Text>
              <Text className="text-white text-sm flex-1 text-right ml-4">{value}</Text>
            </View>
          ) : null)}
        </View>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Verify inventory flow**

Launch app → Inventory tab → items list visible → tap item → detail screen shows stock info.

- [ ] **Step 5: Commit**

```bash
git add lib/api/items.ts components/inventory/ app/(tabs)/inventory.tsx app/(tabs)/item/
git commit -m "feat(rn): inventory list, item detail, category filter"
```

---

## Task 8: Quick Scan screen

**Files:**
- Create: `lib/api/scan.ts`
- Modify: `app/(tabs)/scan.tsx`
- Create: `components/scan/CameraScanner.tsx`

- [ ] **Step 1: Create scan API hook**

Create `lib/api/scan.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

// Matches backend ScanLookupResponse + ScanResult.details for items
export interface ScanLookupResult {
  result_type: 'item' | 'location' | 'unknown';
  id: number | null;
  code: string;
  name: string;
  details: {
    unit?: string;
    category?: string;
    total_quantity?: number;
    reorder_level?: number;
    unit_cost?: number;
  };
}

export function useScanBarcode() {
  return useMutation({
    mutationFn: async (barcode: string) => {
      const res = await apiClient.post<ScanLookupResult>('/scans/lookup', { barcode_value: barcode });
      return res.data;
    },
  });
}

export function useItemStockLevels(itemId: number | null) {
  return useQuery({
    queryKey: ['item-stock', itemId],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/items/${itemId}`);
      return res.data;
    },
    enabled: itemId != null,
  });
}

// Uses actual backend endpoints: POST /scans/stock-in and POST /scans/stock-out
export function useStockAction() {
  return useMutation({
    mutationFn: async (payload: {
      item_id: number;
      location_id: number;
      kind: 'STOCK_IN' | 'STOCK_OUT';
      quantity: number;
      notes?: string;
    }) => {
      const endpoint = payload.kind === 'STOCK_IN' ? '/scans/stock-in' : '/scans/stock-out';
      const body =
        payload.kind === 'STOCK_IN'
          ? { item_id: payload.item_id, location_id: payload.location_id, quantity: payload.quantity, notes: payload.notes }
          : { item_id: payload.item_id, location_id: payload.location_id, quantity: payload.quantity, notes: payload.notes };
      const res = await apiClient.post(endpoint, body);
      return res.data;
    },
  });
}
```

- [ ] **Step 2: Create CameraScanner component**

Create `components/scan/CameraScanner.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const { width } = Dimensions.get('window');
const FRAME_SIZE = width * 0.7;

interface Props {
  onScan: (barcode: string) => void;
  active: boolean;
}

export function CameraScanner({ onScan, active }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const lastScan = useRef<string | null>(null);
  const cooldown = useRef(false);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  if (!permission?.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Text className="text-white text-center px-8">Camera permission required for scanning</Text>
      </View>
    );
  }

  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      onBarcodeScanned={
        active
          ? ({ data }) => {
              if (data === lastScan.current || cooldown.current) return;
              cooldown.current = true;
              lastScan.current = data;
              onScan(data);
              setTimeout(() => { cooldown.current = false; lastScan.current = null; }, 2500);
            }
          : undefined
      }
    >
      {/* Viewfinder overlay */}
      <View className="flex-1 bg-black/50 items-center justify-center">
        <View style={{ width: FRAME_SIZE, height: FRAME_SIZE, borderWidth: 2, borderColor: '#6366f1', borderRadius: 16, backgroundColor: 'transparent' }} />
        <Text className="text-white text-sm mt-4 opacity-75">Point camera at barcode or QR code</Text>
      </View>
    </CameraView>
  );
}
```

- [ ] **Step 3: Build Quick Scan screen**

Replace `app/(tabs)/scan.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, TextInput } from 'react-native';
import { CameraScanner } from '@/components/scan/CameraScanner';
import { useScanBarcode, useStockAction } from '@/lib/api/scan';

export default function ScanScreen() {
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [action, setAction] = useState<'STOCK_IN' | 'STOCK_OUT'>('STOCK_OUT');
  const [qty, setQty] = useState('1');
  const scanBarcode = useScanBarcode();
  const stockAction = useStockAction();

  const handleScan = async (barcode: string) => {
    setScanning(false);
    try {
      const data = await scanBarcode.mutateAsync(barcode);
      if (data.result_type !== 'item' || data.id === null) {
        setResult({ error: `No item found for barcode: ${barcode}` });
      } else {
        setResult(data);
      }
    } catch {
      setResult({ error: `No item found for barcode: ${barcode}` });
    }
  };

  const handleAction = async () => {
    if (!result?.id) return;
    // Use location_id=1 as default; in production show a location picker
    await stockAction.mutateAsync({
      item_id: result.id,
      location_id: 1,
      kind: action,
      quantity: parseInt(qty, 10),
    });
    setResult(null);
    setScanning(true);
  };

  return (
    <View className="flex-1 bg-black">
      <CameraScanner onScan={handleScan} active={scanning} />

      {scanBarcode.isPending && (
        <View className="absolute inset-0 bg-black/60 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
          <Text className="text-white mt-3">Looking up item...</Text>
        </View>
      )}

      {result && !result.error && (
        <Modal transparent animationType="slide">
          <View className="flex-1 justify-end">
            <View className="bg-slate-900 rounded-t-3xl p-6">
              <Text className="text-white text-xl font-bold mb-1">{result.name}</Text>
              <Text className="text-slate-400 text-sm mb-4">{result.code} · Stock: {result.details?.total_quantity ?? '?'} {result.details?.unit}</Text>

              <View className="flex-row mb-4">
                {(['STOCK_OUT', 'STOCK_IN'] as const).map((k) => (
                  <TouchableOpacity
                    key={k}
                    className={`flex-1 py-3 rounded-xl mr-2 items-center ${action === k ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    onPress={() => setAction(k)}
                  >
                    <Text className="text-white font-semibold">{k === 'STOCK_IN' ? 'Stock In' : 'Stock Out'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                className="bg-slate-800 text-white rounded-xl px-4 py-3 mb-4 text-center text-2xl border border-slate-700"
                value={qty}
                onChangeText={setQty}
                keyboardType="number-pad"
              />

              <TouchableOpacity
                className="bg-indigo-600 rounded-xl py-4 items-center mb-3"
                onPress={handleAction}
                disabled={stockAction.isPending}
              >
                {stockAction.isPending ? <ActivityIndicator color="white" /> : (
                  <Text className="text-white font-bold text-base">Confirm {action === 'STOCK_IN' ? 'Stock In' : 'Stock Out'}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity className="py-3 items-center" onPress={() => { setResult(null); setScanning(true); }}>
                <Text className="text-slate-400">Cancel — Scan Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {result?.error && (
        <Modal transparent animationType="slide">
          <View className="flex-1 justify-end">
            <View className="bg-slate-900 rounded-t-3xl p-6">
              <Text className="text-red-400 text-lg font-bold mb-4">{result.error}</Text>
              <TouchableOpacity className="bg-slate-700 rounded-xl py-4 items-center" onPress={() => { setResult(null); setScanning(true); }}>
                <Text className="text-white">Scan Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Test Quick Scan on device**

```bash
npx expo start
```

Open on physical device → Quick Scan tab → camera opens → scan a barcode (or QR from any item in sandbox) → item found sheet appears → change qty → confirm.

- [ ] **Step 5: Commit**

```bash
git add lib/api/scan.ts components/scan/CameraScanner.tsx app/(tabs)/scan.tsx
git commit -m "feat(rn): Quick Scan — camera, barcode lookup, stock in/out action"
```

---

## Task 9: SmartScan screen

**Files:**
- Create: `lib/utils/epc.ts`
- Create: `lib/utils/gs1.ts`
- Create: `lib/store/scan.ts`
- Modify: `app/(tabs)/smartscan.tsx`

- [ ] **Step 1: Create EPC decoder utility**

Create `lib/utils/epc.ts`:

```typescript
/**
 * SGTIN-96 EPC decoder.
 * Bit layout: Header(8) | Filter(3) | Partition(3) | Company(20-40) | ItemRef(24-4) | Serial(38)
 */
export interface DecodedEPC {
  type: 'SGTIN-96';
  companyPrefix: string;
  itemReference: string;
  serial: string;
  gtin14: string;
}

export function decodeEPC(hexOrBinary: string): DecodedEPC | null {
  try {
    // Normalize: accept hex string like "3034257BF7194E4000001A85"
    const hex = hexOrBinary.replace(/\s/g, '').toUpperCase();
    if (hex.length !== 24) return null;

    const bits = BigInt('0x' + hex).toString(2).padStart(96, '0');
    const header = parseInt(bits.slice(0, 8), 2);
    if (header !== 0x30) return null; // Not SGTIN-96

    const partition = parseInt(bits.slice(11, 14), 2);
    const PARTITION_TABLE: [number, number, number][] = [
      [40, 4, 0], [37, 7, 1], [34, 10, 2], [30, 14, 3],
      [27, 17, 4], [24, 20, 5], [20, 24, 6],
    ];
    const [compBits, itemBits] = PARTITION_TABLE[partition] ?? [0, 0];

    const companyPrefix = parseInt(bits.slice(14, 14 + compBits), 2).toString().padStart(compBits / 3 + 1, '0');
    const itemReference = parseInt(bits.slice(14 + compBits, 14 + compBits + itemBits), 2).toString();
    const serial = parseInt(bits.slice(58, 96), 2).toString();

    // Reconstruct GTIN-14 (company + item + check digit)
    const raw = (companyPrefix + itemReference).padStart(13, '0');
    const checkDigit = computeGTINCheckDigit(raw);
    const gtin14 = raw + checkDigit;

    return { type: 'SGTIN-96', companyPrefix, itemReference, serial, gtin14 };
  } catch {
    return null;
  }
}

function computeGTINCheckDigit(digits: string): string {
  const sum = digits.split('').reverse().reduce((acc, d, i) => acc + parseInt(d) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
```

- [ ] **Step 2: Create GS1 barcode parser**

Create `lib/utils/gs1.ts`:

```typescript
/** Parse GS1 barcodes: GTIN-14, Code-128 with AIs, GS1 Digital Links. */
export interface ParsedGS1 {
  format: 'GTIN14' | 'EAN13' | 'CODE128_GS1' | 'DIGITAL_LINK' | 'RAW';
  gtin?: string;
  lot?: string;
  serial?: string;
  expiry?: string;
  raw: string;
}

export function parseGS1Barcode(raw: string): ParsedGS1 {
  // GS1 Digital Link URL
  if (raw.startsWith('https://') || raw.startsWith('http://')) {
    const url = new URL(raw);
    const gtin = url.pathname.match(/\/01\/(\d{14})/)?.[1];
    const serial = url.pathname.match(/\/21\/([^/]+)/)?.[1];
    return { format: 'DIGITAL_LINK', gtin, serial, raw };
  }

  // Pure 14-digit GTIN
  if (/^\d{14}$/.test(raw)) return { format: 'GTIN14', gtin: raw, raw };

  // EAN-13 → pad to GTIN-14
  if (/^\d{13}$/.test(raw)) return { format: 'EAN13', gtin: '0' + raw, raw };

  // GS1-128 with Application Identifiers
  const AIs: Record<string, string> = {};
  let pos = 0;
  const str = raw.replace(/[\x1D]/g, '\x1D'); // GS separator
  while (pos < str.length) {
    const ai2 = str.slice(pos, pos + 2);
    const ai3 = str.slice(pos, pos + 3);
    const ai4 = str.slice(pos, pos + 4);
    if (ai2 === '01') { AIs['01'] = str.slice(pos + 2, pos + 16); pos += 16; }
    else if (ai3 === '310') { AIs['310'] = str.slice(pos + 4, pos + 10); pos += 10; }
    else if (ai2 === '10') { const end = str.indexOf('\x1D', pos + 2); AIs['10'] = str.slice(pos + 2, end < 0 ? str.length : end); pos = end < 0 ? str.length : end + 1; }
    else if (ai2 === '21') { const end = str.indexOf('\x1D', pos + 2); AIs['21'] = str.slice(pos + 2, end < 0 ? str.length : end); pos = end < 0 ? str.length : end + 1; }
    else if (ai2 === '17') { AIs['17'] = str.slice(pos + 2, pos + 8); pos += 8; }
    else { pos++; }
  }
  if (AIs['01']) return { format: 'CODE128_GS1', gtin: AIs['01'], lot: AIs['10'], serial: AIs['21'], expiry: AIs['17'], raw };

  return { format: 'RAW', raw };
}
```

- [ ] **Step 3: Create scan Zustand store**

Create `lib/store/scan.ts`:

```typescript
import { create } from 'zustand';
import { ScanResult } from '@/lib/api/scan';

type AutoAction = 'STOCK_OUT' | 'STOCK_IN' | 'TRANSFER' | null;

interface ScanState {
  lastResult: ScanResult | null;
  autoAction: AutoAction;
  forceAction: AutoAction;
  scanHistory: Array<{ barcode: string; result: ScanResult | null; ts: number }>;
  setResult: (r: ScanResult | null) => void;
  setAutoAction: (a: AutoAction) => void;
  setForceAction: (a: AutoAction) => void;
  pushHistory: (barcode: string, result: ScanResult | null) => void;
  clearHistory: () => void;
}

export const useScanStore = create<ScanState>((set) => ({
  lastResult: null,
  autoAction: 'STOCK_OUT',
  forceAction: null,
  scanHistory: [],
  setResult: (r) => set({ lastResult: r }),
  setAutoAction: (a) => set({ autoAction: a }),
  setForceAction: (a) => set({ forceAction: a }),
  pushHistory: (barcode, result) =>
    set((s) => ({ scanHistory: [{ barcode, result, ts: Date.now() }, ...s.scanHistory].slice(0, 20) })),
  clearHistory: () => set({ scanHistory: [] }),
}));
```

- [ ] **Step 4: Build SmartScan screen**

Replace `app/(tabs)/smartscan.tsx`:

```typescript
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Modal, TextInput, ActivityIndicator } from 'react-native';
import { CameraScanner } from '@/components/scan/CameraScanner';
import { useScanBarcode, useStockAction } from '@/lib/api/scan';
import { useScanStore } from '@/lib/store/scan';
import { decodeEPC } from '@/lib/utils/epc';
import { parseGS1Barcode } from '@/lib/utils/gs1';
import { Ionicons } from '@expo/vector-icons';

type Mode = 'CAMERA' | 'RFID';
type ActionKind = 'STOCK_IN' | 'STOCK_OUT' | 'TRANSFER';

const ACTION_COLORS: Record<ActionKind, string> = {
  STOCK_IN: '#10b981',
  STOCK_OUT: '#ef4444',
  TRANSFER: '#3b82f6',
};

export default function SmartScanScreen() {
  const [mode, setMode] = useState<Mode>('CAMERA');
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [qty, setQty] = useState('1');
  const [parsedCode, setParsedCode] = useState<any>(null);
  const { autoAction, forceAction, setAutoAction, setForceAction, pushHistory } = useScanStore();
  const scanBarcode = useScanBarcode();
  const stockAction = useStockAction();

  const effectiveAction: ActionKind = (forceAction ?? autoAction) as ActionKind ?? 'STOCK_OUT';

  const handleScan = useCallback(async (raw: string) => {
    setScanning(false);

    // Try EPC decode first
    const epc = decodeEPC(raw);
    const gs1 = parseGS1Barcode(raw);
    setParsedCode({ epc, gs1, raw });

    const lookupValue = epc?.gtin14 ?? gs1.gtin ?? raw;

    try {
      const data = await scanBarcode.mutateAsync(lookupValue);
      setResult(data);
      pushHistory(raw, data);
    } catch {
      setResult({ error: `No item matched: ${lookupValue}` });
      pushHistory(raw, null);
    }
  }, [autoAction, forceAction]);

  const handleAction = async () => {
    if (!result?.item) return;
    const locationId = result.stock_levels?.[0]?.location_id ?? 1;
    await stockAction.mutateAsync({
      item_id: result.item.id,
      location_id: locationId,
      kind: effectiveAction,
      quantity: parseInt(qty, 10),
    });
    setResult(null);
    setParsedCode(null);
    setScanning(true);
  };

  return (
    <View className="flex-1 bg-black">
      {/* Camera */}
      <CameraScanner onScan={handleScan} active={scanning && mode === 'CAMERA'} />

      {/* Controls overlay at top */}
      <View className="absolute top-0 left-0 right-0 pt-12 px-4">
        {/* Mode toggle */}
        <View className="flex-row bg-black/70 rounded-2xl p-1 mb-3 self-center">
          {(['CAMERA', 'RFID'] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              className={`px-6 py-2 rounded-xl ${mode === m ? 'bg-amber-500' : 'transparent'}`}
              onPress={() => setMode(m)}
            >
              <Text className={`font-bold text-sm ${mode === m ? 'text-black' : 'text-white'}`}>
                {m === 'CAMERA' ? '📷 Camera' : '📡 RFID'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Auto-action selector */}
        <View className="bg-black/70 rounded-2xl px-4 py-3">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-slate-300 text-sm font-semibold">Auto Action</Text>
            <View className="flex-row">
              {(['STOCK_OUT', 'STOCK_IN', 'TRANSFER'] as ActionKind[]).map((a) => (
                <TouchableOpacity
                  key={a}
                  className="px-3 py-1 rounded-lg mr-1"
                  style={{ backgroundColor: autoAction === a ? ACTION_COLORS[a] : '#334155' }}
                  onPress={() => setAutoAction(a)}
                >
                  <Text className="text-white text-xs font-bold">{a.replace('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-300 text-sm">Force override</Text>
            <View className="flex-row">
              {(['STOCK_OUT', 'STOCK_IN', null] as (ActionKind | null)[]).map((a) => (
                <TouchableOpacity
                  key={String(a)}
                  className="px-3 py-1 rounded-lg mr-1"
                  style={{ backgroundColor: forceAction === a ? '#6366f1' : '#334155' }}
                  onPress={() => setForceAction(a)}
                >
                  <Text className="text-white text-xs">{a ?? 'Auto'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* RFID placeholder */}
      {mode === 'RFID' && (
        <View className="absolute inset-0 bg-[#0f172a] items-center justify-center">
          <Text className="text-6xl mb-4">📡</Text>
          <Text className="text-white text-xl font-bold mb-2">RFID Mode</Text>
          <Text className="text-slate-400 text-center px-8">
            Connect RP902 via serial bridge.{'\n'}Waiting for tag read...
          </Text>
        </View>
      )}

      {/* Loading */}
      {scanBarcode.isPending && (
        <View className="absolute inset-0 bg-black/70 items-center justify-center">
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text className="text-white mt-3">SmartScan processing...</Text>
          {parsedCode?.epc && (
            <Text className="text-amber-400 text-xs mt-2">EPC: {parsedCode.epc.gtin14}</Text>
          )}
        </View>
      )}

      {/* Result sheet */}
      {result && !result.error && (
        <Modal transparent animationType="slide">
          <View className="flex-1 justify-end">
            <View className="bg-slate-900 rounded-t-3xl p-6">
              <View className="flex-row items-center mb-4">
                <View className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: ACTION_COLORS[effectiveAction] }} />
                <Text className="text-amber-400 text-xs font-bold uppercase">{effectiveAction.replace('_', ' ')}</Text>
              </View>
              <Text className="text-white text-xl font-bold mb-1">{result.item.name}</Text>
              <Text className="text-slate-400 text-sm mb-1">{result.item.sku}</Text>
              {parsedCode?.epc && (
                <Text className="text-amber-400 text-xs mb-3">SGTIN-96 · Serial {parsedCode.epc.serial}</Text>
              )}
              {parsedCode?.gs1?.lot && (
                <Text className="text-blue-400 text-xs mb-3">Lot: {parsedCode.gs1.lot}</Text>
              )}

              <Text className="text-slate-400 text-sm mb-2">Current stock: {result.item.total_quantity} {result.item.unit}</Text>

              <TextInput
                className="bg-slate-800 text-white rounded-xl px-4 py-3 mb-4 text-center text-2xl border border-slate-700"
                value={qty}
                onChangeText={setQty}
                keyboardType="number-pad"
              />

              <TouchableOpacity
                className="rounded-xl py-4 items-center mb-3"
                style={{ backgroundColor: ACTION_COLORS[effectiveAction] }}
                onPress={handleAction}
                disabled={stockAction.isPending}
              >
                {stockAction.isPending ? <ActivityIndicator color="white" /> : (
                  <Text className="text-white font-bold text-base">
                    Confirm — {effectiveAction.replace('_', ' ')} × {qty}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity className="py-3 items-center" onPress={() => { setResult(null); setScanning(true); }}>
                <Text className="text-slate-400">Cancel — Scan Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
```

- [ ] **Step 5: Test SmartScan**

```bash
npx expo start
```

Tap SmartScan tab → camera opens → scan Code-128 or QR → result sheet shows with action type colored by auto-action → change mode buttons work → force override toggles auto.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/ lib/store/scan.ts app/(tabs)/smartscan.tsx
git commit -m "feat(rn): SmartScan — EPC decoder, GS1 parser, auto-action, force-override, RFID stub"
```

---

## Task 10: AI Copilot screen

**Files:**
- Create: `lib/api/copilot.ts`
- Modify: `app/(tabs)/copilot.tsx`
- Create: `components/copilot/ChatBubble.tsx`

- [ ] **Step 1: Create copilot streaming hook**

Create `lib/api/copilot.ts`:

```typescript
import { useState, useCallback } from 'react';
import { SANDBOX_API_URL } from '@/constants/api';
import * as SecureStore from 'expo-secure-store';

export interface Message { role: 'user' | 'assistant'; content: string; }

export function useCopilotChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  const sendMessage = useCallback(async (userMessage: string) => {
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setStreaming(true);

    const token = await SecureStore.getItemAsync('access_token');
    let assistantContent = '';

    try {
      const response = await fetch(`${SANDBOX_API_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      setMessages([...newMessages, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // SSE format: "data: <text>\n\n"
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6);
            if (text === '[DONE]') continue;
            assistantContent += text;
            setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
          }
        }
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: 'Sorry, something went wrong. Try again.' }]);
    } finally {
      setStreaming(false);
    }
  }, [messages]);

  const clearMessages = () => setMessages([]);
  return { messages, streaming, sendMessage, clearMessages };
}
```

- [ ] **Step 2: Create ChatBubble component**

Create `components/copilot/ChatBubble.tsx`:

```typescript
import { View, Text } from 'react-native';
import { Message } from '@/lib/api/copilot';

export function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <View className={`mb-3 flex-row ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <View className="w-8 h-8 rounded-full bg-indigo-600 items-center justify-center mr-2 mt-1 flex-shrink-0">
          <Text className="text-white text-xs font-bold">AI</Text>
        </View>
      )}
      <View
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser ? 'bg-indigo-600 rounded-tr-sm' : 'bg-slate-800 rounded-tl-sm'
        }`}
      >
        <Text className="text-white text-sm leading-5">{message.content || '…'}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Build AI Copilot screen**

Replace `app/(tabs)/copilot.tsx`:

```typescript
import { useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { ChatBubble } from '@/components/copilot/ChatBubble';
import { useCopilotChat } from '@/lib/api/copilot';
import { Ionicons } from '@expo/vector-icons';

const STARTER_PROMPTS = [
  'What items are low on stock?',
  'Show me recent chemical usage',
  'Which items are expiring soon?',
  'Summarize energy usage this week',
];

export default function CopilotScreen() {
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const { messages, streaming, sendMessage, clearMessages } = useCopilotChat();

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    await sendMessage(text);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0f172a]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
        <View>
          <Text className="text-white font-bold text-base">AI Copilot</Text>
          <Text className="text-slate-400 text-xs">SEAR Lab Knowledge Base</Text>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearMessages} className="p-2">
            <Ionicons name="trash-outline" size={20} color="#64748b" />
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View className="flex-1 px-4 pt-8">
          <Text className="text-slate-400 text-center mb-6">Ask anything about your inventory</Text>
          <View className="flex-row flex-wrap gap-2 justify-center">
            {STARTER_PROMPTS.map((p) => (
              <TouchableOpacity
                key={p}
                className="bg-slate-800 rounded-2xl px-4 py-3 border border-slate-700"
                onPress={() => sendMessage(p)}
              >
                <Text className="text-slate-300 text-sm">{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerClassName="px-4 py-4"
          renderItem={({ item }) => <ChatBubble message={item} />}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {/* Input */}
      <View className="flex-row px-4 py-3 border-t border-slate-800 items-end">
        <TextInput
          className="flex-1 bg-slate-800 text-white rounded-2xl px-4 py-3 mr-3 text-base border border-slate-700 max-h-28"
          placeholder="Ask about inventory..."
          placeholderTextColor="#64748b"
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          className="w-11 h-11 bg-indigo-600 rounded-full items-center justify-center"
          onPress={handleSend}
          disabled={streaming || !input.trim()}
        >
          {streaming ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Test AI Copilot**

```bash
npx expo start
```

Tap AI Copilot tab → starter prompts visible → tap "What items are low on stock?" → AI responds with streaming text.

- [ ] **Step 5: Commit**

```bash
git add lib/api/copilot.ts components/copilot/ app/(tabs)/copilot.tsx
git commit -m "feat(rn): AI Copilot — streaming chat, starter prompts"
```

---

## Task 11: Energy Hub screen

**Files:**
- Create: `lib/api/energy.ts`
- Modify: `app/(tabs)/energy.tsx`
- Create: `components/energy/EnergyAreaChart.tsx`
- Create: `components/energy/GaugeChart.tsx`

- [ ] **Step 1: Create energy API hook**

Create `lib/api/energy.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface EnergyReading {
  timestamp: string;
  solar_current_power_w: number | null;
  ac_consumption_w: number | null;
  hwh_consumption_w: number | null;
  total_consumption_w: number | null;
  net_balance_w: number | null;
}

export interface EnergyDashboard {
  latest: EnergyReading | null;
  history: {
    labels: string[];
    solar: number[];
    net: number[];
    hvac: number[];
    hwh: number[];
  };
}

export function useEnergyDashboard(range: '1h' | '3h' | '24h' | '7d' = '24h') {
  return useQuery({
    queryKey: ['energy', range],
    queryFn: async () => {
      const res = await apiClient.get<EnergyDashboard>('/energy/dashboard', { params: { range } });
      return res.data;
    },
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 2: Create GaugeChart component**

Create `components/energy/GaugeChart.tsx`:

```typescript
import { View, Text } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

interface Props { value: number; max: number; label: string; unit: string; color: string; size?: number; }

export function GaugeChart({ value, max, label, unit, color, size = 100 }: Props) {
  const pct = Math.min(value / max, 1);
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = -210;
  const sweepAngle = 240 * pct;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(startAngle + sweepAngle));
  const y2 = cy + r * Math.sin(toRad(startAngle + sweepAngle));
  const large = sweepAngle > 180 ? 1 : 0;

  return (
    <View className="items-center">
      <Svg width={size} height={size}>
        {/* Background arc */}
        <Path
          d={`M ${cx + r * Math.cos(toRad(-210))} ${cy + r * Math.sin(toRad(-210))} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(toRad(30))} ${cy + r * Math.sin(toRad(30))}`}
          stroke="#1e293b"
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
        />
        {/* Value arc */}
        {pct > 0 && (
          <Path
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
            stroke={color}
            strokeWidth={8}
            fill="none"
            strokeLinecap="round"
          />
        )}
      </Svg>
      <Text style={{ color }} className="text-2xl font-bold -mt-10">{Math.round(value)}</Text>
      <Text className="text-slate-400 text-xs">{unit}</Text>
      <Text className="text-slate-300 text-xs font-semibold mt-1">{label}</Text>
    </View>
  );
}
```

- [ ] **Step 3: Build Energy Hub screen**

Replace `app/(tabs)/energy.tsx`:

```typescript
import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useEnergyDashboard } from '@/lib/api/energy';
import { GaugeChart } from '@/components/energy/GaugeChart';

const RANGES = ['1h', '3h', '24h', '7d'] as const;
type Range = typeof RANGES[number];

export default function EnergyScreen() {
  const [range, setRange] = useState<Range>('24h');
  const { data, isLoading, refetch } = useEnergyDashboard(range);

  const latest = data?.latest;
  const solar = latest?.solar_current_power_w ?? 0;
  const ac = latest?.ac_consumption_w ?? 0;
  const hwh = latest?.hwh_consumption_w ?? 0;
  const net = latest?.net_balance_w ?? 0;

  return (
    <ScrollView
      className="flex-1 bg-[#0f172a]"
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#f59e0b" />}
    >
      <View className="px-4 pt-6 pb-2">
        <Text className="text-white text-2xl font-bold">Energy Hub</Text>
        <Text className="text-slate-400 text-sm">SEAR Lab · Live Readings</Text>
      </View>

      {/* Range selector */}
      <View className="flex-row px-4 mb-6">
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r}
            className={`px-4 py-2 rounded-xl mr-2 ${range === r ? 'bg-amber-500' : 'bg-slate-800'}`}
            onPress={() => setRange(r)}
          >
            <Text className={`text-sm font-semibold ${range === r ? 'text-black' : 'text-slate-400'}`}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Gauges */}
      <View className="flex-row justify-around px-4 mb-6 bg-slate-900 mx-4 rounded-3xl py-6">
        <GaugeChart value={solar} max={5000} label="Solar" unit="W" color="#f59e0b" />
        <GaugeChart value={ac} max={3000} label="AC" color="#6366f1" unit="W" />
        <GaugeChart value={hwh} max={1500} label="HWH" color="#3b82f6" unit="W" />
      </View>

      {/* Net balance card */}
      <View className={`mx-4 rounded-2xl p-5 mb-6 ${net >= 0 ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
        <Text className="text-slate-400 text-xs font-semibold uppercase">Net Balance</Text>
        <Text className={`text-4xl font-bold mt-1 ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {net >= 0 ? '+' : ''}{Math.round(net)} W
        </Text>
        <Text className="text-slate-400 text-sm mt-1">
          {net >= 0 ? '⬆ Exporting to grid' : '⬇ Drawing from grid'}
        </Text>
      </View>

      {/* Stats grid */}
      <View className="flex-row mx-4 mb-6">
        <View className="flex-1 bg-slate-800 rounded-2xl p-4 mr-2">
          <Text className="text-slate-400 text-xs">Total Consumption</Text>
          <Text className="text-white text-xl font-bold mt-1">{Math.round((ac + hwh) / 1000 * 100) / 100} kW</Text>
        </View>
        <View className="flex-1 bg-slate-800 rounded-2xl p-4">
          <Text className="text-slate-400 text-xs">Solar Coverage</Text>
          <Text className="text-amber-400 text-xl font-bold mt-1">
            {(ac + hwh) > 0 ? Math.round(Math.min(solar / (ac + hwh), 1) * 100) : 0}%
          </Text>
        </View>
      </View>

      {/* History note */}
      <View className="mx-4 mb-8 bg-slate-800 rounded-2xl p-4">
        <Text className="text-slate-400 text-xs font-semibold uppercase mb-2">30-Day Trend</Text>
        <Text className="text-slate-300 text-sm">
          {(data?.history?.solar?.length ?? 0)} data points loaded for {range} range.
          {'\n'}Peak solar: {Math.round(Math.max(...(data?.history?.solar ?? [0])))} W
        </Text>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Verify Energy Hub renders**

```bash
npx expo start
```

Energy tab → gauges visible with synthetic data, net balance card shows, range selector switches.

- [ ] **Step 5: Commit**

```bash
git add lib/api/energy.ts components/energy/ app/(tabs)/energy.tsx
git commit -m "feat(rn): Energy Hub — SVG gauges, net balance, range selector"
```

---

## Task 12: Transactions, Admin, Settings drawer screens

**Files:**
- Modify: `app/(drawer)/transactions.tsx`
- Modify: `app/(drawer)/admin.tsx`
- Modify: `app/(drawer)/settings.tsx`
- Create: `lib/api/admin.ts`

- [ ] **Step 1: Build Transactions screen**

Replace `app/(drawer)/transactions.tsx`:

```typescript
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useRecentEvents } from '@/lib/api/transactions';

const KIND_COLOR: Record<string, string> = {
  STOCK_IN: '#10b981', STOCK_OUT: '#ef4444', TRANSFER: '#3b82f6', ADJUSTMENT: '#f59e0b', CYCLE_COUNT: '#8b5cf6',
};

export default function TransactionsScreen() {
  const { data, isLoading, refetch } = useRecentEvents(50);
  const events = data?.events ?? [];

  return (
    <View className="flex-1 bg-[#0f172a]">
      <FlatList
        data={events}
        keyExtractor={(e) => String(e.id)}
        contentContainerClassName="px-4 py-4"
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#6366f1" />}
        ListHeaderComponent={<Text className="text-white text-xl font-bold mb-4">Transaction History</Text>}
        ListEmptyComponent={<Text className="text-slate-400 text-center mt-10">No transactions yet</Text>}
        renderItem={({ item: e }) => (
          <View className="bg-slate-800 rounded-2xl px-4 py-4 mb-3 flex-row items-start">
            <View className="w-3 h-3 rounded-full mt-1.5 mr-3 flex-shrink-0" style={{ backgroundColor: KIND_COLOR[e.event_kind] ?? '#64748b' }} />
            <View className="flex-1">
              <Text className="text-white font-semibold">{e.item_name ?? 'Unknown item'}</Text>
              <Text className="text-slate-400 text-xs mt-0.5">
                {e.event_kind.replace('_', ' ')} · {e.quantity} units
              </Text>
              {e.notes && <Text className="text-slate-500 text-xs mt-1">{e.notes}</Text>}
            </View>
            <Text className="text-slate-500 text-xs">{new Date(e.occurred_at).toLocaleDateString()}</Text>
          </View>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 2: Create admin API hook + build Admin screen**

Create `lib/api/admin.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get<any[]>('/users/');
      return res.data;
    },
  });
}

export function useRoleRequests() {
  return useQuery({
    queryKey: ['role-requests'],
    queryFn: async () => {
      const res = await apiClient.get<any[]>('/auth/role-requests');
      return res.data;
    },
  });
}

export function useApproveRoleRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, approved }: { requestId: number; approved: boolean }) => {
      const res = await apiClient.post(`/auth/role-requests/${requestId}/decision`, { approved });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['role-requests'] }),
  });
}
```

Replace `app/(drawer)/admin.tsx`:

```typescript
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useAuthStore } from '@/lib/store/auth';
import { useUsers, useRoleRequests, useApproveRoleRequest } from '@/lib/api/admin';

export default function AdminScreen() {
  const user = useAuthStore((s) => s.user);
  const { data: users, isLoading: usersLoading, refetch } = useUsers();
  const { data: requests } = useRoleRequests();
  const approve = useApproveRoleRequest();

  if (!user?.is_superuser && !user?.roles?.includes('admin')) {
    return (
      <View className="flex-1 bg-[#0f172a] items-center justify-center px-8">
        <Text className="text-4xl mb-4">🛡️</Text>
        <Text className="text-white text-xl font-bold mb-2">Admin Only</Text>
        <Text className="text-slate-400 text-center">You need admin role to access this panel.</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-[#0f172a]"
      refreshControl={<RefreshControl refreshing={usersLoading} onRefresh={refetch} tintColor="#6366f1" />}
      ListHeaderComponent={
        <View className="px-4 pt-6">
          <Text className="text-white text-xl font-bold mb-4">Admin Panel</Text>
          {(requests?.length ?? 0) > 0 && (
            <View className="mb-6">
              <Text className="text-amber-400 font-semibold mb-3">Pending Role Requests ({requests?.length})</Text>
              {requests!.map((r: any) => (
                <View key={r.id} className="bg-slate-800 rounded-2xl p-4 mb-2">
                  <Text className="text-white font-semibold">{r.user?.full_name}</Text>
                  <Text className="text-slate-400 text-sm mb-3">Requesting: {r.requested_role}</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity className="flex-1 bg-green-700 rounded-xl py-2 items-center mr-2" onPress={() => approve.mutate({ requestId: r.id, approved: true })}>
                      <Text className="text-white font-semibold">Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="flex-1 bg-red-800 rounded-xl py-2 items-center" onPress={() => approve.mutate({ requestId: r.id, approved: false })}>
                      <Text className="text-white font-semibold">Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Text className="text-slate-400 text-xs font-semibold uppercase mb-3">Users ({users?.length ?? 0})</Text>
        </View>
      }
      data={users ?? []}
      keyExtractor={(u) => String(u.id)}
      contentContainerClassName="pb-8"
      renderItem={({ item: u }) => (
        <View className="bg-slate-800 mx-4 rounded-2xl px-4 py-3 mb-2 flex-row items-center">
          <View className="w-10 h-10 bg-indigo-600 rounded-full items-center justify-center mr-3">
            <Text className="text-white font-bold">{u.full_name?.[0]}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold">{u.full_name}</Text>
            <Text className="text-slate-400 text-xs">{u.email} · {u.roles?.map((r: any) => r.role?.name).join(', ')}</Text>
          </View>
          {u.is_superuser && <Text className="text-amber-400 text-xs font-bold">SUPER</Text>}
        </View>
      )}
    />
  );
}
```

- [ ] **Step 3: Build Settings screen**

Replace `app/(drawer)/settings.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store/auth';
import { apiClient } from '@/lib/api/client';

export default function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'idle' | 'otp-sent' | 'done'>('idle');

  const sendOTP = useMutation({
    mutationFn: async () => apiClient.post('/auth/otp/send', { email: user?.email }),
    onSuccess: () => setStep('otp-sent'),
  });

  const changePassword = useMutation({
    mutationFn: async () => apiClient.post('/auth/change-password', { current_password: currentPwd, new_password: newPwd, otp }),
    onSuccess: () => { setStep('done'); Alert.alert('Password changed!'); },
    onError: () => Alert.alert('Error', 'Invalid OTP or current password.'),
  });

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView className="flex-1 bg-[#0f172a]">
      <View className="px-4 pt-6">
        <Text className="text-white text-xl font-bold mb-6">Settings</Text>

        {/* Profile */}
        <View className="bg-slate-800 rounded-2xl p-4 mb-6">
          <View className="flex-row items-center mb-4">
            <View className="w-14 h-14 bg-indigo-600 rounded-full items-center justify-center mr-4">
              <Text className="text-white text-2xl font-bold">{user?.full_name?.[0]}</Text>
            </View>
            <View>
              <Text className="text-white font-bold text-base">{user?.full_name}</Text>
              <Text className="text-slate-400 text-sm">@{user?.username}</Text>
              <Text className="text-slate-500 text-xs">{user?.email}</Text>
            </View>
          </View>
        </View>

        {/* Change password */}
        <View className="bg-slate-800 rounded-2xl p-4 mb-6">
          <Text className="text-white font-semibold mb-4">Change Password</Text>
          <TextInput className="bg-slate-900 text-white rounded-xl px-4 py-3 mb-3 border border-slate-700" placeholder="Current password" placeholderTextColor="#64748b" secureTextEntry value={currentPwd} onChangeText={setCurrentPwd} />
          <TextInput className="bg-slate-900 text-white rounded-xl px-4 py-3 mb-3 border border-slate-700" placeholder="New password" placeholderTextColor="#64748b" secureTextEntry value={newPwd} onChangeText={setNewPwd} />

          {step === 'idle' && (
            <TouchableOpacity className="bg-indigo-600 rounded-xl py-3 items-center" onPress={() => sendOTP.mutate()} disabled={sendOTP.isPending}>
              {sendOTP.isPending ? <ActivityIndicator color="white" /> : <Text className="text-white font-semibold">Send OTP to Email</Text>}
            </TouchableOpacity>
          )}

          {step === 'otp-sent' && (
            <>
              <TextInput className="bg-slate-900 text-white rounded-xl px-4 py-3 mb-3 text-center text-xl tracking-widest border border-slate-700" placeholder="OTP code" placeholderTextColor="#64748b" keyboardType="number-pad" maxLength={6} value={otp} onChangeText={setOtp} />
              <TouchableOpacity className="bg-green-700 rounded-xl py-3 items-center" onPress={() => changePassword.mutate()} disabled={changePassword.isPending}>
                {changePassword.isPending ? <ActivityIndicator color="white" /> : <Text className="text-white font-semibold">Confirm Change</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity className="bg-red-900/40 border border-red-700 rounded-2xl py-4 items-center mb-8" onPress={handleLogout}>
          <Text className="text-red-400 font-semibold">Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Verify all drawer screens**

```bash
npx expo start
```

Open drawer → tap Transactions (event list) → Admin (user list + role requests) → Settings (profile, password, logout).

- [ ] **Step 5: Commit**

```bash
git add lib/api/admin.ts app/(drawer)/
git commit -m "feat(rn): drawer screens — transactions, admin panel, settings with password change"
```

---

## Task 13: EAS Build configuration + conference distribution

**Files:**
- Create: `eas.json`

- [ ] **Step 1: Install EAS CLI**

```bash
npm install -g eas-cli
eas login
```

- [ ] **Step 2: Create EAS config**

Create `eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false },
      "env": { "EXPO_PUBLIC_API_URL": "https://inventory-sandbox-xxxx.run.app" }
    },
    "conference": {
      "distribution": "internal",
      "ios": { "buildConfiguration": "Release" },
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://inventory-sandbox-xxxx.run.app" }
    }
  },
  "submit": {
    "production": {}
  }
}
```

> **Before building:** Replace `https://inventory-sandbox-xxxx.run.app` with the actual sandbox Cloud Run URL from Task 10 in the backend plan.

- [ ] **Step 3: Build for conference (iOS)**

```bash
eas build --platform ios --profile conference
```

Expected: Build queued on EAS servers (~10 min). iOS `.ipa` distributed via TestFlight internal group.

- [ ] **Step 4: Build for conference (Android)**

```bash
eas build --platform android --profile conference
```

Expected: Android `.apk` build link returned. Install directly on Android devices.

- [ ] **Step 5: Generate QR install links**

```bash
eas build:list --limit 2
```

Note the install URLs. Generate QR codes at `qr.io` or similar for each platform. Print QRs for conference table.

- [ ] **Step 6: Smoke test on conference devices**

On each conference device:
1. Install app via QR link
2. Open app → Login screen visible
3. Register with real email → OTP arrives → verify → "Setting up your lab..." shows → Dashboard loads with data
4. Quick Scan → camera opens
5. SmartScan → camera opens, mode toggle works
6. Inventory → 30 items visible
7. AI Copilot → tap starter prompt → AI responds
8. Energy Hub → gauges show values
9. Drawer → Transactions, Admin, Settings all render

- [ ] **Step 7: Commit**

```bash
git add eas.json
git commit -m "feat(rn): EAS Build config — conference internal distribution profile"
```
