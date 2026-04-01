import React from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

function Footer() {
  const handleNewsletterSubmit = (event) => {
    event.preventDefault();
    toast.info("Newsletter subscription will be available soon.");
  };

  const handleSocialPlaceholder = () => {
    toast.info("Social profiles will be published soon.");
  };

  return (
    <footer className="voy-footer">
      <div className="voy-footer-grid">
        <div className="voy-footer-brand">
          <h3>Voyagr</h3>
          <p>
            AI-powered travel companion for planning, generating, and managing
            itinerary-driven trips.
          </p>
          <form className="voy-footer-newsletter" onSubmit={handleNewsletterSubmit}>
            <label htmlFor="voy-footer-newsletter-email" className="voy-sr-only">
              Newsletter email address
            </label>
            <input
              id="voy-footer-newsletter-email"
              type="email"
              placeholder="Your email"
              autoComplete="email"
            />
            <button type="submit">Subscribe</button>
          </form>
        </div>

        <div className="voy-footer-col">
          <h4>Explore</h4>
          <ul>
            <li>
              <Link to={{ pathname: "/", hash: "#destinations" }}>Destinations</Link>
            </li>
            <li>
              <Link to="/create-trip">Trip Planner</Link>
            </li>
            <li>
              <Link to={{ pathname: "/", hash: "#map-section" }}>World Map</Link>
            </li>
            <li>
              <Link to={{ pathname: "/", hash: "#restaurants" }}>Restaurants</Link>
            </li>
            <li>
              <Link to="/my-trips">My Trips</Link>
            </li>
          </ul>
        </div>

        <div className="voy-footer-col">
          <h4>Company</h4>
          <ul>
            <li>
              <Link to="/about">About Us</Link>
            </li>
            <li>
              <Link to="/our-story">Our Story</Link>
            </li>
            <li>
              <Link to="/team">Team</Link>
            </li>
            <li>
              <Link to="/careers">Careers</Link>
            </li>
          </ul>
        </div>

        <div className="voy-footer-col">
          <h4>Support</h4>
          <ul>
            <li>
              <Link to="/help-center">Help Center</Link>
            </li>
            <li>
              <Link to="/contact">Contact</Link>
            </li>
            <li>
              <Link to="/privacy-policy">Privacy Policy</Link>
            </li>
            <li>
              <Link to="/faqs">FAQs</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="voy-footer-bottom">
        <span className="voy-footer-copy">
          © {new Date().getFullYear()} Voyagr. All rights reserved.
        </span>
        <div className="voy-socials" aria-label="Social links">
          <button type="button" onClick={handleSocialPlaceholder} aria-label="Twitter (coming soon)">
            X
          </button>
          <button
            type="button"
            onClick={handleSocialPlaceholder}
            aria-label="Instagram (coming soon)"
          >
            ◉
          </button>
          <button type="button" onClick={handleSocialPlaceholder} aria-label="YouTube (coming soon)">
            ▶
          </button>
          <button type="button" onClick={handleSocialPlaceholder} aria-label="LinkedIn (coming soon)">
            in
          </button>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
