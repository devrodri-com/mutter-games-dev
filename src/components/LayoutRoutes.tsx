// src/components/LayoutRoutes.tsx
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";

export default function LayoutRoutes() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  );
}
