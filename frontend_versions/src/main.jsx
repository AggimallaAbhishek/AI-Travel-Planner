import './index.css';
import "./styles/voyagr.css";
import "./styles/voyagr-login.css";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  Link,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";
import App from "./App.jsx";
import CreateTrip from "./create-trip/index.jsx";
import Viewtrip from "./view-trip/index.jsx";
import MyTrips from "./my-trips/index.jsx";
import Layout from "./components/layout/Layout.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import AppToastContainer from "./components/ui/AppToastContainer.jsx";
import { initializeTheme } from "./lib/theme.js";

import Home from "./pages/Home.jsx";
import About from "./pages/About.jsx";
import Contact from "./pages/Contact.jsx";
import Feature from "./pages/Features.jsx";
import OurStory from "./pages/OurStory.jsx";
import Team from "./pages/Team.jsx";
import Careers from "./pages/Careers.jsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.jsx";
import HelpCenter from "./pages/HelpCenter.jsx";
import FAQs from "./pages/FAQs.jsx";
import Feedback from "./pages/Feedback.jsx";
import TravelGuides from "./pages/TravelGuides.jsx";
import AITips from "./pages/AITips.jsx";
import Blog from "./pages/Blog.jsx";
import APIDocs from "./pages/APIDocs.jsx";
import Login from "./pages/Login.jsx";

function LegacyTripRedirect() {
  const { tripId } = useParams();
  return <Navigate to={`/trips/${tripId}`} replace />;
}

function NotFound() {
  return (
    <section className="voy-static-page">
      <div className="voy-page-shell">
        <div className="voy-view-state">
          <div className="voy-view-state-card">
            <span className="voy-static-eyebrow">404</span>
            <h1 className="voy-page-title">
              Page <em>Not Found</em>
            </h1>
            <p className="voy-page-subtitle mt-3">
        The page you requested does not exist or has moved.
            </p>
            <div className="voy-static-actions justify-center mt-6">
              <Link to="/" className="voy-static-action">
                Return Home
              </Link>
              <Link to="/create-trip" className="voy-static-action secondary">
                Create Trip
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <App /> },
      { path: "home", element: <Home /> },
      { path: "create-trip", element: <CreateTrip /> },
      { path: "trips/:tripId", element: <Viewtrip /> },
      { path: "view-trip/:tripId", element: <LegacyTripRedirect /> },
      { path: "my-trips", element: <MyTrips /> },
      { path: "about", element: <About /> },
      { path: "contact", element: <Contact /> },
      { path: "features", element: <Feature /> },
      { path: "our-story", element: <OurStory /> },
      { path: "team", element: <Team /> },
      { path: "careers", element: <Careers /> },
      { path: "privacy-policy", element: <PrivacyPolicy /> },
      { path: "help-center", element: <HelpCenter /> },
      { path: "faqs", element: <FAQs /> },
      { path: "feedback", element: <Feedback /> },
      { path: "travel-guides", element: <TravelGuides /> },
      { path: "ai-tips", element: <AITips /> },
      { path: "blog", element: <Blog /> },
      { path: "api-docs", element: <APIDocs /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <AppToastContainer />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
