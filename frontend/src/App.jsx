import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { StaffProvider } from './context/StaffContext.jsx';

// Route-level code splitting — each page is its own chunk, loaded on demand.
const Home = lazy(() => import('./pages/Home.jsx'));
const TakeToken = lazy(() => import('./pages/TakeToken.jsx'));
const PatientRegister = lazy(() => import('./pages/PatientRegister.jsx'));
const RegistrationStatus = lazy(() => import('./pages/RegistrationStatus.jsx'));
const ReceptionDesk = lazy(() => import('./pages/ReceptionDesk.jsx'));
const MyToken = lazy(() => import('./pages/MyToken.jsx'));
const Lookup = lazy(() => import('./pages/Lookup.jsx'));
const Feedback = lazy(() => import('./pages/Feedback.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminSetup = lazy(() => import('./pages/AdminSetup.jsx'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics.jsx'));
const AdminReport = lazy(() => import('./pages/AdminReport.jsx'));
const AdminFeedback = lazy(() => import('./pages/AdminFeedback.jsx'));
const AdminStaff = lazy(() => import('./pages/AdminStaff.jsx'));
const AdminManage = lazy(() => import('./pages/AdminManage.jsx'));
const AdminQueues = lazy(() => import('./pages/AdminQueues.jsx'));
const AdminQueueNew = lazy(() => import('./pages/AdminQueueNew.jsx'));
const AdminQueueEdit = lazy(() => import('./pages/AdminQueueEdit.jsx'));
const AdminAudit = lazy(() => import('./pages/AdminAudit.jsx'));
const Credits = lazy(() => import('./pages/Credits.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const AssistantWorkspace = lazy(() => import('./pages/AssistantWorkspace.jsx'));
const ShareView = lazy(() => import('./pages/ShareView.jsx'));
const SharedFiles = lazy(() => import('./pages/SharedFiles.jsx'));
const AdminChangePassword = lazy(() => import('./pages/AdminChangePassword.jsx'));
const AdminProfile = lazy(() => import('./pages/AdminProfile.jsx'));
const StaffLogin = lazy(() => import('./pages/StaffLogin.jsx'));
const StaffKiosk = lazy(() => import('./pages/StaffKiosk.jsx'));
const StaffDashboard = lazy(() => import('./pages/StaffDashboard.jsx'));
const StaffProfile = lazy(() => import('./pages/StaffProfile.jsx'));
const StaffChangePassword = lazy(() => import('./pages/StaffChangePassword.jsx'));
const Display = lazy(() => import('./pages/Display.jsx'));
const TokenHistory = lazy(() => import('./pages/TokenHistory.jsx'));
const BookAppointment = lazy(() => import('./pages/BookAppointment.jsx'));
const AdminAppointments = lazy(() => import('./pages/AdminAppointments.jsx'));

function PageFallback() {
  return <div className="max-w-3xl mx-auto px-6 py-24 text-center text-graphite animate-pulse">Loading…</div>;
}

export default function App() {
  return (
    <StaffProvider>
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/"                   element={<Home />} />
            <Route path="/take"               element={<TakeToken />} />
            <Route path="/register"           element={<PatientRegister />} />
            <Route path="/registration/:id"   element={<RegistrationStatus />} />
            <Route path="/credits"            element={<Credits />} />
            <Route path="/notifications"      element={<Notifications />} />
            <Route path="/assistant"          element={<AssistantWorkspace />} />
            <Route path="/share/:id"          element={<ShareView />} />
            <Route path="/files"              element={<SharedFiles />} />
            <Route path="/lookup"             element={<Lookup />} />
            <Route path="/token/:id"          element={<MyToken />} />
            <Route path="/feedback/:tokenId"  element={<Feedback />} />
            <Route path="/display"            element={<Display />} />
            <Route path="/book"               element={<BookAppointment />} />
            <Route path="/history"            element={<TokenHistory />} />
            <Route path="/staff/login"        element={<StaffLogin />} />
            <Route path="/kiosk"              element={<StaffKiosk />} />
            <Route path="/staff"              element={<StaffDashboard />} />
            <Route path="/admin">
              <Route path="login"     element={<AdminLogin />} />
              <Route path=""          element={<AdminDashboard />} />
              <Route path="setup"     element={<AdminSetup />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="report"    element={<AdminReport />} />
              <Route path="feedback"         element={<AdminFeedback />} />
              <Route path="staff"            element={<AdminStaff />} />
              <Route path="queues"           element={<AdminQueues />} />
              <Route path="queues/new"       element={<AdminQueueNew />} />
              <Route path="queues/:id"       element={<AdminQueueEdit />} />
              <Route path="manage"           element={<AdminManage />} />
              <Route path="audit"            element={<AdminAudit />} />
              <Route path="appointments"     element={<AdminAppointments />} />
              <Route path="reception"        element={<ReceptionDesk />} />
              <Route path="change-password"  element={<AdminChangePassword />} />
              <Route path="profile"          element={<AdminProfile />} />
            </Route>
            <Route path="/staff/profile"          element={<StaffProfile />} />
            <Route path="/staff/change-password"  element={<StaffChangePassword />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </StaffProvider>
  );
}
