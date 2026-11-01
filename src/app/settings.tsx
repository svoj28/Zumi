import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function SettingsRoute() {
  return (
    <ThemeBoundary>
      <SettingsScreen />
    </ThemeBoundary>
  );
}
