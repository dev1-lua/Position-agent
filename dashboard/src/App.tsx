import { Navigate, Route, Routes } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import PositionAgentPage from '@/pages/PositionAgentPage';

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
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
