import { animate } from "animejs";

export function createPulse(element: HTMLElement) {
  return animate(element, {
    scale: [1, 1.1],
    opacity: [1, 0.7],
    duration: 800,
    ease: "inOutSine",
    loop: true,
    direction: "alternate",
  });
}

export function createSpin(element: HTMLElement) {
  const dot = element.querySelector(".status-dot");
  if (!dot) return;
  return animate(dot, {
    rotate: "1turn",
    duration: 1000,
    loop: true,
    ease: "linear",
  });
}

export function createScanning(element: HTMLElement) {
  return animate(element, {
    backgroundPosition: ["0% 50%", "100% 50%"],
    duration: 2000,
    loop: true,
    ease: "inOutSine",
    direction: "alternate",
  });
}

export function createIdle(element: HTMLElement) {
  element.style.opacity = "0.5";
}
