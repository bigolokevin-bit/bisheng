/**
 * Visual evidence harness (dev-only, stub data).
 *
 * Mounts AgentPage with createStubAgentConsoleApi(DEMO_FIXTURES) so the
 * first-slice components (list shell + overview) can be rendered in a real
 * browser at 1440x900 and 375 widths for screenshots. This file is NOT part
 * of the app entry or routes; it issues no network requests.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Must run before '@/i18n' initializes the language detector.
import './setLang';
import '@/i18n';
import '@/style/index.css';

import { createStubAgentConsoleApi, DEMO_FIXTURES } from '@/controllers/API/agent';
import { AgentPage } from '..';

const api = createStubAgentConsoleApi(DEMO_FIXTURES);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <div className="bg-bg-page min-h-screen p-6">
        <AgentPage api={api} />
      </div>
    </StrictMode>,
  );
}
