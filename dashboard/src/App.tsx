import { Navigate, Route, Routes } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import PositionAgentPage from '@/pages/PositionAgentPage';

/**
 * Twenty-style app frame: a gray canvas with the sidebar sitting transparently
 * on it, and ALL content floating in one rounded, hairline-bordered white
 * panel. The panel owns the section header (breadcrumb bar) and the routes.
 */
export default function App() {
  return (
    <div className="flex h-screen gap-2 overflow-hidden bg-background p-2 text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-panel">
        <Header />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/position" element={<PositionAgentPage />} />
            {/* Future sections (reports, uploads, …) mount here as siblings. */}
            <Route path="*" element={<Navigate to="/position" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
