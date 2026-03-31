import React from "react";
import { Outlet } from "react-router-dom";
import Header from "../custom/Header.jsx";
import Footer from "../custom/Footer.jsx";

export default function Layout() {
  return (
    <div className="voyagr-page flex flex-col min-h-screen">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
