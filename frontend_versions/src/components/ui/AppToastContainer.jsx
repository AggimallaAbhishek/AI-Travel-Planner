import React from "react";
import { ToastContainer } from "react-toastify";
import { useTheme } from "@/context/ThemeContext";
import "react-toastify/dist/ReactToastify.css";

export default function AppToastContainer() {
  const { resolvedTheme } = useTheme();

  return (
    <ToastContainer
      position="top-right"
      autoClose={4000}
      theme={resolvedTheme}
      newestOnTop
      pauseOnFocusLoss={false}
      toastClassName="voy-toast-card"
      bodyClassName="voy-toast-body"
      progressClassName="voy-toast-progress"
    />
  );
}
