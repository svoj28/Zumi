import { AssistantScreen } from '@/features/assistant/AssistantScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function Assistant() {
  return (
    <ThemeBoundary>
      <AssistantScreen />
    </ThemeBoundary>
  );
}
