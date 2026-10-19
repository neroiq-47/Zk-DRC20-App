import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'explore', title: 'Explore', icon: 'search-outline', active: 'search' },
  { name: 'create', title: 'Create', icon: 'add-circle-outline', active: 'add-circle' },
  { name: 'inbox', title: 'Inbox', icon: 'chatbubbles-outline', active: 'chatbubbles' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline', active: 'person-circle' },
];

// Brand guide: five bottom destinations, safe-area aware, blue for the active destination.
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.textSecondary,
        tabBarStyle: { backgroundColor: t.colors.surface, borderTopColor: t.colors.border },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 12 },
        animation: 'fade',
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? tab.active : tab.icon} color={color as string} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
