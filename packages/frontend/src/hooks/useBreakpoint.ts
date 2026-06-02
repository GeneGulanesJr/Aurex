import { useState, useEffect } from "react";

type Breakpoint = "sm" | "md" | "lg" | "xl";

interface BreakpointState {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
}

const BREAKPOINTS: Record<Breakpoint, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
};

function getBreakpoint(width: number): Breakpoint {
  if (width < BREAKPOINTS.sm) return "sm";
  if (width < BREAKPOINTS.md) return "md";
  if (width < BREAKPOINTS.lg) return "lg";
  return "xl";
}

export function useBreakpoint(): BreakpointState {
  const [state, setState] = useState<BreakpointState>(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1280;
    const bp = getBreakpoint(w);
    return {
      breakpoint: bp,
      isMobile: bp === "sm",
      isTablet: bp === "md",
      isDesktop: bp === "lg" || bp === "xl",
      width: w,
    };
  });

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const bp = getBreakpoint(w);
      setState({
        breakpoint: bp,
        isMobile: bp === "sm",
        isTablet: bp === "md",
        isDesktop: bp === "lg" || bp === "xl",
        width: w,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return state;
}
