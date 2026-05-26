import { animate, stagger } from "animejs";

export function staggerEntrance(elements: HTMLElement[]) {
  return animate(elements, {
    opacity: [0, 1],
    translateY: [20, 0],
    delay: stagger(100),
    duration: 400,
    ease: "outExpo",
  });
}

export function staggerExit(elements: HTMLElement[]) {
  return animate(elements, {
    opacity: [1, 0],
    translateY: [0, -10],
    delay: stagger(50, { from: "last" }),
    duration: 200,
    ease: "inExpo",
  });
}
