import React, { useEffect, useMemo, useState } from "react";
import { Menu, MoonStar, SunMedium, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { Button } from "../ui/button";
import { useAuth } from "@/context/AuthContext";
import { buildLoginPath } from "@/lib/authRedirect";
import { useTheme } from "@/context/ThemeContext";

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, isAdmin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const navItems = useMemo(
    () => [
      {
        to: { pathname: "/", hash: "#destinations" },
        label: "Destinations",
        activeHash: "#destinations",
      },
      { to: "/create-trip", label: "Plan Trip", activePath: "/create-trip" },
      {
        to: { pathname: "/", hash: "#map-section" },
        label: "Map",
        activeHash: "#map-section",
      },
      {
        to: { pathname: "/", hash: "#restaurants" },
        label: "Restaurants",
        activeHash: "#restaurants",
      },
    ],
    []
  );

  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const loginPath = useMemo(() => buildLoginPath(currentPath), [currentPath]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  const handleSignOut = async () => {
    try {
      await signOut();
      setMenuOpen(false);
      toast.success("Signed out successfully.");
    } catch (error) {
      console.error("[auth] Sign-out failed", error);
      toast.error("Unable to sign out right now.");
    }
  };

  return (
    <header className="voy-app-header">
      <div className="voy-nav-shell">
        <Link to="/" className="voy-nav-logo" aria-label="AI Travel Planner home">
          AI Travel Planner
        </Link>

        <nav className="voy-nav-links">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={
                item.activePath
                  ? location.pathname === item.activePath
                    ? "active"
                    : ""
                  : location.hash === item.activeHash
                    ? "active"
                    : ""
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="voy-nav-actions">
          <button
            type="button"
            className="voy-theme-toggle"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>

          {user ? (
            <>
              <Link to="/my-trips">
                <Button className="voy-nav-ghost">My Trips</Button>
              </Link>
              <Link to="/create-trip">
                <Button className="voy-nav-pill">Create Trip</Button>
              </Link>
              <div className="voy-user-chip">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName ?? "User"} />
                ) : null}
                <span>{user.displayName ?? "Traveler"}</span>
                {isAdmin ? <span className="voy-admin-pill">Admin</span> : null}
                <button type="button" onClick={handleSignOut}>
                  Logout
                </button>
              </div>
            </>
          ) : (
            <Link to={loginPath}>
              <Button className="voy-nav-pill">Sign In</Button>
            </Link>
          )}
        </div>

        <button
          className="voy-mobile-toggle"
          onClick={() => setMenuOpen((currentOpen) => !currentOpen)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          aria-controls="voy-mobile-nav"
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <div className={`voy-mobile-menu ${menuOpen ? "open" : ""}`}>
        <nav id="voy-mobile-nav">
          {navItems.map((item) => (
            <Link key={item.label} to={item.to} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ))}

          {user ? (
            <>
              <Link to="/create-trip" onClick={() => setMenuOpen(false)}>
                Create Trip
              </Link>
              <Link to="/my-trips" onClick={() => setMenuOpen(false)}>
                My Trips
              </Link>
              <button type="button" onClick={handleSignOut}>
                Logout
              </button>
            </>
          ) : (
            <Link to={loginPath} onClick={() => setMenuOpen(false)}>
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export default Header;
