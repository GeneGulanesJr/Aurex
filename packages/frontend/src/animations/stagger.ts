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
