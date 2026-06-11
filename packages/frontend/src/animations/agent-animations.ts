import { animate } from "animejs";

export function createPulse(element: HTMLElement) {
  return animate(element, {
    opacity: [0.85, 0.55],
    duration: 2400,
    ease: "inOutSine",
    loop: true,
    direction: "alternate",
  });
}

export function createSpin(element: HTMLElement) {
  const dot = element.querySelector(".status-dot");
  if (!dot) {
    return animate(element, {
      opacity: [1, 1],
      duration: 0,
    });
  }
  return animate(dot, {
    rotate: "1turn",
    duration: 1000,
    loop: true,
    ease: "linear",
  });
}

export function createIdle(element: HTMLElement) {
  return animate(element, {
    opacity: [0.5, 0.3],
    duration: 2000,
    ease: "inOutSine",
    loop: true,
    direction: "alternate",
  });
}
